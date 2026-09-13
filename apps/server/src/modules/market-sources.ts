import { decryptSecretWithKeys } from "@riddlr/crypto";
import { agentSources, agents, encryptedSecrets, sources } from "@riddlr/db";
import { takeBounded } from "@riddlr/domain";
import {
  createCoinGeckoAdapter,
  createCoinMarketCapAdapter,
  createCryptoComAdapter,
  type SourceAdapter,
} from "@riddlr/source-adapters";
import { eq } from "drizzle-orm";
import type { AppContext } from "../context.js";

export const MARKET_DATA_ADAPTER_IDS = ["coingecko", "coinmarketcap", "cryptocom"] as const;

export type MarketQuote = {
  canonicalId: string;
  symbol?: string;
  name?: string;
  priceUsd: number;
  marketCapUsd?: number;
  volumeUsd?: number;
  change24h?: number;
  quotedAt: string;
};

export function isMarketDataAdapter(adapterId: string): boolean {
  return (MARKET_DATA_ADAPTER_IDS as readonly string[]).includes(adapterId);
}

export function marketAdapter(
  adapterId: string,
  fetchImpl: typeof fetch = fetch,
): SourceAdapter | undefined {
  if (adapterId === "coingecko") {
    return createCoinGeckoAdapter(fetchImpl);
  }
  if (adapterId === "coinmarketcap") {
    return createCoinMarketCapAdapter(fetchImpl);
  }
  if (adapterId === "cryptocom") {
    return createCryptoComAdapter(fetchImpl);
  }
  return undefined;
}

export async function setActiveMarketSource(ctx: AppContext, sourceId: string) {
  const marketRows = await ctx.db
    .select()
    .from(sources)
    .where(eq(sources.family, "market_data"))
    .limit(16);
  for (const row of marketRows) {
    await ctx.db
      .update(sources)
      .set({ enabled: row.id === sourceId })
      .where(eq(sources.id, row.id));
  }
}

export async function attachSourceToAgents(ctx: AppContext, sourceId: string, agentIds?: string[]) {
  const targets =
    agentIds && agentIds.length > 0
      ? agentIds
      : (
          await ctx.db
            .select({ id: agents.id })
            .from(agents)
            .where(eq(agents.kind, "system_default"))
            .limit(1)
        ).map((row) => row.id);
  if (targets.length === 0) {
    return;
  }
  await ctx.db
    .insert(agentSources)
    .values(takeBounded(targets, 16).map((agentId) => ({ agentId, sourceId })))
    .onConflictDoNothing();
}

export async function replaceSourceAgents(ctx: AppContext, sourceId: string, agentIds: string[]) {
  await ctx.db.delete(agentSources).where(eq(agentSources.sourceId, sourceId));
  await attachSourceToAgents(ctx, sourceId, agentIds);
}

export async function sourceRuntimeConfig(
  ctx: AppContext,
  row: typeof sources.$inferSelect,
): Promise<Record<string, unknown>> {
  const runtime: Record<string, unknown> = { ...row.config };
  if (!row.secretId) {
    return runtime;
  }
  const [secret] = await ctx.db
    .select()
    .from(encryptedSecrets)
    .where(eq(encryptedSecrets.id, row.secretId))
    .limit(1);
  if (!secret) {
    return runtime;
  }
  runtime.token = decryptSecretWithKeys({
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
  return runtime;
}

export async function loadEnabledMarketQuotes(
  ctx: AppContext,
  canonicalIds: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ provider: string | null; quotes: MarketQuote[] }> {
  const ids = takeBounded([...new Set(canonicalIds)], 16);
  const rows = await ctx.db
    .select()
    .from(sources)
    .where(eq(sources.family, "market_data"))
    .limit(16);
  const enabled = rows.find((item) => item.enabled);
  if (!enabled) {
    return { provider: null, quotes: [] };
  }
  const adapter = marketAdapter(enabled.adapterId, fetchImpl);
  if (!adapter) {
    return { provider: enabled.adapterId, quotes: [] };
  }
  const config = await sourceRuntimeConfig(ctx, enabled);
  const result = await adapter.fetch(config, {
    query: ids.join(" "),
    timeRange: "day",
    limit: ids.length || 8,
  });
  const quotes: MarketQuote[] = [];
  for (const item of result.evidence) {
    const payload = item.adapterPayload as
      | {
          canonicalId?: string;
          symbol?: string;
          name?: string;
          priceUsd?: number;
          marketCapUsd?: number;
          volumeUsd?: number;
          change24h?: number;
        }
      | undefined;
    if (typeof payload?.priceUsd !== "number" || !payload.canonicalId) {
      continue;
    }
    quotes.push({
      canonicalId: payload.canonicalId,
      symbol: payload.symbol,
      name: payload.name,
      priceUsd: payload.priceUsd,
      marketCapUsd: typeof payload.marketCapUsd === "number" ? payload.marketCapUsd : undefined,
      volumeUsd: typeof payload.volumeUsd === "number" ? payload.volumeUsd : undefined,
      change24h: typeof payload.change24h === "number" ? payload.change24h : undefined,
      quotedAt: (item.publishedAt ?? item.fetchedAt).toISOString(),
    });
  }
  return { provider: enabled.adapterId, quotes };
}
