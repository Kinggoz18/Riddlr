import { takeBounded } from "@riddlr/domain";
import { MAX_MARKET_IDS, marketSlugs } from "./market-ids.js";
import {
  classifyHttpStatus,
  type FetchQuery,
  type FetchResult,
  type SourceAdapter,
} from "./types.js";

export const COINGECKO_API_BASE = "https://api.coingecko.com/api/v3";
export { MAX_MARKET_IDS };

function parseIds(config: Record<string, unknown>, query: FetchQuery): string[] {
  return marketSlugs(config, query.query);
}

export function parseCoinGeckoMarkets(payload: unknown, fetchedAt: Date): FetchResult {
  if (!Array.isArray(payload)) {
    return {
      evidence: [],
      partial: true,
      errors: [{ class: "malformed", message: "CoinGecko markets payload was not an array." }],
      unresponsiveEngines: [],
    };
  }
  const evidence: FetchResult["evidence"] = [];
  for (const item of takeBounded(payload, MAX_MARKET_IDS)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as {
      id?: unknown;
      symbol?: unknown;
      name?: unknown;
      current_price?: unknown;
      market_cap?: unknown;
      total_volume?: unknown;
      price_change_percentage_24h?: unknown;
      last_updated?: unknown;
    };
    const id = typeof row.id === "string" ? row.id : undefined;
    if (!id || typeof row.current_price !== "number") {
      continue;
    }
    evidence.push({
      sourceFamily: "market_data",
      adapterId: "coingecko",
      externalId: id,
      url: `https://www.coingecko.com/en/coins/${id}`,
      title: typeof row.name === "string" ? `${row.name} market snapshot` : id,
      bodyText: `${typeof row.name === "string" ? row.name : id} quoted at USD ${row.current_price}. Market cap USD ${row.market_cap ?? "unknown"}. Volume USD ${row.total_volume ?? "unknown"}.`,
      publishedAt: typeof row.last_updated === "string" ? new Date(row.last_updated) : fetchedAt,
      fetchedAt,
      adapterPayload: {
        priceUsd: row.current_price,
        marketCapUsd: row.market_cap,
        volumeUsd: row.total_volume,
        change24h:
          typeof row.price_change_percentage_24h === "number"
            ? row.price_change_percentage_24h
            : undefined,
        unit: "usd",
        canonicalId: `coingecko:${id}`,
        symbol: typeof row.symbol === "string" ? row.symbol.toUpperCase() : undefined,
        name: typeof row.name === "string" ? row.name : undefined,
      },
    });
  }
  return { evidence, partial: false, errors: [], unresponsiveEngines: [] };
}

export type CoinGeckoRegistryMarket = {
  id: string;
  symbol: string;
  name: string;
  marketCapRank: number | null;
};

export type CoinGeckoRegistryListItem = {
  id: string;
  symbol: string;
  name: string;
  platforms: Record<string, string>;
};

export type CoinGeckoRegistryJoin = {
  id: string;
  symbol: string;
  name: string;
  marketCapRank: number | null;
  platforms: Record<string, string>;
};

function asRecord(item: unknown): Record<string, unknown> | undefined {
  return item && typeof item === "object" ? (item as Record<string, unknown>) : undefined;
}

export function parseCoinGeckoRegistryMarkets(payload: unknown): {
  rows: CoinGeckoRegistryMarket[];
  skipped: number;
  error?: { class: "malformed"; message: string };
} {
  if (!Array.isArray(payload)) {
    return {
      rows: [],
      skipped: 0,
      error: { class: "malformed", message: "CoinGecko markets payload was not an array." },
    };
  }
  const rows: CoinGeckoRegistryMarket[] = [];
  let skipped = 0;
  for (const item of payload) {
    const row = asRecord(item);
    const id = typeof row?.id === "string" ? row.id : undefined;
    if (!row || !id) {
      skipped += 1;
      continue;
    }
    rows.push({
      id,
      symbol: typeof row.symbol === "string" ? row.symbol : "",
      name: typeof row.name === "string" ? row.name : id,
      marketCapRank: typeof row.market_cap_rank === "number" ? row.market_cap_rank : null,
    });
  }
  return { rows, skipped };
}

export function parseCoinGeckoRegistryList(payload: unknown): {
  rows: CoinGeckoRegistryListItem[];
  skipped: number;
  error?: { class: "malformed"; message: string };
} {
  if (!Array.isArray(payload)) {
    return {
      rows: [],
      skipped: 0,
      error: { class: "malformed", message: "CoinGecko coins list payload was not an array." },
    };
  }
  const rows: CoinGeckoRegistryListItem[] = [];
  let skipped = 0;
  for (const item of payload) {
    const row = asRecord(item);
    const id = typeof row?.id === "string" ? row.id : undefined;
    if (!row || !id) {
      skipped += 1;
      continue;
    }
    const platforms: Record<string, string> = {};
    const raw = asRecord(row.platforms) ?? {};
    for (const [platform, address] of Object.entries(raw)) {
      if (typeof address === "string" && address) {
        platforms[platform] = address;
      }
    }
    rows.push({
      id,
      symbol: typeof row.symbol === "string" ? row.symbol : "",
      name: typeof row.name === "string" ? row.name : id,
      platforms,
    });
  }
  return { rows, skipped };
}

export function joinCoinGeckoRegistry(
  markets: CoinGeckoRegistryMarket[],
  list: CoinGeckoRegistryListItem[],
  topN: number,
): CoinGeckoRegistryJoin[] {
  const ranked = [...markets].sort((left, right) => {
    const leftRank = left.marketCapRank ?? Number.MAX_SAFE_INTEGER;
    const rightRank = right.marketCapRank ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  });
  const unique: CoinGeckoRegistryMarket[] = [];
  const seen = new Set<string>();
  for (const row of ranked) {
    if (seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    unique.push(row);
  }
  const kept = takeBounded(unique, topN);
  const platformsById = new Map(list.map((item) => [item.id, item.platforms]));
  return kept.map((row) => ({
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    marketCapRank: row.marketCapRank,
    platforms: platformsById.get(row.id) ?? {},
  }));
}

export function createCoinGeckoAdapter(fetchImpl: typeof fetch = fetch): SourceAdapter {
  return {
    id: "coingecko",
    family: "market_data",
    capabilities: {
      modes: ["poll"],
      supportsTimeRange: false,
      supportsPagination: false,
      supportsDomainFilter: false,
      lookbackNotes:
        "Official CoinGecko /coins/markets. Operator API key is optional. This is a read-only market-data adapter, not a news source.",
      partialResults: true,
    },
    async validate(config) {
      const ids = parseIds(config, { query: "" });
      if (ids.length === 0) {
        return { ok: false, message: "Provide CoinGecko asset ids." };
      }
      return { ok: true, message: "CoinGecko market-data source looks valid." };
    },
    async healthCheck(config) {
      try {
        const response = await fetchImpl(`${COINGECKO_API_BASE}/ping`, {
          headers: config.token ? { "x-cg-demo-api-key": String(config.token) } : undefined,
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          return { ok: false, message: `CoinGecko HTTP ${response.status}` };
        }
        return { ok: true, message: "CoinGecko ping succeeded." };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "CoinGecko health check failed",
        };
      }
    },
    async fetch(config, query: FetchQuery) {
      const ids = parseIds(config, query);
      if (ids.length === 0) {
        return {
          evidence: [],
          partial: true,
          errors: [{ class: "malformed", message: "No CoinGecko asset ids configured." }],
          unresponsiveEngines: [],
        };
      }
      const url = new URL(`${COINGECKO_API_BASE}/coins/markets`);
      url.searchParams.set("vs_currency", "usd");
      url.searchParams.set("ids", ids.join(","));
      url.searchParams.set("per_page", String(ids.length));
      url.searchParams.set("price_change_percentage", "24h");
      try {
        const response = await fetchImpl(url, {
          headers: config.token ? { "x-cg-demo-api-key": String(config.token) } : undefined,
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          return {
            evidence: [],
            partial: true,
            errors: [
              {
                class: classifyHttpStatus(response.status),
                message: `CoinGecko HTTP ${response.status}`,
              },
            ],
            unresponsiveEngines: [],
          };
        }
        const payload = await response.json().catch(() => null);
        return parseCoinGeckoMarkets(payload, new Date());
      } catch (error) {
        return {
          evidence: [],
          partial: true,
          errors: [
            {
              class: "unavailable",
              message: error instanceof Error ? error.message : "CoinGecko fetch failed",
            },
          ],
          unresponsiveEngines: [],
        };
      }
    },
  };
}
