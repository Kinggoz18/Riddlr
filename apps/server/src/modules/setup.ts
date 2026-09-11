import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encryptSecret } from "@riddlr/crypto";
import {
  agentMarketDomains,
  agentSkills,
  agentSources,
  agents,
  encryptedSecrets,
  instanceSettings,
  providerConfigs,
  skills,
  sources,
  watchlistItems,
  watchlists,
} from "@riddlr/db";
import {
  assertSupportedMarketDomains,
  DEFAULT_AGENT_NAME,
  DEFAULT_MARKET_DOMAIN,
} from "@riddlr/domain";
import { cryptoDomainModule, DEFAULT_CRYPTO_WATCHLIST } from "@riddlr/domain-crypto";
import { eq } from "drizzle-orm";
import type { AppContext } from "../context.js";

const skillDir = join(dirname(fileURLToPath(import.meta.url)), "../../../../skills/crypto");

export async function getSetupState(ctx: AppContext) {
  const rows = await ctx.db.select().from(instanceSettings).limit(1);
  const row = rows[0];
  if (!row) {
    await ctx.db.insert(instanceSettings).values({ id: 1, setupStep: "admin" });
    return { currentStep: "admin" as const, completed: false };
  }
  return {
    currentStep: (row.onboardingCompletedAt ? "complete" : row.setupStep) as
      | "admin"
      | "security"
      | "llm"
      | "domains_sources"
      | "complete",
    completed: Boolean(row.onboardingCompletedAt),
  };
}

export async function requireSetupStep(
  ctx: AppContext,
  expected: "admin" | "security" | "llm" | "domains_sources",
) {
  const state = await getSetupState(ctx);
  if (state.completed) {
    const error = new Error("Setup is already complete.");
    (error as Error & { statusCode?: number; code?: string }).statusCode = 409;
    (error as Error & { code?: string }).code = "setup_locked";
    throw error;
  }
  if (state.currentStep !== expected) {
    const error = new Error(`Setup is on '${state.currentStep}', not '${expected}'.`);
    (error as Error & { statusCode?: number; code?: string }).statusCode = 409;
    (error as Error & { code?: string }).code = "setup_step";
    throw error;
  }
  return state;
}

export async function setSetupStep(ctx: AppContext, step: string, complete = false) {
  await ctx.db
    .update(instanceSettings)
    .set({
      setupStep: step,
      onboardingCompletedAt: complete ? new Date() : null,
    })
    .where(eq(instanceSettings.id, 1));
}

export async function createDefaultCryptoAgent(ctx: AppContext, searxngUrl: string) {
  const profile = cryptoDomainModule.defaultAgentProfile();
  const existing = await ctx.db.select().from(agents).where(eq(agents.kind, "system_default"));
  if (existing[0]) {
    return existing[0];
  }
  const [agent] = await ctx.db
    .insert(agents)
    .values({
      name: profile.name || DEFAULT_AGENT_NAME,
      kind: "system_default",
      enabled: true,
      objectives: profile.objectives,
      schedule: "1h",
      tokenBudget: ctx.config.RIDDLR_DEFAULT_TOKEN_BUDGET,
    })
    .returning();
  if (!agent) {
    throw new Error("Failed to create default agent");
  }
  assertSupportedMarketDomains([DEFAULT_MARKET_DOMAIN]);
  await ctx.db.insert(agentMarketDomains).values({
    agentId: agent.id,
    marketDomainId: DEFAULT_MARKET_DOMAIN,
  });
  const skillFiles = [
    "narrative-detection.md",
    "event-correlation.md",
    "stablecoin-risk.md",
    "liquidity-analysis.md",
    "whale-activity.md",
    "regulatory-analysis.md",
    "early-trend-detection.md",
    "contrarian-analysis.md",
  ];
  for (const file of skillFiles) {
    const body = readFileSync(join(skillDir, file), "utf8");
    const slug = file.replace(".md", "");
    const inserted = await ctx.db
      .insert(skills)
      .values({ slug, version: "1", origin: "shipped", markdownBody: body })
      .onConflictDoNothing()
      .returning();
    const skill =
      inserted[0] ?? (await ctx.db.select().from(skills).where(eq(skills.slug, slug)))[0];
    if (skill) {
      await ctx.db
        .insert(agentSkills)
        .values({ agentId: agent.id, skillId: skill.id })
        .onConflictDoNothing();
    }
  }
  const insertedWatchlist = await ctx.db
    .insert(watchlists)
    .values({ agentId: agent.id, name: "Default watchlist" })
    .onConflictDoNothing({ target: watchlists.agentId })
    .returning();
  const persistedWatchlist =
    insertedWatchlist[0] ??
    (await ctx.db.select().from(watchlists).where(eq(watchlists.agentId, agent.id)))[0];
  if (persistedWatchlist) {
    for (const item of DEFAULT_CRYPTO_WATCHLIST) {
      await ctx.db
        .insert(watchlistItems)
        .values({
          watchlistId: persistedWatchlist.id,
          assetClass: item.assetClass,
          canonicalId: item.canonicalId,
          symbol: item.symbol ?? null,
          name: item.displayName ?? null,
        })
        .onConflictDoNothing();
    }
  }
  const existingSource = await ctx.db
    .select()
    .from(sources)
    .where(eq(sources.adapterId, "searxng"))
    .limit(1);
  const source =
    existingSource[0] ??
    (
      await ctx.db
        .insert(sources)
        .values({
          family: "search",
          adapterId: "searxng",
          name: "SearXNG",
          enabled: true,
          config: { endpoint: searxngUrl },
        })
        .returning()
    )[0];
  if (source) {
    await ctx.db
      .insert(agentSources)
      .values({ agentId: agent.id, sourceId: source.id })
      .onConflictDoNothing();
  }
  const existingMarket = await ctx.db
    .select()
    .from(sources)
    .where(eq(sources.adapterId, "coingecko"))
    .limit(1);
  const market =
    existingMarket[0] ??
    (
      await ctx.db
        .insert(sources)
        .values({
          family: "market_data",
          adapterId: "coingecko",
          name: "CoinGecko",
          enabled: true,
          config: {
            assetIds: DEFAULT_CRYPTO_WATCHLIST.map((item) =>
              item.canonicalId.replace(/^coingecko:/, ""),
            ),
          },
        })
        .returning()
    )[0];
  if (market) {
    await ctx.db
      .insert(agentSources)
      .values({ agentId: agent.id, sourceId: market.id })
      .onConflictDoNothing();
  }
  return agent;
}

export async function saveLlmProvider(
  ctx: AppContext,
  body: { provider: string; baseUrl: string; model: string; apiKey: string },
) {
  const settingsRows = await ctx.db.select().from(instanceSettings).limit(1);
  const keyVersion = settingsRows[0]?.keyVersion ?? 1;
  const encrypted = encryptSecret({
    masterKey: ctx.masterKey,
    plaintext: body.apiKey,
    purpose: "llm",
    keyVersion,
    aad: `llm|${keyVersion}`,
  });
  const existing = await ctx.db.select().from(providerConfigs);
  for (const row of existing) {
    if (
      row.kind.includes("compatible") ||
      row.kind.includes("openai") ||
      row.kind.includes("anthropic")
    ) {
      await ctx.db.delete(providerConfigs).where(eq(providerConfigs.id, row.id));
    }
  }
  const [secret] = await ctx.db
    .insert(encryptedSecrets)
    .values({
      purpose: "llm",
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      tag: encrypted.tag,
      alg: encrypted.alg,
      keyVersion: encrypted.keyVersion,
    })
    .returning();
  await ctx.db.insert(providerConfigs).values({
    kind: body.provider,
    settings: { baseUrl: body.baseUrl, model: body.model, configured: true },
    secretId: secret?.id,
  });
}

export function assertDomainsForExecution(ids: string[]) {
  return assertSupportedMarketDomains(ids);
}
