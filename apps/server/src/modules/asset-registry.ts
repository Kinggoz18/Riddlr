import { decryptSecretWithKeys } from "@riddlr/crypto";
import { assets, encryptedSecrets, portfolioHoldings, sources, watchlistItems } from "@riddlr/db";
import {
  type AssetClass,
  aliasesForAsset,
  COINGECKO_MARKETS_PER_PAGE,
  MAX_ALIASES_PER_ASSET,
  MAX_ASSET_SEARCH_RESULTS,
  MAX_REGISTRY_ASSETS,
  MAX_REGISTRY_LIST_BYTES,
  MAX_REGISTRY_MARKETS_PAGES,
  type RegistryAsset,
  searchRegistry,
  takeBounded,
} from "@riddlr/domain";
import { caip19FromPlatforms, cryptoAssetClassFor } from "@riddlr/domain-crypto";
import {
  assertSafeHttpUrl,
  COINGECKO_API_BASE,
  type CoinGeckoRegistryMarket,
  classifyHttpStatus,
  joinCoinGeckoRegistry,
  parseCoinGeckoRegistryList,
  parseCoinGeckoRegistryMarkets,
  readBoundedJson,
} from "@riddlr/source-adapters";
import { eq, inArray } from "drizzle-orm";
import type { AppContext } from "../context.js";

const REGISTRY_SEED_AT = "riddlr:registry:seed:at";
const REGISTRY_SEED_LOCK = "riddlr:registry:seed:lock";

export function asRegistryAsset(row: {
  assetClass: string;
  canonicalId: string;
  symbol: string | null;
  name: string | null;
  aliases: string[] | null;
  externalIds: { coingeckoId?: string; caip19?: string[] } | null;
  marketCapRank: number | null;
  status: string;
}): RegistryAsset {
  const assetClass = row.assetClass as AssetClass;
  return {
    assetClass,
    canonicalId: row.canonicalId,
    symbol: row.symbol,
    name: row.name,
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    externalIds: row.externalIds ?? {},
    marketCapRank: row.marketCapRank,
    status: row.status === "inactive" ? "inactive" : "active",
  };
}

export async function listWatchedCanonicalIds(ctx: AppContext): Promise<Set<string>> {
  const watched = new Set<string>();
  const listItems = await ctx.db
    .select({ canonicalId: watchlistItems.canonicalId })
    .from(watchlistItems)
    .limit(MAX_REGISTRY_ASSETS);
  for (const item of listItems) {
    watched.add(item.canonicalId);
  }
  const holdings = await ctx.db
    .select({ canonicalId: portfolioHoldings.canonicalId })
    .from(portfolioHoldings)
    .limit(MAX_REGISTRY_ASSETS);
  for (const item of holdings) {
    watched.add(item.canonicalId);
  }
  return watched;
}

export async function listRegistryAssets(ctx: AppContext): Promise<RegistryAsset[]> {
  const watched = await listWatchedCanonicalIds(ctx);
  const rows = await ctx.db.select().from(assets).limit(MAX_REGISTRY_ASSETS);
  const mapped = rows.map(asRegistryAsset);
  const included = mapped.filter(
    (item) => item.status === "active" || watched.has(item.canonicalId),
  );
  return takeBounded(included, MAX_REGISTRY_ASSETS);
}

export async function findRegistryAsset(
  ctx: AppContext,
  canonicalId: string,
): Promise<RegistryAsset | undefined> {
  const [row] = await ctx.db
    .select()
    .from(assets)
    .where(eq(assets.canonicalId, canonicalId.trim().toLowerCase()))
    .limit(1);
  return row ? asRegistryAsset(row) : undefined;
}

export async function searchAssets(ctx: AppContext, query: string, limit: number) {
  const registry = await listRegistryAssets(ctx);
  return searchRegistry(registry, query, Math.min(limit, MAX_ASSET_SEARCH_RESULTS));
}

async function coingeckoHeaders(ctx: AppContext): Promise<Record<string, string>> {
  const [source] = await ctx.db
    .select()
    .from(sources)
    .where(eq(sources.adapterId, "coingecko"))
    .limit(1);
  if (!source?.secretId) {
    return {};
  }
  const [secret] = await ctx.db
    .select()
    .from(encryptedSecrets)
    .where(eq(encryptedSecrets.id, source.secretId))
    .limit(1);
  if (!secret) {
    return {};
  }
  const token = decryptSecretWithKeys({
    keys: ctx.masterKeys,
    secret: {
      ciphertext: secret.ciphertext,
      nonce: secret.nonce,
      tag: secret.tag,
      alg: "aes-256-gcm",
      keyVersion: secret.keyVersion,
    },
    purpose: secret.purpose,
    aad: `${secret.purpose}|${secret.keyVersion}`,
  });
  return token ? { "x-cg-demo-api-key": token } : {};
}

async function fetchJson(
  url: URL,
  headers: Record<string, string>,
  maxBytes: number,
  fetchImpl: typeof fetch,
): Promise<{ payload: unknown; errorClass?: string; status: number }> {
  assertSafeHttpUrl(url.toString());
  try {
    const response = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(20_000),
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      return { payload: null, errorClass: "unavailable", status: response.status };
    }
    if (!response.ok) {
      return {
        payload: null,
        errorClass: classifyHttpStatus(response.status),
        status: response.status,
      };
    }
    try {
      return { payload: await readBoundedJson(response, maxBytes), status: response.status };
    } catch {
      return { payload: null, errorClass: "malformed", status: response.status };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/timeout|aborted/i.test(message)) {
      return { payload: null, errorClass: "unavailable", status: 0 };
    }
    if (/exceeded the size bound/i.test(message)) {
      return { payload: null, errorClass: "malformed", status: 0 };
    }
    return { payload: null, errorClass: "unavailable", status: 0 };
  }
}

export async function seedAssetRegistry(
  ctx: AppContext,
  fetchImpl: typeof fetch = fetch,
): Promise<{ upserted: number; error?: string }> {
  const locked = await ctx.redis.set(REGISTRY_SEED_LOCK, "1", "EX", 600, "NX");
  if (locked !== "OK") {
    ctx.metrics.registrySeeds.inc({ result: "lock_held" });
    return { upserted: 0 };
  }
  try {
    const headers = await coingeckoHeaders(ctx);
    const topN = ctx.config.RIDDLR_REGISTRY_TOP_N;
    const pages = Math.min(
      MAX_REGISTRY_MARKETS_PAGES,
      Math.max(1, Math.ceil(topN / COINGECKO_MARKETS_PER_PAGE)),
    );
    const markets: CoinGeckoRegistryMarket[] = [];
    for (let page = 1; page <= pages; page += 1) {
      const url = new URL(`${COINGECKO_API_BASE}/coins/markets`);
      url.searchParams.set("vs_currency", "usd");
      url.searchParams.set("order", "market_cap_desc");
      url.searchParams.set("per_page", String(COINGECKO_MARKETS_PER_PAGE));
      url.searchParams.set("page", String(page));
      const fetched = await fetchJson(url, headers, 1_000_000, fetchImpl);
      if (fetched.errorClass) {
        ctx.metrics.registrySeeds.inc({ result: "error" });
        return { upserted: 0, error: `CoinGecko markets ${fetched.errorClass}` };
      }
      const parsed = parseCoinGeckoRegistryMarkets(fetched.payload);
      if (parsed.error) {
        ctx.metrics.registrySeeds.inc({ result: "error" });
        return { upserted: 0, error: parsed.error.message };
      }
      markets.push(...parsed.rows);
    }
    const listUrl = new URL(`${COINGECKO_API_BASE}/coins/list`);
    listUrl.searchParams.set("include_platform", "true");
    const listFetched = await fetchJson(listUrl, headers, MAX_REGISTRY_LIST_BYTES, fetchImpl);
    if (listFetched.errorClass) {
      ctx.metrics.registrySeeds.inc({ result: "error" });
      return { upserted: 0, error: `CoinGecko list ${listFetched.errorClass}` };
    }
    const list = parseCoinGeckoRegistryList(listFetched.payload);
    if (list.error) {
      ctx.metrics.registrySeeds.inc({ result: "error" });
      return { upserted: 0, error: list.error.message };
    }
    const joined = joinCoinGeckoRegistry(markets, list.rows, topN);
    const watched = await listWatchedCanonicalIds(ctx);
    const seededIds = new Set(joined.map((item) => `coingecko:${item.id}`));
    for (const item of takeBounded(joined, MAX_REGISTRY_ASSETS)) {
      const canonicalId = `coingecko:${item.id}`;
      const assetClass = cryptoAssetClassFor(item.symbol, item.name);
      const caip19 = caip19FromPlatforms(item.platforms);
      const draft: RegistryAsset = {
        assetClass,
        canonicalId,
        symbol: item.symbol ? item.symbol.toUpperCase() : null,
        name: item.name,
        aliases: [
          item.symbol,
          item.name,
          item.symbol ? `$${item.symbol}` : "",
          item.id,
          canonicalId,
          ...caip19,
          ...Object.values(item.platforms)
            .filter((value) => /^0x[a-fA-F0-9]{40}$/.test(value))
            .map((value) => value.toLowerCase()),
        ].filter(Boolean),
        externalIds: { coingeckoId: item.id, caip19 },
        marketCapRank: item.marketCapRank,
        status: "active",
      };
      const aliases = takeBounded(aliasesForAsset(draft), MAX_ALIASES_PER_ASSET);
      await ctx.db
        .insert(assets)
        .values({
          assetClass,
          canonicalId,
          symbol: draft.symbol,
          name: draft.name,
          aliases,
          externalIds: draft.externalIds,
          marketCapRank: item.marketCapRank,
          status: "active",
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [assets.assetClass, assets.canonicalId],
          set: {
            symbol: draft.symbol,
            name: draft.name,
            aliases,
            externalIds: draft.externalIds,
            marketCapRank: item.marketCapRank,
            status: "active",
            updatedAt: new Date(),
          },
        });
    }
    const existing = await ctx.db.select().from(assets).limit(MAX_REGISTRY_ASSETS);
    const stale = existing.filter(
      (row) =>
        row.status === "active" && !seededIds.has(row.canonicalId) && !watched.has(row.canonicalId),
    );
    if (stale.length > 0) {
      await ctx.db
        .update(assets)
        .set({ status: "inactive", updatedAt: new Date() })
        .where(
          inArray(
            assets.id,
            takeBounded(
              stale.map((item) => item.id),
              MAX_REGISTRY_ASSETS,
            ),
          ),
        );
    }
    await ctx.redis.set(REGISTRY_SEED_AT, new Date().toISOString());
    ctx.metrics.registrySeeds.inc({ result: "ok" });
    return { upserted: joined.length };
  } finally {
    await ctx.redis.del(REGISTRY_SEED_LOCK);
  }
}

export async function seedAssetRegistryIfDue(
  ctx: AppContext,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (ctx.config.RIDDLR_ENV === "test") {
    return;
  }
  const last = await ctx.redis.get(REGISTRY_SEED_AT);
  const intervalMs = ctx.config.RIDDLR_REGISTRY_SEED_INTERVAL_HOURS * 60 * 60 * 1000;
  if (last) {
    const then = new Date(last).getTime();
    if (Number.isFinite(then) && Date.now() - then < intervalMs) {
      return;
    }
  }
  const result = await seedAssetRegistry(ctx, fetchImpl);
  if (result.error) {
    ctx.logger.warn({ err: result.error }, "asset registry seed failed");
  }
}
