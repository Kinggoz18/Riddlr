import { takeBounded } from "@riddlr/domain";
import { MAX_MARKET_IDS, marketSlugs } from "./market-ids.js";
import {
  classifyHttpStatus,
  type FetchQuery,
  type FetchResult,
  type SourceAdapter,
} from "./types.js";

export const COINMARKETCAP_API_BASE = "https://pro-api.coinmarketcap.com";

function quoteUsd(row: Record<string, unknown>): Record<string, unknown> | undefined {
  const quote = row.quote;
  if (!quote || typeof quote !== "object") {
    return undefined;
  }
  const usd = (quote as Record<string, unknown>).USD;
  return usd && typeof usd === "object" ? (usd as Record<string, unknown>) : undefined;
}

function rowsFromPayload(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const data = (payload as { data?: unknown }).data;
  if (Array.isArray(data)) {
    return data.filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object"),
    );
  }
  if (data && typeof data === "object") {
    return Object.values(data).flatMap((item) => {
      if (Array.isArray(item)) {
        return item.filter((row): row is Record<string, unknown> =>
          Boolean(row && typeof row === "object"),
        );
      }
      return item && typeof item === "object" ? [item as Record<string, unknown>] : [];
    });
  }
  return [];
}

export function parseCoinMarketCapQuotes(payload: unknown, fetchedAt: Date): FetchResult {
  const rows = takeBounded(rowsFromPayload(payload), MAX_MARKET_IDS);
  const evidence: FetchResult["evidence"] = [];
  for (const row of rows) {
    const slug = typeof row.slug === "string" ? row.slug : undefined;
    const usd = quoteUsd(row);
    const price = usd?.price;
    if (!slug || typeof price !== "number") {
      continue;
    }
    const name = typeof row.name === "string" ? row.name : slug;
    evidence.push({
      sourceFamily: "market_data",
      adapterId: "coinmarketcap",
      externalId: String(row.id ?? slug),
      url: `https://coinmarketcap.com/currencies/${slug}/`,
      title: `${name} market snapshot`,
      bodyText: `${name} quoted at USD ${price}. Market cap USD ${usd?.market_cap ?? "unknown"}. Volume USD ${usd?.volume_24h ?? "unknown"}.`,
      publishedAt: typeof row.last_updated === "string" ? new Date(row.last_updated) : fetchedAt,
      fetchedAt,
      adapterPayload: {
        priceUsd: price,
        marketCapUsd: usd?.market_cap,
        volumeUsd: usd?.volume_24h,
        change24h: typeof usd?.percent_change_24h === "number" ? usd.percent_change_24h : undefined,
        unit: "usd",
        canonicalId: `coingecko:${slug}`,
        symbol: typeof row.symbol === "string" ? row.symbol : undefined,
        name,
      },
    });
  }
  if (evidence.length === 0) {
    return {
      evidence: [],
      partial: true,
      errors: [{ class: "malformed", message: "CoinMarketCap quotes payload had no USD rows." }],
      unresponsiveEngines: [],
    };
  }
  return { evidence, partial: false, errors: [], unresponsiveEngines: [] };
}

export function createCoinMarketCapAdapter(fetchImpl: typeof fetch = fetch): SourceAdapter {
  return {
    id: "coinmarketcap",
    family: "market_data",
    capabilities: {
      modes: ["poll"],
      supportsTimeRange: false,
      supportsPagination: false,
      supportsDomainFilter: false,
      lookbackNotes:
        "Official CoinMarketCap Pro API GET /v3/cryptocurrency/quotes/latest. Requires X-CMC_PRO_API_KEY. Read-only market data, not news. Use slug, not ticker, in production.",
      partialResults: true,
    },
    async validate(config) {
      if (!config.token || String(config.token).length < 8) {
        return { ok: false, message: "CoinMarketCap requires a Pro API key." };
      }
      return { ok: true, message: "CoinMarketCap market-data source looks valid." };
    },
    async healthCheck(config) {
      if (!config.token) {
        return { ok: false, message: "CoinMarketCap API key is missing." };
      }
      try {
        const url = new URL(`${COINMARKETCAP_API_BASE}/v3/cryptocurrency/quotes/latest`);
        url.searchParams.set("slug", "bitcoin");
        url.searchParams.set("convert", "USD");
        const response = await fetchImpl(url, {
          headers: {
            Accept: "application/json",
            "X-CMC_PRO_API_KEY": String(config.token),
          },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          return { ok: false, message: `CoinMarketCap HTTP ${response.status}` };
        }
        return { ok: true, message: "CoinMarketCap quotes succeeded." };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "CoinMarketCap health check failed",
        };
      }
    },
    async fetch(config, query: FetchQuery) {
      const slugs = marketSlugs(config, query.query);
      if (!config.token) {
        return {
          evidence: [],
          partial: true,
          errors: [{ class: "auth", message: "CoinMarketCap API key is missing." }],
          unresponsiveEngines: [],
        };
      }
      if (slugs.length === 0) {
        return {
          evidence: [],
          partial: true,
          errors: [{ class: "malformed", message: "No CoinMarketCap slugs configured." }],
          unresponsiveEngines: [],
        };
      }
      const url = new URL(`${COINMARKETCAP_API_BASE}/v3/cryptocurrency/quotes/latest`);
      url.searchParams.set("slug", slugs.join(","));
      url.searchParams.set("convert", "USD");
      try {
        const response = await fetchImpl(url, {
          headers: {
            Accept: "application/json",
            "X-CMC_PRO_API_KEY": String(config.token),
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          return {
            evidence: [],
            partial: true,
            errors: [
              {
                class: classifyHttpStatus(response.status),
                message: `CoinMarketCap HTTP ${response.status}`,
              },
            ],
            unresponsiveEngines: [],
          };
        }
        const payload = await response.json().catch(() => null);
        return parseCoinMarketCapQuotes(payload, new Date());
      } catch (error) {
        return {
          evidence: [],
          partial: true,
          errors: [
            {
              class: "unavailable",
              message: error instanceof Error ? error.message : "CoinMarketCap fetch failed",
            },
          ],
          unresponsiveEngines: [],
        };
      }
    },
  };
}
