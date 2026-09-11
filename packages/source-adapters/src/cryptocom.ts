import { takeBounded } from "@riddlr/domain";
import { MAX_MARKET_IDS, marketSlugs, usdSpotInstrument } from "./market-ids.js";
import {
  classifyHttpStatus,
  type FetchQuery,
  type FetchResult,
  type SourceAdapter,
} from "./types.js";

export const CRYPTOCOM_API_BASE = "https://api.crypto.com/exchange/v1";

function instruments(config: Record<string, unknown>, query: FetchQuery): string[] {
  const fromConfig = Array.isArray(config.instruments)
    ? config.instruments.map((item) => String(item).trim().toUpperCase())
    : [];
  const fromSlugs = marketSlugs(config, query.query)
    .map((slug) => usdSpotInstrument(slug))
    .filter(Boolean);
  return takeBounded([...new Set([...fromConfig, ...fromSlugs])] as string[], MAX_MARKET_IDS);
}

function numberish(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function parseCryptoComTickers(payload: unknown, fetchedAt: Date): FetchResult {
  if (!payload || typeof payload !== "object") {
    return {
      evidence: [],
      partial: true,
      errors: [{ class: "malformed", message: "Crypto.com ticker payload was not an object." }],
      unresponsiveEngines: [],
    };
  }
  const envelope = payload as { code?: unknown; result?: { data?: unknown } };
  if (envelope.code !== 0 && envelope.code !== undefined && envelope.code !== "0") {
    return {
      evidence: [],
      partial: true,
      errors: [{ class: "malformed", message: "Crypto.com ticker request failed." }],
      unresponsiveEngines: [],
    };
  }
  const rows = Array.isArray(envelope.result?.data) ? envelope.result.data : [];
  const evidence: FetchResult["evidence"] = [];
  for (const item of takeBounded(rows, MAX_MARKET_IDS)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const instrument = typeof row.i === "string" ? row.i : undefined;
    const price = numberish(row.a);
    if (!instrument || price === undefined) {
      continue;
    }
    const base = instrument.split("_")[0]?.toLowerCase();
    const slug =
      base === "btc"
        ? "bitcoin"
        : base === "eth"
          ? "ethereum"
          : base === "sol"
            ? "solana"
            : base === "usdt"
              ? "tether"
              : base === "usdc"
                ? "usd-coin"
                : base;
    const change = numberish(row.c);
    evidence.push({
      sourceFamily: "market_data",
      adapterId: "cryptocom",
      externalId: instrument,
      url: `https://crypto.com/exchange/trade/${instrument}`,
      title: `${instrument} exchange snapshot`,
      bodyText: `${instrument} quoted at USD ${price}. 24h volume USD ${row.vv ?? "unknown"}.`,
      publishedAt: typeof row.t === "number" ? new Date(row.t) : fetchedAt,
      fetchedAt,
      adapterPayload: {
        priceUsd: price,
        volumeUsd: numberish(row.vv),
        change24h: change !== undefined ? change * 100 : undefined,
        unit: "usd",
        canonicalId: slug ? `coingecko:${slug}` : `cryptocom:${instrument.toLowerCase()}`,
        symbol: base?.toUpperCase(),
        name: instrument,
      },
    });
  }
  if (evidence.length === 0) {
    return {
      evidence: [],
      partial: true,
      errors: [{ class: "malformed", message: "Crypto.com ticker payload had no last prices." }],
      unresponsiveEngines: [],
    };
  }
  return { evidence, partial: false, errors: [], unresponsiveEngines: [] };
}

export function createCryptoComAdapter(fetchImpl: typeof fetch = fetch): SourceAdapter {
  return {
    id: "cryptocom",
    family: "market_data",
    capabilities: {
      modes: ["poll"],
      supportsTimeRange: false,
      supportsPagination: false,
      supportsDomainFilter: false,
      lookbackNotes:
        "Crypto.com Exchange v1 public REST GET /public/get-tickers only. No trading, wallet, or private keys. Spot USD pairs such as BTC_USD.",
      partialResults: true,
    },
    async validate(config) {
      const ids = instruments(config, { query: "" });
      if (ids.length === 0 && !Array.isArray(config.assetIds)) {
        return { ok: true, message: "Watchlist slugs map to Crypto.com USD spot pairs." };
      }
      return { ok: true, message: "Crypto.com market-data source looks valid." };
    },
    async healthCheck() {
      try {
        const url = new URL(`${CRYPTOCOM_API_BASE}/public/get-tickers`);
        url.searchParams.set("instrument_name", "BTC_USD");
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) {
          return { ok: false, message: `Crypto.com HTTP ${response.status}` };
        }
        const payload = (await response.json().catch(() => null)) as { code?: number } | null;
        if (payload && payload.code !== 0 && payload.code !== undefined) {
          return { ok: false, message: "Crypto.com ticker envelope was not successful." };
        }
        return { ok: true, message: "Crypto.com public ticker succeeded." };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "Crypto.com health check failed",
        };
      }
    },
    async fetch(config, query: FetchQuery) {
      const names = instruments(config, query);
      if (names.length === 0) {
        return {
          evidence: [],
          partial: true,
          errors: [{ class: "malformed", message: "No Crypto.com USD spot instruments mapped." }],
          unresponsiveEngines: [],
        };
      }
      const collected: FetchResult["evidence"] = [];
      const errors: FetchResult["errors"] = [];
      for (const instrument of names) {
        const url = new URL(`${CRYPTOCOM_API_BASE}/public/get-tickers`);
        url.searchParams.set("instrument_name", instrument);
        try {
          const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
          if (!response.ok) {
            errors.push({
              class: classifyHttpStatus(response.status),
              message: `Crypto.com HTTP ${response.status} for ${instrument}`,
            });
            continue;
          }
          const payload = await response.json().catch(() => null);
          const parsed = parseCryptoComTickers(payload, new Date());
          collected.push(...parsed.evidence);
          errors.push(...parsed.errors);
        } catch (error) {
          errors.push({
            class: "unavailable",
            message: error instanceof Error ? error.message : "Crypto.com fetch failed",
          });
        }
      }
      return {
        evidence: takeBounded(collected, MAX_MARKET_IDS),
        partial: errors.length > 0 || collected.length < names.length,
        errors,
        unresponsiveEngines: [],
      };
    },
  };
}
