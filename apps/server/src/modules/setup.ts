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
  DEFAULT_AGENT_DESCRIPTION,
  DEFAULT_AGENT_NAME,
  DEFAULT_MARKET_DOMAIN,
  SHIPPED_CRYPTO_SKILL_SLUGS,
  skillOperatorCopy,
} from "@riddlr/domain";
import {
  cryptoDomainModule,
  DEFAULT_CRYPTO_WATCHLIST,
  mergeShippedCryptoObjectives,
} from "@riddlr/domain-crypto";
import { llmStructuredOutputWarning, probeLlmProvider } from "@riddlr/llm";
import { eq } from "drizzle-orm";
import type { AppContext } from "../context.js";
import { ensureDefaultEquitiesAssets } from "./asset-registry.js";
import { ensureDefaultPriceTrackerHostPolicies } from "./intelligence.js";

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

export async function ensureShippedCryptoSkills(ctx: AppContext, agentId?: string) {
  for (const slug of SHIPPED_CRYPTO_SKILL_SLUGS) {
    const body = readFileSync(join(skillDir, `${slug}.md`), "utf8");
    const inserted = await ctx.db
      .insert(skills)
      .values({
        slug,
        version: "1",
        origin: "shipped",
        description: skillOperatorCopy({ slug, markdownBody: body }).description,
        markdownBody: body,
      })
      .onConflictDoNothing()
      .returning();
    const skill =
      inserted[0] ?? (await ctx.db.select().from(skills).where(eq(skills.slug, slug)))[0];
    if (skill && agentId) {
      await ctx.db.insert(agentSkills).values({ agentId, skillId: skill.id }).onConflictDoNothing();
    }
  }
  if (!agentId) {
    return;
  }
  const [agent] = await ctx.db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (agent?.kind !== "system_default") {
    return;
  }
  const nextObjectives = mergeShippedCryptoObjectives(agent.objectives ?? []);
  const canned =
    agent.description === "" ||
    agent.description ===
      "The default Crypto watcher. It scans attached sources on a schedule, clusters evidence into events, and analyzes only material events. It cannot trade.";
  const nextDescription = canned ? DEFAULT_AGENT_DESCRIPTION : agent.description;
  if (
    nextObjectives.join("\0") !== (agent.objectives ?? []).join("\0") ||
    nextDescription !== agent.description
  ) {
    await ctx.db
      .update(agents)
      .set({ objectives: nextObjectives, description: nextDescription })
      .where(eq(agents.id, agentId));
  }
}

export async function createDefaultCryptoAgent(ctx: AppContext, searxngUrl: string) {
  const profile = cryptoDomainModule.defaultAgentProfile();
  const existing = await ctx.db.select().from(agents).where(eq(agents.kind, "system_default"));
  if (existing[0]) {
    await ensureShippedCryptoSkills(ctx, existing[0].id);
    await ensureDefaultEquitiesAssets(ctx);
    return existing[0];
  }
  const [agent] = await ctx.db
    .insert(agents)
    .values({
      name: profile.name || DEFAULT_AGENT_NAME,
      kind: "system_default",
      enabled: true,
      description: profile.description,
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
  await ensureShippedCryptoSkills(ctx, agent.id);
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
  await ensureDefaultPriceTrackerHostPolicies(ctx);
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
  await ensureDefaultEquitiesAssets(ctx);
  return agent;
}

export async function assertLlmReachable(
  ctx: AppContext,
  body: { provider: string; baseUrl: string; model: string; apiKey: string },
) {
  if (ctx.config.RIDDLR_ENV === "test") {
    return;
  }
  try {
    await probeLlmProvider({
      kind: body.provider === "anthropic_compatible" ? "anthropic_compatible" : "openai_compatible",
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      model: body.model,
    });
  } catch {
    const error = new Error(
      "Could not reach that model. Check the base URL, model name, and API key.",
    );
    (error as Error & { statusCode?: number; code?: string }).statusCode = 400;
    (error as Error & { code?: string }).code = "llm_unreachable";
    throw error;
  }
}

export function isLlmProviderKind(kind: string) {
  return kind.includes("compatible") || kind.includes("openai") || kind.includes("anthropic");
}

export function toPublicLlm(providers: Array<{ kind: string; settings: unknown }>) {
  const row = providers.find((item) => isLlmProviderKind(item.kind));
  if (!row) {
    return { configured: false as const };
  }
  const settings = row.settings as { baseUrl?: unknown; model?: unknown };
  const baseUrl = typeof settings.baseUrl === "string" ? settings.baseUrl : undefined;
  const model = typeof settings.model === "string" ? settings.model : undefined;
  const structuredOutputWarning = llmStructuredOutputWarning({
    provider: row.kind,
    baseUrl,
    model,
  });
  return {
    configured: true as const,
    provider: row.kind,
    ...(baseUrl ? { baseUrl } : {}),
    ...(model ? { model } : {}),
    ...(structuredOutputWarning ? { structuredOutputWarning } : {}),
  };
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
    if (isLlmProviderKind(row.kind)) {
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
