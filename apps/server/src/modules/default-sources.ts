import { agents, sourceIdentityPolicies, sources } from "@riddlr/db";
import { DEFAULT_FEED_POLL_INTERVAL_SECONDS, type TrustTier } from "@riddlr/domain";
import {
  DEFAULT_CRYPTO_FEEDS,
  DEFAULT_SEARXNG_NEWS_ENGINES,
  parseSearxngEngines,
} from "@riddlr/source-adapters";
import { eq } from "drizzle-orm";
import type { AppContext } from "../context.js";
import { upsertSourceIdentity } from "./intelligence.js";
import { attachSourceToAgents } from "./market-sources.js";

function allowedUsesForTier(tier: TrustTier): string[] {
  if (tier === "blocked") {
    return ["discovery"];
  }
  if (tier === "official_firsthand") {
    return ["discovery", "analysis", "early_warning", "confirmation"];
  }
  return ["discovery", "analysis"];
}

export async function ensureDefaultSearxngNewsEngines(ctx: AppContext) {
  const rows = await ctx.db.select().from(sources).where(eq(sources.adapterId, "searxng")).limit(8);
  for (const row of rows) {
    let engines: string[] = [];
    try {
      engines = parseSearxngEngines(row.config.engines);
    } catch {
      engines = [];
    }
    if (engines.length > 0) {
      continue;
    }
    await ctx.db
      .update(sources)
      .set({
        config: { ...row.config, engines: [...DEFAULT_SEARXNG_NEWS_ENGINES] },
      })
      .where(eq(sources.id, row.id));
  }
}

export async function ensureDefaultCryptoFeedSources(ctx: AppContext, agentId?: string) {
  let targetAgentId = agentId;
  if (!targetAgentId) {
    const [agent] = await ctx.db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.kind, "system_default"))
      .limit(1);
    if (!agent) {
      return;
    }
    targetAgentId = agent.id;
  }
  const feedRows = await ctx.db
    .select()
    .from(sources)
    .where(eq(sources.adapterId, "feeds"))
    .limit(64);
  for (const feed of DEFAULT_CRYPTO_FEEDS) {
    const existing = feedRows.find(
      (row) => typeof row.config.feedUrl === "string" && row.config.feedUrl === feed.url,
    );
    const source =
      existing ??
      (
        await ctx.db
          .insert(sources)
          .values({
            family: "feed",
            adapterId: "feeds",
            enabled: true,
            name: feed.name,
            config: {
              feedUrl: feed.url,
              trustTier: feed.trustTier,
              pollIntervalSeconds: DEFAULT_FEED_POLL_INTERVAL_SECONDS,
            },
          })
          .returning()
      )[0];
    if (!source) {
      continue;
    }
    if (!existing) {
      feedRows.push(source);
    }
    await attachSourceToAgents(ctx, source.id, [targetAgentId]);
    const hostname = new URL(feed.url).hostname.toLowerCase();
    const identityId = await upsertSourceIdentity(ctx, {
      platform: "feed",
      externalId: hostname,
      displayName: feed.name,
      hostname,
    });
    if (!identityId) {
      continue;
    }
    const policies = await ctx.db
      .select()
      .from(sourceIdentityPolicies)
      .where(eq(sourceIdentityPolicies.identityId, identityId))
      .limit(50);
    if (policies.some((row) => row.active)) {
      continue;
    }
    const revision = policies.reduce((max, row) => Math.max(max, row.revision), 0) + 1;
    await ctx.db.insert(sourceIdentityPolicies).values({
      identityId,
      revision,
      trustTier: feed.trustTier,
      allowedUses: allowedUsesForTier(feed.trustTier),
      notes: `Feed ${feed.url}`,
      active: true,
    });
  }
}
