import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "@riddlr/config";
import {
  currentTotp,
  decodeMasterKey,
  decryptSecretWithKeys,
  encryptSecret,
  generateMasterKey,
  hashToken,
  hmacSha256Utf8,
  randomToken,
} from "@riddlr/crypto";
import {
  agentMarketDomains,
  agentNotificationRoutes,
  agentSources,
  agents,
  aiUsageEvents,
  assets,
  auditLogs,
  claimEvidence,
  claims,
  createDb,
  encryptedSecrets,
  eventAssets,
  eventClaims,
  eventEvidence,
  events,
  evidenceItems,
  inboundWebhookReceipts,
  migrate,
  notificationDeliveries,
  observationAlertRules,
  observationSeries,
  observations,
  passwordResetTokens,
  portfolios,
  publisherHostPolicies,
  scans,
  sessions,
  signalClaimProofs,
  signalOutcomes,
  signals,
  skills,
  sourceIdentities,
  sourceIdentityPolicies,
  sources,
  users,
  watchlistItems,
  watchlists,
  whatsappSessions,
} from "@riddlr/db";

import { DomainModuleRegistry, normalizeEvidence } from "@riddlr/domain";
import { cryptoDomainModule } from "@riddlr/domain-crypto";
import { equitiesDomainModule } from "@riddlr/domain-equities";
import { createLogger, createMetrics, snapshotProcessMemory } from "@riddlr/observability";
import { QUEUE_NAMES } from "@riddlr/queue";
import {
  BINANCE_FUTURES_PROVIDER_ID,
  COINGECKO_SPOT_PROVIDER_ID,
  createScriptedObservationProvider,
  DEFILLAMA_PROVIDER_ID,
  HYPERLIQUID_PROVIDER_ID,
  KALSHI_PROVIDER_ID,
  ObservationProviderRegistry,
  POLYMARKET_PROVIDER_ID,
} from "@riddlr/source-adapters";
import { Queue } from "bullmq";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Redis } from "ioredis";
import postgres from "postgres";
import { GenericContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { AppContext } from "../src/context.js";
import {
  ensureDefaultEquitiesAssets,
  findRegistryAsset,
  listRegistryAssets,
  seedAssetRegistry,
} from "../src/modules/asset-registry.js";
import { processInboundReceipt } from "../src/modules/inbound-webhooks.js";
import { createDiscordWebhookTarget } from "../src/modules/notification-api.js";
import { deliverObservationAlerts, deliverSignalNotifications } from "../src/modules/notify.js";
import { pollObservationProvider, retainObservationSeries } from "../src/modules/observe.js";
import { recordDueOutcomes } from "../src/modules/outcomes.js";
import { analyzeQueuedEvent, runScan } from "../src/modules/pipeline.js";
import { enforceSessionCap } from "../src/modules/sessions.js";

function cookieHeader(setCookie: string | string[] | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const session = list.find((item) => item.startsWith("riddlr_session=")) ?? list[0];
  return String(session ?? "").split(";")[0] ?? "";
}

const DISCORD_TEST_TOKEN_PAD = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab";

async function isolatedDiscordTarget(appCtx: AppContext, channelId: string, webhookId: string) {
  const token = `${DISCORD_TEST_TOKEN_PAD}${webhookId.slice(-8)}`;
  const webhookUrl = `https://discord.com/api/webhooks/${webhookId}/${token}`;
  const target = await createDiscordWebhookTarget(
    appCtx,
    { webhookUrl },
    {
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      fetchImpl: async (input) => {
        if (String(input).includes("?wait=true")) {
          return Response.json({ id: "should-not-validate" });
        }
        return Response.json({ type: 1, channel_id: channelId, name: channelId });
      },
    },
  );
  expect(target?.id).toBeDefined();
  expect(target?.destination).toBe(channelId);
  return { target: target as NonNullable<typeof target>, token };
}

async function firstAgentId(appCtx: AppContext): Promise<string> {
  const [row] = await appCtx.db
    .select({ id: agents.id })
    .from(agents)
    .orderBy(asc(agents.createdAt))
    .limit(1);
  expect(row?.id).toBeDefined();
  return row?.id as string;
}

async function scanIdForAgent(appCtx: AppContext, agentId: string): Promise<string> {
  const [row] = await appCtx.db
    .select({ id: scans.id })
    .from(scans)
    .where(eq(scans.agentId, agentId))
    .orderBy(asc(scans.startedAt))
    .limit(1);
  expect(row?.id).toBeDefined();
  return row?.id as string;
}

function fixtureArticleHtml(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><title>${title}</title></head><body><article><p>${body}</p><p>The filing said Bitcoin demand rose after reported ETF inflows covering US listed products.</p></article></body></html>`;
}

function coinGeckoMarketsResponse() {
  return Response.json([
    {
      id: "bitcoin",
      symbol: "btc",
      name: "Bitcoin",
      current_price: 64000,
      market_cap: 1,
      total_volume: 2,
      last_updated: "2026-09-10T00:00:00.000Z",
    },
  ]);
}

function proofIdsFromAnalysisPrompt(user: string): { evidenceIds: string[]; claimIds: string[] } {
  const claimIds = [...user.matchAll(/\bCLAIM=([0-9a-f-]{36})/gi)].map(
    (match) => match[1] as string,
  );
  const evidenceIds = [...user.matchAll(/(?:^|\n)ID=([0-9a-f-]{36})/gi)]
    .map((match) => match[1] as string)
    .filter((id) => !claimIds.includes(id));
  return { evidenceIds, claimIds };
}

describe("setup, auth, and domain persistence", () => {
  let stop: (() => Promise<void>) | undefined;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let ctx: AppContext;
  let cookie = "";
  let recoveryCode = "";
  let totpSecret = "";

  beforeAll(async () => {
    const postgres = await new GenericContainer("postgres:17-alpine")
      .withEnvironment({
        POSTGRES_USER: "riddlr",
        POSTGRES_PASSWORD: "riddlr",
        POSTGRES_DB: "riddlr",
      })
      .withTmpFs({ "/var/lib/postgresql/data": "rw,noexec,nosuid,size=256m" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();
    const valkey = await new GenericContainer("valkey/valkey:8-alpine")
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();
    const databaseUrl = `postgres://riddlr:riddlr@${postgres.getHost()}:${postgres.getMappedPort(5432)}/riddlr`;
    const redisUrl = `redis://${valkey.getHost()}:${valkey.getMappedPort(6379)}`;
    await migrate(databaseUrl);
    const { db, client } = createDb(databaseUrl);
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const master = generateMasterKey();
    const cookieSecret = randomToken();
    const domains = new DomainModuleRegistry();
    domains.register(cryptoDomainModule);
    domains.register(equitiesDomainModule);
    const config = parseEnv({
      RIDDLR_ENV: "test",
      RIDDLR_HTTP_HOST: "127.0.0.1",
      RIDDLR_HTTP_PORT: "3001",
      RIDDLR_PUBLIC_URL: "http://localhost:8080",
      RIDDLR_DATABASE_URL: databaseUrl,
      RIDDLR_REDIS_URL: redisUrl,
      RIDDLR_COOKIE_SECRET: cookieSecret,
      RIDDLR_ENCRYPTION_MASTER_KEY: master,
      RIDDLR_LOG_LEVEL: "error",
      RIDDLR_LOG_FORMAT: "json",
      RIDDLR_SEARXNG_URL: "http://searxng:8080",
      RIDDLR_EMAIL_FROM: "Riddlr <noreply@localhost>",
      RIDDLR_SECRETS_DIR: mkdtempSync(join(tmpdir(), "riddlr-setup-")),
      RIDDLR_GENERATE_DEV_SECRETS: "false",
      RIDDLR_PROCESS_ROLE: "api",
      RIDDLR_METRICS_PUBLIC: "false",
    });
    const masterKey = decodeMasterKey(master);
    ctx = {
      config,
      db,
      redis,
      scanQueue: new Queue(QUEUE_NAMES.scanRun, { connection: redis }),
      logger: createLogger({ level: "error", pretty: false }),
      metrics: createMetrics(),
      masterKey,
      masterKeys: [masterKey],
      domains,
    };
    await ensureDefaultEquitiesAssets(ctx);
    app = await buildApp(ctx);
    stop = async () => {
      await app.close();
      await redis.quit();
      await client.end();
      await postgres.stop();
      await valkey.stop();
    };
  }, 120_000);

  afterAll(async () => {
    await stop?.();
  });

  it("completes four-step onboarding and persists the default Crypto agent", async () => {
    const status = await app.inject({ method: "GET", url: "/api/v1/setup/status" });
    const statusBody = status.json();
    expect(statusBody.stepCount).toBe(4);
    expect(statusBody.domains.find((item: { id: string }) => item.id === "crypto").supported).toBe(
      true,
    );
    expect(
      statusBody.domains.find((item: { id: string }) => item.id === "equities").supported,
    ).toBe(true);
    expect(
      statusBody.domains.find((item: { id: string }) => item.id === "equities").comingSoon,
    ).toBe(false);
    for (const id of ["forex", "commodities", "macro"]) {
      expect(statusBody.domains.find((item: { id: string }) => item.id === id).comingSoon).toBe(
        true,
      );
    }

    const admin = await app.inject({
      method: "POST",
      url: "/api/v1/setup/admin",
      payload: { email: "ops@example.com", username: "ops", password: "correct horse battery" },
    });
    expect(admin.statusCode).toBe(200);
    cookie = cookieHeader(admin.headers["set-cookie"]);

    const skip = await app.inject({
      method: "POST",
      url: "/api/v1/setup/totp/skip",
      headers: { cookie },
    });
    expect(skip.statusCode).toBe(200);
    cookie = cookieHeader(skip.headers["set-cookie"]) || cookie;

    const tooEarly = await app.inject({
      method: "POST",
      url: "/api/v1/setup/complete",
      headers: { cookie },
      payload: { marketDomainIds: ["crypto"] },
    });
    expect(tooEarly.statusCode).toBe(409);

    const ssrfLlm = await app.inject({
      method: "POST",
      url: "/api/v1/setup/llm",
      headers: { cookie },
      payload: {
        provider: "openai_compatible",
        baseUrl: "http://169.254.169.254",
        model: "gpt-4.1-mini",
        apiKey: "sk-test-never-store-plain",
      },
    });
    expect(ssrfLlm.statusCode).toBe(400);

    const llm = await app.inject({
      method: "POST",
      url: "/api/v1/setup/llm",
      headers: { cookie },
      payload: {
        provider: "openai_compatible",
        baseUrl: "https://api.openai.com",
        model: "gpt-4.1-mini",
        apiKey: "sk-test-never-store-plain",
      },
    });
    expect(llm.statusCode).toBe(200);

    const comingSoon = await app.inject({
      method: "POST",
      url: "/api/v1/setup/complete",
      headers: { cookie },
      payload: { marketDomainIds: ["forex"] },
    });
    expect(comingSoon.statusCode).toBe(400);

    const complete = await app.inject({
      method: "POST",
      url: "/api/v1/setup/complete",
      headers: { cookie },
      payload: { marketDomainIds: ["crypto"] },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().firstScanQueued).toBe(true);

    const secondComplete = await app.inject({
      method: "POST",
      url: "/api/v1/setup/complete",
      headers: { cookie },
      payload: { marketDomainIds: ["crypto"] },
    });
    expect(secondComplete.statusCode).toBe(409);

    const totpAfterComplete = await app.inject({
      method: "POST",
      url: "/api/v1/setup/totp/start",
      headers: { cookie },
    });
    expect(totpAfterComplete.statusCode).toBe(409);

    const loginWithoutTotp = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "ops@example.com", password: "correct horse battery" },
    });
    expect(loginWithoutTotp.statusCode).toBe(200);
    expect(loginWithoutTotp.json().requiresTwoFactor).toBe(false);
    cookie = cookieHeader(loginWithoutTotp.headers["set-cookie"]);
    const overviewWithoutTotp = await app.inject({
      method: "GET",
      url: "/api/v1/overview",
      headers: { cookie },
    });
    expect(overviewWithoutTotp.statusCode).toBe(200);

    const totpStart = await app.inject({
      method: "POST",
      url: "/api/v1/settings/totp/start",
      headers: { cookie },
    });
    expect(totpStart.statusCode).toBe(200);
    totpSecret = totpStart.json().secret as string;
    const totpVerify = await app.inject({
      method: "POST",
      url: "/api/v1/settings/totp/verify",
      headers: { cookie },
      payload: { token: currentTotp(totpSecret) },
    });
    expect(totpVerify.statusCode).toBe(200);
    recoveryCode = totpVerify.json().recoveryCodes[0] as string;

    const agentsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/agents",
      headers: { cookie },
    });
    const agent = agentsResponse.json().agents[0];
    expect(agent.name).toBe("Riddlr Intelligence Agent");
    expect(agent.domains).toEqual(["crypto"]);
    expect(agent.tokenBudget).toBe(100_000);
    expect(agent.description).toMatch(/Crypto watcher/);
    expect(agent.objectives).toEqual(
      expect.arrayContaining(["general_crypto_intelligence", "risk_signals"]),
    );
    expect(agent.watchlist.items.map((item: { canonicalId: string }) => item.canonicalId)).toEqual(
      expect.arrayContaining(["coingecko:bitcoin", "coingecko:ethereum", "coingecko:tether"]),
    );
    expect(agent.skills.map((item: { slug: string }) => item.slug)).toEqual(
      expect.arrayContaining([
        "event-correlation",
        "narrative-detection",
        "catalyst-analysis",
        "materiality-analysis",
        "risk-assessment",
        "whale-activity",
        "candidate-discovery",
      ]),
    );
    expect(agent.skills).toHaveLength(14);
    const sourceList = await app.inject({
      method: "GET",
      url: "/api/v1/sources",
      headers: { cookie },
    });
    expect(sourceList.json().sources.map((item: { adapterId: string }) => item.adapterId)).toEqual(
      expect.arrayContaining(["searxng", "coingecko"]),
    );

    const cryptocom = await app.inject({
      method: "POST",
      url: "/api/v1/sources/cryptocom",
      headers: { cookie },
      payload: { name: "Crypto.com Exchange" },
    });
    expect(cryptocom.statusCode).toBe(200);
    const afterMarket = await app.inject({
      method: "GET",
      url: "/api/v1/sources",
      headers: { cookie },
    });
    const market = afterMarket
      .json()
      .sources.filter((item: { family?: string; adapterId: string }) =>
        ["coingecko", "cryptocom"].includes(item.adapterId),
      );
    expect(market.filter((item: { enabled: boolean }) => item.enabled)).toHaveLength(1);
    expect(
      market.find((item: { adapterId: string }) => item.adapterId === "cryptocom")?.enabled,
    ).toBe(true);
    const geckoId = market.find((item: { adapterId: string }) => item.adapterId === "coingecko")
      ?.id as string;
    const restored = await app.inject({
      method: "PATCH",
      url: `/api/v1/sources/${geckoId}`,
      headers: { cookie },
      payload: { enabled: true },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().source.enabled).toBe(true);

    const llmSkipLocked = await app.inject({
      method: "POST",
      url: "/api/v1/setup/llm/skip",
      headers: { cookie },
    });
    expect(llmSkipLocked.statusCode).toBe(409);

    const joins = await ctx.db.select().from(agentMarketDomains);
    expect(joins).toHaveLength(1);
    expect(joins[0]?.marketDomainId).toBe("crypto");

    const settings = await app.inject({
      method: "GET",
      url: "/api/v1/settings",
      headers: { cookie },
    });
    expect(settings.json().llmConfigured).toBe(true);
    expect(settings.json().llm).toEqual({
      configured: true,
      provider: "openai_compatible",
      baseUrl: "https://api.openai.com",
      model: "gpt-4.1-mini",
    });
    expect(settings.json().encryption.keyVersion).toBe(1);
    expect(settings.json().email).toEqual({
      configured: false,
      transport: "none",
      from: "Riddlr <noreply@localhost>",
      resendSaved: false,
    });
    expect(JSON.stringify(settings.json())).not.toContain("sk-test");
    expect(JSON.stringify(settings.json())).not.toMatch(/"apiKey":/);
    const secrets = await ctx.db.select().from(encryptedSecrets);
    expect(secrets[0]?.ciphertext).not.toContain("sk-test");
  });

  it("hides metrics by default and reloads the domain registry from postgres", async () => {
    const hidden = await app.inject({ method: "GET", url: "/metrics" });
    expect(hidden.statusCode).toBe(404);
    const visible = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { cookie },
    });
    expect(visible.statusCode).toBe(200);
    const domains = await app.inject({ method: "GET", url: "/api/v1/market-domains" });
    expect(domains.json().domains).toHaveLength(5);
  });

  it("rejects coming-soon scans even if a join row exists", async () => {
    const agentRows = await ctx.db.select().from(agents);
    const agentId = agentRows[0]?.id;
    expect(agentId).toBeDefined();
    await ctx.db.insert(agentMarketDomains).values({
      agentId: agentId as string,
      marketDomainId: "forex",
    });
    const scan = await app.inject({
      method: "POST",
      url: `/api/v1/agents/${agentId}/scan`,
      headers: { cookie },
    });
    expect(scan.statusCode).toBe(400);
    await ctx.db.delete(agentMarketDomains).where(eq(agentMarketDomains.marketDomainId, "forex"));
    const allowed = await app.inject({
      method: "POST",
      url: `/api/v1/agents/${agentId}/scan`,
      headers: { cookie },
    });
    expect(allowed.statusCode).toBe(200);
    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/agents/${agentId}/scan`,
      headers: { cookie },
    });
    expect(duplicate.json().duplicate).toBe(true);
  });

  it("revokes sessions on logout and accepts a recovery code after login", async () => {
    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(200);
    const blocked = await app.inject({
      method: "GET",
      url: "/api/v1/overview",
      headers: { cookie },
    });
    expect(blocked.statusCode).toBe(401);

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "ops", password: "correct horse battery" },
    });
    expect(login.statusCode).toBe(200);
    cookie = cookieHeader(login.headers["set-cookie"]);
    const twoFa = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa",
      headers: { cookie },
      payload: { token: recoveryCode },
    });
    expect(twoFa.statusCode).toBe(200);
    cookie = cookieHeader(twoFa.headers["set-cookie"]);
    const reuse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa",
      headers: { cookie },
      payload: { token: recoveryCode },
    });
    expect(reuse.statusCode).toBe(401);
  });

  it("issues hashed reset tokens, revokes sessions, and never emails secrets in API bodies", async () => {
    const requestReset = await app.inject({
      method: "POST",
      url: "/api/v1/auth/reset/request",
      payload: { email: "ops@example.com" },
    });
    expect(requestReset.statusCode).toBe(200);
    expect(requestReset.json()).toEqual({ ok: true, delivered: false });
    expect(JSON.stringify(requestReset.json())).not.toMatch(/token/);
    const resetStatus = await app.inject({ method: "GET", url: "/api/v1/auth/reset/status" });
    expect(resetStatus.json()).toEqual({ delivered: false });
    const completeMissing = await app.inject({
      method: "POST",
      url: "/api/v1/auth/reset/complete",
      payload: { token: "not-a-real-reset-token-value", newPassword: "replacement horse battery" },
    });
    expect(completeMissing.statusCode).toBe(400);
  });

  it("stores an encrypted Resend key and reports email as configured", async () => {
    const apiKey = "re_test_never_return_secret";
    const saved = await app.inject({
      method: "POST",
      url: "/api/v1/settings/email",
      headers: { cookie },
      payload: { apiKey, from: "Riddlr <alerts@example.com>" },
    });
    expect(saved.statusCode).toBe(200);
    const settings = await app.inject({
      method: "GET",
      url: "/api/v1/settings",
      headers: { cookie },
    });
    expect(settings.json().email).toEqual({
      configured: true,
      transport: "resend",
      from: "Riddlr <alerts@example.com>",
      resendSaved: true,
    });
    expect(JSON.stringify(settings.json())).not.toContain(apiKey);
    const secrets = await ctx.db.select().from(encryptedSecrets);
    expect(
      secrets.some((row) => row.purpose === "resend" && !row.ciphertext.includes(apiKey)),
    ).toBe(true);
    const status = await app.inject({ method: "GET", url: "/api/v1/auth/reset/status" });
    expect(status.json()).toEqual({ delivered: true });
    const requestReset = await app.inject({
      method: "POST",
      url: "/api/v1/auth/reset/request",
      payload: { email: "ops@example.com" },
    });
    expect(requestReset.json()).toEqual({ ok: true, delivered: true });
    expect(JSON.stringify(requestReset.json())).not.toMatch(/token/);
    const removed = await app.inject({
      method: "DELETE",
      url: "/api/v1/settings/email",
      headers: { cookie },
    });
    expect(removed.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: "/api/v1/auth/reset/status" });
    expect(after.json()).toEqual({ delivered: false });
  });

  it("enforces notification delivery uniqueness", async () => {
    const agentRows = await ctx.db.select().from(agents);
    const scanRows = await ctx.db.select().from(scans);
    const agentId = agentRows[0]?.id as string;
    const scanId = scanRows[0]?.id as string;
    const [event] = await ctx.db
      .insert(events)
      .values({
        agentId,
        scanId,
        title: "Fixture cluster",
        status: "analyzed",
        windowStart: new Date(),
      })
      .returning();
    const [signal] = await ctx.db
      .insert(signals)
      .values({
        eventId: event?.id as string,
        agentId,
        headline: "Fixture",
        whyItMatters: "Coverage",
        proof: { evidenceIds: ["ev-1"], summary: "fixture" },
        action: "Watch",
        risk: "moderate",
        confidence: "0.4",
        schemaVersion: "fixture",
      })
      .returning();
    await ctx.db.insert(notificationDeliveries).values({
      signalId: signal?.id as string,
      channel: "telegram",
      status: "sent",
      idempotencyKey: "signal:fixture:telegram",
    });
    await expect(
      ctx.db.insert(notificationDeliveries).values({
        signalId: signal?.id as string,
        channel: "telegram",
        status: "sent",
        idempotencyKey: "signal:fixture:telegram",
      }),
    ).rejects.toThrow();
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/notifications",
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().deliveries.length).toBeGreaterThan(0);
  });

  it("runs mocked SearXNG through proof-linked signals and reuses fingerprints", async () => {
    const agentRows = await ctx.db.select().from(agents);
    const agentId = agentRows[0]?.id as string;
    const [scan] = await ctx.db
      .insert(scans)
      .values({
        agentId,
        status: "queued",
        windowStart: new Date("2026-01-01T00:00:00.000Z"),
        idempotencyKey: "pipeline:crypto:fixture-1",
      })
      .returning();
    expect(scan?.id).toBeDefined();

    let understandingCalls = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("api.coingecko.com")) {
        return coinGeckoMarketsResponse();
      }
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nDisallow:", { status: 404 });
      }
      if (url.includes("/search")) {
        return Response.json({
          results: [
            {
              url: "https://example.com/bitcoin-etf",
              title: "Bitcoin ETF inflows accelerate",
              content:
                "Bitcoin demand rose after reported ETF inflows covering US listed products.",
              engine: "fixture",
            },
            {
              url: "https://news.example.com/bitcoin-etf",
              title: "Bitcoin ETF inflows rose after latest issuer filing",
              content: "Listed products attracted cash this week as Bitcoin allocations increased.",
              engine: "fixture",
            },
          ],
        });
      }
      if (url === "https://example.com/bitcoin-etf") {
        return new Response(
          `<!doctype html><html lang="en"><head><title>Bitcoin ETF inflows accelerate</title></head><body><article><p>Bitcoin ETF inflows accelerated this week after several US issuers reported stronger allocator demand.</p><p>Desks described the shift as a rotation into listed products rather than a one-day headline spike across social channels.</p><p>The filing said Bitcoin demand rose after reported ETF inflows covering US listed products.</p></article></body></html>`,
          { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
      if (url === "https://news.example.com/bitcoin-etf") {
        return new Response(
          `<!doctype html><html lang="en"><head><title>Bitcoin ETF inflows rose after latest issuer filing</title></head><body><article><p>Spot Bitcoin vehicles listed in the United States recorded another session of net creations.</p><p>Market desks said listed products pulled cash from other crypto vehicles while ETF inflows continued through the afternoon.</p><p>The latest issuer filing covering US listed products showed Bitcoin demand rose after the inflows print, according to the report.</p></article></body></html>`,
          { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
      if (url.includes("/v1/chat/completions")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          messages?: Array<{ role?: string; content?: string }>;
          response_format?: { json_schema?: { name?: string } };
        };
        const user = body.messages?.find((item) => item.role === "user")?.content ?? "";
        const { evidenceIds: ids, claimIds } = proofIdsFromAnalysisPrompt(user);
        if (body.response_format?.json_schema?.name === "content_understanding") {
          understandingCalls += 1;
          return Response.json({
            id: "chatcmpl-understanding",
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "The article reports Bitcoin ETF inflows into US listed products.",
                    pageClass: "news_report",
                    headlineBodyConsistent: true,
                    attributedToOtherOrigin: false,
                    claims: [
                      {
                        kind: "listing_or_delisting",
                        predicate: "listing_or_delisting",
                        polarity: "asserted",
                        modality: "asserted",
                        excerpt: "ETF inflows",
                        subjectCanonicalId: "coingecko:bitcoin",
                      },
                    ],
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 80, completion_tokens: 40 },
          });
        }
        return Response.json({
          id: "chatcmpl-fixture",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  headline: "Bitcoin ETF inflows draw correlated coverage",
                  whyItMatters:
                    "Independent search results describe the same Bitcoin demand shift.",
                  proof: {
                    evidenceIds: ids.slice(0, 1),
                    claimIds: claimIds.slice(0, 1),
                    summary: "SearXNG titles independently describe Bitcoin ETF inflows.",
                  },
                  action: "Watch ETF flow reporting; do not trade.",
                  risk: "moderate",
                  confidence: 0.62,
                  assets: ["coingecko:bitcoin"],
                  eventType: "listing_or_delisting",
                  marketContext: "Crypto domain context from extracted Bitcoin mentions.",
                  contradictoryEvidence: "No contradictory evidence in this fixture.",
                  invalidationConditions: "Inflows reverse or coverage is retracted.",
                }),
              },
            },
          ],
          usage: { prompt_tokens: 120, completion_tokens: 80 },
        });
      }
      return new Response("unexpected fetch", { status: 404 });
    };

    await runScan(ctx, scan?.id as string, { fetchImpl });
    const finished = await ctx.db
      .select()
      .from(scans)
      .where(eq(scans.id, scan?.id as string));
    expect(finished[0]?.status).toBe("succeeded");
    const evidence = await ctx.db.select().from(evidenceItems);
    expect(evidence.length).toBeGreaterThan(0);
    expect(
      evidence.filter((row) => row.contentCompleteness === "full_document").length,
    ).toBeGreaterThanOrEqual(2);
    const firstEvents = await ctx.db
      .select()
      .from(events)
      .where(eq(events.scanId, scan?.id as string));
    expect(firstEvents.some((row) => row.reliabilityStatus === "corroborated")).toBe(true);
    expect(understandingCalls).toBeGreaterThan(0);
    const listedEvents = await app.inject({
      method: "GET",
      url: "/api/v1/events?limit=50",
      headers: { cookie },
    });
    expect(
      (
        listedEvents.json().events as Array<{ catalystKind?: string; reliabilityStatus: string }>
      ).some(
        (row) =>
          row.reliabilityStatus === "corroborated" && row.catalystKind === "listing_or_delisting",
      ),
    ).toBe(true);
    const signalRows = await ctx.db.select().from(signals);
    const produced = signalRows.find((row) => row.headline.includes("Bitcoin ETF"));
    expect(produced).toBeDefined();
    const proofIds = produced?.proof.evidenceIds ?? [];
    expect(proofIds.length).toBeGreaterThan(0);
    expect((produced?.proof.claimIds ?? []).length).toBeGreaterThan(0);
    expect(produced?.typedSignal).toBe("listing_or_delisting");
    expect(produced?.outputKind).toBe("unverified_early_warning");
    expect(produced?.anticipated).toBe(false);
    const proofs = produced?.id
      ? await ctx.db
          .select()
          .from(signalClaimProofs)
          .where(eq(signalClaimProofs.signalId, produced.id))
      : [];
    expect(proofs.length).toBeGreaterThan(0);
    for (const proof of proofs) {
      expect(produced?.proof.evidenceIds).toContain(proof.evidenceId);
      expect(produced?.proof.claimIds).toContain(proof.claimId);
      const linkedClaim = await ctx.db
        .select()
        .from(claimEvidence)
        .where(
          and(
            eq(claimEvidence.claimId, proof.claimId),
            eq(claimEvidence.evidenceId, proof.evidenceId),
          ),
        );
      expect(linkedClaim.length).toBeGreaterThan(0);
    }
    const firstFingerprint = firstEvents.find(
      (row) => row.reliabilityStatus === "corroborated",
    )?.clusterFingerprint;
    const linked =
      proofIds.length > 0
        ? await ctx.db.select().from(evidenceItems).where(inArray(evidenceItems.id, proofIds))
        : [];
    expect(linked).toHaveLength(proofIds.length);

    const understandingBeforeRepeat = understandingCalls;
    const [repeat] = await ctx.db
      .insert(scans)
      .values({
        agentId,
        status: "queued",
        windowStart: new Date("2026-01-01T01:00:00.000Z"),
        idempotencyKey: "pipeline:crypto:fixture-2",
      })
      .returning();
    await runScan(ctx, repeat?.id as string, { fetchImpl });
    const afterRepeat = await ctx.db.select().from(evidenceItems);
    expect(afterRepeat).toHaveLength(evidence.length);
    const repeatEvents = await ctx.db.select().from(events).where(eq(events.agentId, agentId));
    expect(repeatEvents.some((row) => row.status === "analyzed")).toBe(true);
    if (firstFingerprint) {
      const sameCluster = await ctx.db
        .select()
        .from(events)
        .where(eq(events.clusterFingerprint, firstFingerprint));
      expect(sameCluster).toHaveLength(1);
      expect(sameCluster[0]?.identityKey).toBeTruthy();
      expect(["open", "developing", "confirmed", "disputed", "retracted", "resolved"]).toContain(
        sameCluster[0]?.lifecycleState,
      );
    }
    expect(understandingCalls).toBe(understandingBeforeRepeat);

    const [failedScan] = await ctx.db
      .insert(scans)
      .values({
        agentId,
        status: "queued",
        windowStart: new Date("2026-01-01T02:00:00.000Z"),
        idempotencyKey: "pipeline:crypto:fixture-fail",
      })
      .returning();
    await runScan(ctx, failedScan?.id as string, {
      fetchImpl: async () => new Response("nope", { status: 500 }),
    });
    const failed = await ctx.db
      .select()
      .from(scans)
      .where(eq(scans.id, failedScan?.id as string));
    expect(failed[0]?.status).toBe("failed");
    const memory = snapshotProcessMemory();
    expect(memory.rss).toBeGreaterThan(1_000_000);
    expect(memory.peakRss).toBeGreaterThanOrEqual(memory.rss);
  });

  it("persists perp stress as an observed early warning, never a fundamental signal", async () => {
    const agentRows = await ctx.db.select().from(agents);
    const agentId = agentRows[0]?.id as string;
    const sourceRows = await ctx.db.select().from(sources).limit(1);
    const sourceId = sourceRows[0]?.id as string;
    const [btc] = await ctx.db
      .select()
      .from(assets)
      .where(eq(assets.canonicalId, "coingecko:bitcoin"))
      .limit(1);
    const [scan] = await ctx.db
      .insert(scans)
      .values({
        agentId,
        status: "succeeded",
        windowStart: new Date("2026-09-14T12:00:00.000Z"),
        idempotencyKey: "pipeline:crypto:perp-stress",
      })
      .returning();
    const [evidence] = await ctx.db
      .insert(evidenceItems)
      .values({
        sourceId,
        scanId: scan?.id as string,
        fingerprint: "perp-stress-evidence",
        contentHash: "perp-stress-hash",
        title: "Bitcoin perpetual funding z-score",
        bodyText: "market_stress.v1 on coingecko:bitcoin: z=4.20 over 20 funding_rate_apr samples.",
        fetchedAt: new Date("2026-09-14T12:00:00.000Z"),
        sourceFamily: "observation",
        adapterId: "hyperliquid",
        contentCompleteness: "native_complete",
      })
      .returning();
    const [claim] = await ctx.db
      .insert(claims)
      .values({
        marketDomainId: "crypto",
        kind: "crypto:market_stress",
        predicate: "market_stress",
        objectText: "funding z=4.20",
        polarity: "asserted",
        modality: "asserted",
        fingerprint: "perp-stress-claim",
        title: "Bitcoin perpetual funding z-score",
      })
      .returning();
    await ctx.db.insert(claimEvidence).values({
      claimId: claim?.id as string,
      evidenceId: evidence?.id as string,
      stance: "supports",
      excerpt: "market_stress.v1",
      excerptHash: "perp-stress-excerpt",
    });
    const [event] = await ctx.db
      .insert(events)
      .values({
        agentId,
        scanId: scan?.id as string,
        title: "Bitcoin perpetual funding z-score",
        status: "needs_analysis",
        windowStart: new Date("2026-09-14T12:00:00.000Z"),
        marketDomainId: "crypto",
        reliabilityStatus: "observed",
        impactLevel: "informational",
        catalystKind: "market_stress",
        subjectCanonicalId: "coingecko:bitcoin",
        materialityReason: "observed_anomaly",
        contentCompleteness: "native_complete",
      })
      .returning();
    await ctx.db.insert(eventEvidence).values({
      eventId: event?.id as string,
      evidenceId: evidence?.id as string,
      role: "primary",
    });
    await ctx.db.insert(eventClaims).values({
      eventId: event?.id as string,
      claimId: claim?.id as string,
      stance: "supports",
    });
    if (btc?.id) {
      await ctx.db.insert(eventAssets).values({
        eventId: event?.id as string,
        assetId: btc.id,
      });
    }
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/chat/completions") || url.includes("/v1/messages")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          messages?: Array<{ role: string; content: string }>;
        };
        const user = body.messages?.find((item) => item.role === "user")?.content ?? "";
        const ids = proofIdsFromAnalysisPrompt(user);
        return Response.json({
          id: "chatcmpl-perp",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  headline: "Perp funding stress on Bitcoin",
                  whyItMatters: "Funding z-score tripped the market-stress detector.",
                  proof: {
                    evidenceIds: ids.evidenceIds.slice(0, 1),
                    claimIds: ids.claimIds.slice(0, 1),
                    summary: "Hyperliquid funding detector.",
                  },
                  action: "Treat as a market observation; do not trade.",
                  risk: "high",
                  confidence: 0.7,
                  assets: ["coingecko:bitcoin"],
                  eventType: "market_stress",
                  marketContext: "Perp book.",
                  contradictoryEvidence: "none",
                  invalidationConditions: "funding mean-reverts.",
                }),
              },
            },
          ],
          usage: { prompt_tokens: 40, completion_tokens: 20 },
        });
      }
      return new Response("unexpected fetch", { status: 404 });
    };
    await analyzeQueuedEvent(ctx, event?.id as string, fetchImpl);
    const [saved] = await ctx.db
      .select()
      .from(signals)
      .where(eq(signals.eventId, event?.id as string));
    expect(saved?.typedSignal).toBe("perp_stress");
    expect(saved?.outputKind).toBe("unverified_early_warning");
    expect(saved?.epistemicStatus).toBe("observed");
    expect(saved?.notifyKind).toBe("early_warning");
    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/signals/${saved?.id}`,
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().signal.typedSignal).toBe("perp_stress");
  });

  it("does not corroborate two hosts that syndicate the same outbound origin", async () => {
    const agentRows = await ctx.db.select().from(agents);
    const agentId = agentRows[0]?.id as string;
    const [scan] = await ctx.db
      .insert(scans)
      .values({
        agentId,
        status: "queued",
        windowStart: new Date("2026-04-01T00:00:00.000Z"),
        idempotencyKey: "pipeline:crypto:syndication",
      })
      .returning();
    const html = (hostTitle: string) =>
      `<!doctype html><html lang="en"><head><title>${hostTitle}</title></head><body><article><p>Bitcoin ETF inflows covering US listed products continued after the latest issuer filing.</p><p>Desks said listed products attracted cash this week.</p><p><a href="https://www.reuters.com/world/crypto-filing">Reuters filing</a></p></article></body></html>`;
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("api.coingecko.com")) {
        return coinGeckoMarketsResponse();
      }
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nDisallow:", { status: 404 });
      }
      if (url.includes("/search")) {
        return Response.json({
          results: [
            {
              url: "https://desk.example.com/wire",
              title: "Bitcoin ETF inflows covering US listed products",
              content:
                "Bitcoin ETF inflows covering US listed products continued after the latest issuer filing.",
              engine: "fixture",
            },
            {
              url: "https://mirror.example.net/wire",
              title: "Bitcoin ETF inflows covering US listed products",
              content:
                "Bitcoin ETF inflows covering US listed products continued after the latest issuer filing.",
              engine: "fixture",
            },
          ],
        });
      }
      if (url === "https://desk.example.com/wire") {
        return new Response(html("Desk reprint"), {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (url === "https://mirror.example.net/wire") {
        return new Response(html("Mirror reprint"), {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (url.includes("/v1/chat/completions")) {
        return new Response("llm should not be required for syndication classification", {
          status: 500,
        });
      }
      return new Response("unexpected fetch", { status: 404 });
    };
    await runScan(ctx, scan?.id as string, { fetchImpl });
    const clustered = await ctx.db
      .select()
      .from(events)
      .where(eq(events.scanId, scan?.id as string));
    expect(clustered.some((row) => row.reliabilityStatus === "corroborated")).toBe(false);
  });

  it("lists sessions, recovery remaining, and paginated audit without leaking tokens", async () => {
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/sessions",
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    const sessionRows = listed.json().sessions as Array<{ current: boolean; tokenHash?: string }>;
    expect(sessionRows.some((row) => row.current)).toBe(true);
    expect(JSON.stringify(listed.json())).not.toMatch(/tokenHash/);

    const recovery = await app.inject({
      method: "GET",
      url: "/api/v1/auth/recovery",
      headers: { cookie },
    });
    expect(recovery.json().remaining).toBe(9);

    const audit = await app.inject({
      method: "GET",
      url: "/api/v1/audit?limit=2",
      headers: { cookie },
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().audit.length).toBeLessThanOrEqual(2);

    const tooBig = await app.inject({
      method: "GET",
      url: "/api/v1/audit?limit=101",
      headers: { cookie },
    });
    expect(tooBig.statusCode).toBe(400);

    const denied = await app.inject({
      method: "DELETE",
      url: "/api/v1/audit",
    });
    expect(denied.statusCode).toBe(401);

    const cleared = await app.inject({
      method: "DELETE",
      url: "/api/v1/audit",
      headers: { cookie },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toEqual({ ok: true });

    const afterClear = await app.inject({
      method: "GET",
      url: "/api/v1/audit?limit=20",
      headers: { cookie },
    });
    expect(afterClear.statusCode).toBe(200);
    const remaining = afterClear.json().audit as Array<{ action: string }>;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.action).toBe("audit.cleared");

    const signalsPage = await app.inject({
      method: "GET",
      url: "/api/v1/signals?limit=1",
      headers: { cookie },
    });
    expect(signalsPage.statusCode).toBe(200);
    expect(signalsPage.json().signals.length).toBeLessThanOrEqual(1);
    const newest = signalsPage.json().signals[0] as { id: string; createdAt: string } | undefined;
    if (newest?.createdAt) {
      const older = await app.inject({
        method: "GET",
        url: `/api/v1/signals?limit=1&before=${encodeURIComponent(newest.createdAt)}`,
        headers: { cookie },
      });
      expect(older.statusCode).toBe(200);
      expect(
        (older.json().signals as Array<{ id: string }>).every((row) => row.id !== newest.id),
      ).toBe(true);
    }
  });

  it("rotates recovery codes and re-encrypts secrets including previous-key material", async () => {
    const rotateRecovery = await app.inject({
      method: "POST",
      url: "/api/v1/auth/recovery/rotate",
      headers: { cookie },
      payload: { token: currentTotp(totpSecret) },
    });
    expect(rotateRecovery.statusCode).toBe(200);
    expect(rotateRecovery.json().recoveryCodes).toHaveLength(10);
    const reused = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa",
      headers: { cookie },
      payload: { token: recoveryCode },
    });
    expect(reused.statusCode).toBe(401);
    recoveryCode = rotateRecovery.json().recoveryCodes[0] as string;

    const previous = decodeMasterKey(generateMasterKey());
    ctx.masterKeys = [ctx.masterKey, previous];
    const stale = encryptSecret({
      masterKey: previous,
      plaintext: "legacy-llm-key",
      purpose: "llm",
      keyVersion: 1,
      aad: "llm|1",
    });
    await ctx.db.insert(encryptedSecrets).values({
      purpose: "llm",
      ciphertext: stale.ciphertext,
      nonce: stale.nonce,
      tag: stale.tag,
      alg: stale.alg,
      keyVersion: 1,
    });
    const before = await ctx.db.select().from(encryptedSecrets);
    const rotateKeys = await app.inject({
      method: "POST",
      url: "/api/v1/settings/encryption/rotate",
      headers: { cookie },
      payload: { currentPassword: "correct horse battery", token: currentTotp(totpSecret) },
    });
    expect(rotateKeys.statusCode).toBe(200);
    expect(rotateKeys.json().keyVersion).toBe(2);
    const after = await ctx.db.select().from(encryptedSecrets);
    expect(after.every((row) => row.keyVersion === 2)).toBe(true);
    expect(
      after.some((row) => row.ciphertext !== before.find((item) => item.id === row.id)?.ciphertext),
    ).toBe(true);
    for (const row of after) {
      const plaintext = decryptSecretWithKeys({
        keys: [ctx.masterKey],
        secret: {
          ciphertext: row.ciphertext,
          nonce: row.nonce,
          tag: row.tag,
          alg: "aes-256-gcm",
          keyVersion: row.keyVersion,
        },
        purpose: row.purpose,
        aad: `${row.purpose}|${row.keyVersion}`,
      });
      if (row.purpose === "llm") {
        expect(plaintext).toMatch(/sk-test-never-store-plain|legacy-llm-key/);
      } else {
        expect(plaintext.length).toBeGreaterThan(0);
      }
    }
    const settings = await app.inject({
      method: "GET",
      url: "/api/v1/settings",
      headers: { cookie },
    });
    expect(settings.json().encryption.keyVersion).toBe(2);
  });

  it("keeps the current session on password change, caps siblings, and expires idle sessions", async () => {
    const [user] = await ctx.db.select().from(users).limit(1);
    const [sibling] = await ctx.db
      .insert(sessions)
      .values({
        userId: user?.id as string,
        tokenHash: hashToken(randomToken()),
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
      })
      .returning();
    const changed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password",
      headers: { cookie },
      payload: { currentPassword: "correct horse battery", newPassword: "correct horse battery" },
    });
    expect(changed.statusCode).toBe(200);
    const stillMe = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { cookie },
    });
    expect(stillMe.statusCode).toBe(200);
    const siblingRows = await ctx.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sibling?.id as string))
      .limit(1);
    expect(siblingRows[0]?.revokedAt).toBeTruthy();

    const previousCap = ctx.config.RIDDLR_MAX_SESSIONS;
    ctx.config.RIDDLR_MAX_SESSIONS = 2;
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/sessions",
      headers: { cookie },
    });
    const currentId = (listed.json().sessions as Array<{ id: string; current: boolean }>).find(
      (row) => row.current,
    )?.id as string;
    for (let index = 0; index < 4; index += 1) {
      await ctx.db.insert(sessions).values({
        userId: user?.id as string,
        tokenHash: hashToken(randomToken()),
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
      });
    }
    await enforceSessionCap(ctx, user?.id as string, currentId);
    const active = await ctx.db.select().from(sessions).where(isNull(sessions.revokedAt));
    expect(active.length).toBeLessThanOrEqual(2);
    expect(active.some((row) => row.id === currentId)).toBe(true);
    ctx.config.RIDDLR_MAX_SESSIONS = previousCap;

    await ctx.db
      .update(sessions)
      .set({ lastSeenAt: new Date(Date.now() - 3 * 60 * 60 * 1000) })
      .where(eq(sessions.id, currentId));
    const idle = await app.inject({
      method: "GET",
      url: "/api/v1/overview",
      headers: { cookie },
    });
    expect(idle.statusCode).toBe(401);
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "ops@example.com", password: "correct horse battery" },
    });
    cookie = cookieHeader(login.headers["set-cookie"]);
    const twoFa = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa",
      headers: { cookie },
      payload: { token: currentTotp(totpSecret) },
    });
    expect(twoFa.statusCode).toBe(200);
    cookie = cookieHeader(twoFa.headers["set-cookie"]);
  });

  it("creates a Crypto user agent, rejects coming-soon domains, and rejects privilege-granting skills", async () => {
    const comingSoon = await app.inject({
      method: "POST",
      url: "/api/v1/agents",
      headers: { cookie },
      payload: {
        name: "Forex watcher",
        marketDomainIds: ["forex"],
        schedule: "1h",
      },
    });
    expect(comingSoon.statusCode).toBe(400);

    const equitiesAgent = await app.inject({
      method: "POST",
      url: "/api/v1/agents",
      headers: { cookie },
      payload: {
        name: "Equities watcher",
        marketDomainIds: ["equities"],
        schedule: "1h",
        watchlistItems: [{ canonicalId: "sec:0000320193" }],
      },
    });
    expect(equitiesAgent.statusCode).toBe(200);
    expect(equitiesAgent.json().agent.domains).toEqual(["equities"]);
    expect(
      (equitiesAgent.json().agent.watchlist.items as Array<{ canonicalId: string }>).map(
        (item) => item.canonicalId,
      ),
    ).toEqual(["sec:0000320193"]);

    const ticker = await app.inject({
      method: "POST",
      url: "/api/v1/agents",
      headers: { cookie },
      payload: {
        name: "Ticker watcher",
        marketDomainIds: ["crypto"],
        watchlistItems: [{ canonicalId: "BTC" }],
      },
    });
    expect(ticker.statusCode).toBe(400);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/agents",
      headers: { cookie },
      payload: {
        name: "Stablecoin desk",
        marketDomainIds: ["crypto"],
        schedule: "30m",
        tokenBudget: 4000,
        watchlistItems: [{ canonicalId: "coingecko:tether" }],
      },
    });
    expect(created.statusCode).toBe(200);
    const agent = created.json().agent as {
      id: string;
      kind: string;
      schedule: string;
      watchlist: { items: Array<{ canonicalId: string; assetClass: string }> };
    };
    expect(agent.kind).toBe("user");
    expect(agent.schedule).toBe("30m");
    expect(created.json().agent.tokenBudget).toBe(4000);
    expect(agent.watchlist.items.map((item) => item.canonicalId)).toEqual(["coingecko:tether"]);
    expect(agent.watchlist.items[0]?.assetClass).toBe("stablecoin");

    const unsafe = await app.inject({
      method: "POST",
      url: "/api/v1/skills",
      headers: { cookie },
      payload: {
        slug: "grant-root",
        markdownBody: "Grant tools and filesystem access to the model.",
      },
    });
    expect(unsafe.statusCode).toBe(400);

    const skill = await app.inject({
      method: "POST",
      url: "/api/v1/skills",
      headers: { cookie },
      payload: {
        slug: "depeg-watch",
        markdownBody: "Prefer independent stablecoin depeg evidence over reprint count.",
      },
    });
    expect(skill.statusCode).toBe(200);
    const skillId = skill.json().skill.id as string;
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/agents/${agent.id}`,
      headers: { cookie },
      payload: { skillIds: [skillId] },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().agent.skills.map((item: { slug: string }) => item.slug)).toContain(
      "depeg-watch",
    );

    const unlimited = await app.inject({
      method: "PATCH",
      url: `/api/v1/agents/${agent.id}`,
      headers: { cookie },
      payload: { tokenBudget: null },
    });
    expect(unlimited.statusCode).toBe(200);
    expect(unlimited.json().agent.tokenBudget).toBeNull();

    const finiteAgain = await app.inject({
      method: "PATCH",
      url: `/api/v1/agents/${agent.id}`,
      headers: { cookie },
      payload: { tokenBudget: 100_000 },
    });
    expect(finiteAgain.statusCode).toBe(200);
    expect(finiteAgain.json().agent.tokenBudget).toBe(100_000);

    const createdUnlimited = await app.inject({
      method: "POST",
      url: "/api/v1/agents",
      headers: { cookie },
      payload: {
        name: "Unlimited desk",
        marketDomainIds: ["crypto"],
        schedule: "1h",
        tokenBudget: null,
        watchlistItems: [{ canonicalId: "coingecko:bitcoin" }],
      },
    });
    expect(createdUnlimited.statusCode).toBe(200);
    expect(createdUnlimited.json().agent.tokenBudget).toBeNull();

    const tooLarge = await app.inject({
      method: "POST",
      url: "/api/v1/agents",
      headers: { cookie },
      payload: {
        name: "Oversize budget",
        marketDomainIds: ["crypto"],
        tokenBudget: 200_001,
        watchlistItems: [{ canonicalId: "coingecko:bitcoin" }],
      },
    });
    expect(tooLarge.statusCode).toBe(400);

    const defaultAgent = (
      await ctx.db.select().from(agents).where(eq(agents.kind, "system_default"))
    )[0];
    const removeDefault = await app.inject({
      method: "DELETE",
      url: `/api/v1/agents/${defaultAgent?.id}`,
      headers: { cookie },
    });
    expect(removeDefault.statusCode).toBe(409);

    const shipped = await ctx.db.select().from(skills).where(eq(skills.origin, "shipped"));
    const overwrite = await app.inject({
      method: "POST",
      url: "/api/v1/skills",
      headers: { cookie },
      payload: { slug: shipped[0]?.slug, markdownBody: "Overwrite shipped skill body." },
    });
    expect(overwrite.statusCode).toBe(409);
  });

  it("rejects create and duplicate when RIDDLR_MAX_AGENTS is reached", async () => {
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/agents",
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    const current = (listed.json().agents as unknown[]).length;
    expect(current).toBeGreaterThan(0);
    expect(listed.json().maxAgents).toBe(ctx.config.RIDDLR_MAX_AGENTS);
    const previous = ctx.config.RIDDLR_MAX_AGENTS;
    ctx.config.RIDDLR_MAX_AGENTS = current;
    try {
      const capped = await app.inject({
        method: "GET",
        url: "/api/v1/agents",
        headers: { cookie },
      });
      expect(capped.json().maxAgents).toBe(current);
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/agents",
        headers: { cookie },
        payload: {
          name: "Overflow desk",
          marketDomainIds: ["crypto"],
          schedule: "1h",
        },
      });
      expect(created.statusCode).toBe(400);
      expect(created.json()).toEqual({
        error: {
          code: "agent_limit",
          message: `At most ${current} agents can exist.`,
        },
      });
      const sourceId = await firstAgentId(ctx);
      const duplicated = await app.inject({
        method: "POST",
        url: `/api/v1/agents/${sourceId}/duplicate`,
        headers: { cookie },
      });
      expect(duplicated.statusCode).toBe(400);
      expect(duplicated.json()).toEqual({
        error: {
          code: "agent_limit",
          message: `At most ${current} agents can exist.`,
        },
      });
    } finally {
      ctx.config.RIDDLR_MAX_AGENTS = previous;
    }
  });

  it("skips analysis when the agent daily token budget is exhausted", async () => {
    const [agent] = await ctx.db.select().from(agents).where(eq(agents.kind, "system_default"));
    expect(agent?.id).toBeDefined();
    await ctx.db
      .update(agents)
      .set({ tokenBudget: 4_000 })
      .where(eq(agents.id, agent?.id as string));
    await ctx.db.insert(aiUsageEvents).values({
      agentId: agent?.id,
      provider: "openai_compatible",
      model: "fixture",
      promptTokens: 4_000,
      completionTokens: 1,
    });
    const [scan] = await ctx.db
      .insert(scans)
      .values({
        agentId: agent?.id as string,
        status: "queued",
        windowStart: new Date("2026-02-01T00:00:00.000Z"),
        idempotencyKey: "pipeline:crypto:budget-skip",
      })
      .returning();
    const before = (await ctx.db.select().from(signals)).length;
    let llmCalled = false;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("api.coingecko.com")) {
        return coinGeckoMarketsResponse();
      }
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nDisallow:", { status: 404 });
      }
      if (url.includes("/search")) {
        return Response.json({
          results: [
            {
              url: "https://example.com/budget-skip",
              title: "Bitcoin ETF inflows accelerate",
              content:
                "Bitcoin demand rose after reported ETF inflows covering US listed products.",
              engine: "fixture",
            },
            {
              url: "https://news.example.com/budget-skip",
              title: "Bitcoin ETF inflows rose after latest issuer filing",
              content:
                "Bitcoin demand rose after reported ETF inflows covering US listed products.",
              engine: "fixture",
            },
          ],
        });
      }
      if (url.startsWith("https://example.com/") || url.startsWith("https://news.example.com/")) {
        return new Response(
          fixtureArticleHtml(
            "Bitcoin ETF inflows accelerate",
            "Bitcoin ETF inflows covering US listed products rose.",
          ),
          { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
      if (url.includes("/v1/chat/completions") || url.includes("/v1/messages")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          response_format?: { json_schema?: { name?: string } };
        };
        if (body.response_format?.json_schema?.name === "content_understanding") {
          return Response.json({
            id: "chatcmpl-understanding-budget",
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "The article reports Bitcoin ETF inflows into US listed products.",
                    pageClass: "news_report",
                    headlineBodyConsistent: true,
                    attributedToOtherOrigin: false,
                    claims: [
                      {
                        kind: "listing_or_delisting",
                        predicate: "listing_or_delisting",
                        polarity: "asserted",
                        modality: "asserted",
                        excerpt: "ETF inflows",
                        subjectCanonicalId: "coingecko:bitcoin",
                      },
                    ],
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 80, completion_tokens: 40 },
          });
        }
        llmCalled = true;
        throw new Error("analysis LLM must not be called when the token budget is exhausted");
      }
      return new Response("unexpected fetch", { status: 404 });
    };
    await runScan(ctx, scan?.id as string, { fetchImpl });
    expect(llmCalled).toBe(false);
    const after = (await ctx.db.select().from(signals)).length;
    expect(after).toBe(before);
    const eventRows = await ctx.db
      .select()
      .from(events)
      .where(eq(events.scanId, scan?.id as string));
    expect(eventRows.some((row) => row.status === "needs_analysis")).toBe(true);
    await ctx.db.delete(aiUsageEvents).where(eq(aiUsageEvents.agentId, agent?.id as string));
    await ctx.db
      .update(agents)
      .set({ tokenBudget: 100_000 })
      .where(eq(agents.id, agent?.id as string));
  });

  it("analyzes when the agent daily token budget is unlimited even after heavy usage", async () => {
    const [agent] = await ctx.db.select().from(agents).where(eq(agents.kind, "system_default"));
    expect(agent?.id).toBeDefined();
    await ctx.db
      .update(agents)
      .set({ tokenBudget: null })
      .where(eq(agents.id, agent?.id as string));
    await ctx.db.insert(aiUsageEvents).values({
      agentId: agent?.id,
      provider: "openai_compatible",
      model: "fixture",
      promptTokens: 900_000,
      completionTokens: 1,
    });
    const [scan] = await ctx.db
      .insert(scans)
      .values({
        agentId: agent?.id as string,
        status: "queued",
        windowStart: new Date("2026-03-01T00:00:00.000Z"),
        idempotencyKey: "pipeline:crypto:budget-unlimited",
      })
      .returning();
    let llmCalled = false;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("api.coingecko.com")) {
        return coinGeckoMarketsResponse();
      }
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nDisallow:", { status: 404 });
      }
      if (url.includes("/search")) {
        return Response.json({
          results: [
            {
              url: "https://example.com/budget-unlimited",
              title: "Bitcoin ETF inflows accelerate",
              content:
                "Bitcoin demand rose after reported ETF inflows covering US listed products.",
              engine: "fixture",
            },
            {
              url: "https://news.example.com/budget-unlimited",
              title: "Bitcoin ETF inflows rose after latest issuer filing",
              content:
                "Bitcoin demand rose after reported ETF inflows covering US listed products.",
              engine: "fixture",
            },
          ],
        });
      }
      if (url.startsWith("https://example.com/") || url.startsWith("https://news.example.com/")) {
        return new Response(
          fixtureArticleHtml(
            "Bitcoin ETF inflows accelerate",
            "Bitcoin ETF inflows covering US listed products rose.",
          ),
          { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
      if (url.includes("/v1/chat/completions")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          messages?: Array<{ role?: string; content?: string }>;
          response_format?: { json_schema?: { name?: string } };
        };
        if (body.response_format?.json_schema?.name === "content_understanding") {
          return Response.json({
            id: "chatcmpl-understanding-unlimited",
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "The article reports Bitcoin ETF inflows into US listed products.",
                    pageClass: "news_report",
                    headlineBodyConsistent: true,
                    attributedToOtherOrigin: false,
                    claims: [
                      {
                        kind: "listing_or_delisting",
                        predicate: "listing_or_delisting",
                        polarity: "asserted",
                        modality: "asserted",
                        excerpt: "ETF inflows",
                        subjectCanonicalId: "coingecko:bitcoin",
                      },
                    ],
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 80, completion_tokens: 40 },
          });
        }
        llmCalled = true;
        const user = body.messages?.find((item) => item.role === "user")?.content ?? "";
        const { evidenceIds: ids, claimIds } = proofIdsFromAnalysisPrompt(user);
        return Response.json({
          id: "chatcmpl-unlimited",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  headline: "Unlimited budget still analyzes material events",
                  whyItMatters:
                    "Independent search results describe the same Bitcoin demand shift.",
                  proof: {
                    evidenceIds: ids.slice(0, 1),
                    claimIds: claimIds.slice(0, 1),
                    summary: "SearXNG titles independently describe Bitcoin ETF inflows.",
                  },
                  action: "Watch ETF flow reporting; do not trade.",
                  risk: "moderate",
                  confidence: 0.62,
                  assets: ["coingecko:bitcoin"],
                  eventType: "listing_or_delisting",
                  marketContext: "Crypto domain context from extracted Bitcoin mentions.",
                  contradictoryEvidence: "No contradictory evidence in this fixture.",
                  invalidationConditions: "Inflows reverse or coverage is retracted.",
                }),
              },
            },
          ],
          usage: { prompt_tokens: 120, completion_tokens: 80 },
        });
      }
      return new Response("unexpected fetch", { status: 404 });
    };
    await runScan(ctx, scan?.id as string, { fetchImpl });
    expect(llmCalled).toBe(true);
    await ctx.db.delete(aiUsageEvents).where(eq(aiUsageEvents.agentId, agent?.id as string));
    await ctx.db
      .update(agents)
      .set({ tokenBudget: 100_000 })
      .where(eq(agents.id, agent?.id as string));
  });

  it("stores an encrypted Discord source, redacts the token, and polls official REST messages", async () => {
    const token = "discord-bot-token-fixture-secret";
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/sources/discord",
      headers: { cookie },
      payload: {
        name: "Crypto Discord",
        botToken: token,
        guildId: "222222222222222222",
        channelIds: ["111111111111111111"],
        lookbackHours: 6,
      },
    });
    expect(created.statusCode).toBe(200);
    expect(JSON.stringify(created.json())).not.toContain(token);
    const [discordAgent] = await ctx.db
      .select()
      .from(agents)
      .where(eq(agents.kind, "system_default"));
    const discordSourceId = created.json().source?.id as string;
    if (discordSourceId && discordAgent?.id) {
      await ctx.db
        .insert(agentSources)
        .values({ agentId: discordAgent.id, sourceId: discordSourceId })
        .onConflictDoNothing();
    }
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/sources",
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(JSON.stringify(listed.json())).not.toContain(token);
    const discordAdapter = listed
      .json()
      .adapters.find((item: { id: string }) => item.id === "discord");
    expect(discordAdapter.inviteUrl).toBeUndefined();
    expect(discordAdapter.botPermissions).toBe(66560);
    expect(discordAdapter.capabilities.lookbackNotes).toMatch(/not guild message-search archive/);
    const secrets = await ctx.db.select().from(encryptedSecrets);
    expect(
      secrets.some((row) => row.purpose === "discord" && !row.ciphertext.includes(token)),
    ).toBe(true);

    const [agent] = await ctx.db.select().from(agents).where(eq(agents.kind, "system_default"));
    const [scan] = await ctx.db
      .insert(scans)
      .values({
        agentId: agent?.id as string,
        status: "queued",
        windowStart: new Date("2026-03-01T00:00:00.000Z"),
        idempotencyKey: "pipeline:crypto:discord-1",
      })
      .returning();
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("api.coingecko.com")) {
        return coinGeckoMarketsResponse();
      }
      if (url.includes("/search")) {
        return Response.json({ results: [] });
      }
      if (url.includes("/channels/") && url.includes("/threads/archived/public")) {
        return Response.json({ threads: [], members: [], has_more: false });
      }
      if (url.includes("/channels/111111111111111111/messages")) {
        return Response.json([
          {
            id: "123456789012345678",
            channel_id: "111111111111111111",
            guild_id: "222222222222222222",
            content: "Independent Discord note about bitcoin ETF inflows",
            timestamp: "2026-09-10T11:00:00.000Z",
            author: { username: "alice" },
          },
        ]);
      }
      return new Response("unexpected fetch", { status: 404 });
    };
    await runScan(ctx, scan?.id as string, { fetchImpl });
    const evidence = await ctx.db.select().from(evidenceItems);
    expect(
      evidence.some((row) => row.canonicalUrl?.includes("discord.com/channels/222222222222222222")),
    ).toBe(true);
  });

  it("stores an encrypted X source and polls official recent search only", async () => {
    const token = "x-bearer-token-fixture-secret";
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/sources/x",
      headers: { cookie },
      payload: {
        name: "Crypto X",
        bearerToken: token,
        authors: ["alice"],
        keywords: ["bitcoin"],
        lookbackHours: 24,
        monthlyReadBudget: 5000,
      },
    });
    expect(created.statusCode).toBe(200);
    expect(JSON.stringify(created.json())).not.toContain(token);
    const [xAgent] = await ctx.db.select().from(agents).where(eq(agents.kind, "system_default"));
    const xSourceId = created.json().source?.id as string;
    if (xSourceId && xAgent?.id) {
      await ctx.db
        .insert(agentSources)
        .values({ agentId: xAgent.id, sourceId: xSourceId })
        .onConflictDoNothing();
    }
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/sources",
      headers: { cookie },
    });
    expect(
      listed.json().adapters.find((item: { id: string }) => item.id === "x").capabilities
        .lookbackNotes,
    ).toMatch(/search\/all/);
    expect(
      listed.json().adapters.find((item: { id: string }) => item.id === "onchain"),
    ).toBeUndefined();
    expect(
      listed.json().adapters.find((item: { id: string }) => item.id === "alchemy").capabilities
        .lookbackNotes,
    ).toMatch(/ADDRESS_ACTIVITY/);
    expect(
      listed.json().adapters.find((item: { id: string }) => item.id === "helius").capabilities
        .lookbackNotes,
    ).toMatch(/TRANSFER/);
    const secrets = await ctx.db.select().from(encryptedSecrets);
    expect(secrets.some((row) => row.purpose === "x" && !row.ciphertext.includes(token))).toBe(
      true,
    );

    const [agent] = await ctx.db.select().from(agents).where(eq(agents.kind, "system_default"));
    const [scan] = await ctx.db
      .insert(scans)
      .values({
        agentId: agent?.id as string,
        status: "queued",
        windowStart: new Date("2026-03-01T00:00:00.000Z"),
        idempotencyKey: "pipeline:crypto:x-1",
      })
      .returning();
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("api.coingecko.com")) {
        return coinGeckoMarketsResponse();
      }
      if (url.includes("/search?") || url.includes("/search")) {
        if (url.includes("api.x.com")) {
          expect(url).toContain("/tweets/search/recent");
          expect(url).not.toContain("search/all");
          expect(decodeURIComponent(url.replaceAll("+", " "))).toContain("from:alice");
          expect(decodeURIComponent(url.replaceAll("+", " "))).toContain("-is:retweet");
          return Response.json({
            data: [
              {
                id: "555",
                text: "Independent X note about bitcoin ETF inflows",
                created_at: "2026-09-10T11:00:00.000Z",
                author_id: "1",
              },
            ],
            includes: { users: [{ id: "1", username: "alice" }] },
          });
        }
        return Response.json({ results: [] });
      }
      return new Response("unexpected fetch", { status: 404 });
    };
    await runScan(ctx, scan?.id as string, { fetchImpl });
    const evidence = await ctx.db.select().from(evidenceItems);
    expect(evidence.some((row) => row.canonicalUrl?.includes("x.com/alice/status/555"))).toBe(true);
  });

  it("stores an RSS/Atom feed, applies official trust, and persists captured items", async () => {
    const feedUrl = "https://www.federalreserve.gov/feeds/press_all.xml";
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/sources/feeds",
      headers: { cookie },
      payload: { name: "Federal Reserve press", feedUrl },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().source?.config?.trustTier).toBe("official_firsthand");
    expect(created.json().source?.config?.feedUrl).toBe(feedUrl);
    const loopback = await app.inject({
      method: "POST",
      url: "/api/v1/sources/feeds",
      headers: { cookie },
      payload: { name: "Loopback feed", feedUrl: "http://127.0.0.1/feed.xml" },
    });
    expect(loopback.statusCode).toBe(400);
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/sources/feeds",
      headers: { cookie },
      payload: { name: "Federal Reserve press again", feedUrl },
    });
    expect(duplicate.statusCode).toBe(409);
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/sources",
      headers: { cookie },
    });
    const feedAdapter = listed.json().adapters.find((item: { id: string }) => item.id === "feeds");
    expect(feedAdapter.capabilities.lookbackNotes).toMatch(/If-None-Match/);
    expect(feedAdapter.suggestedFeeds[0].url).toBe(feedUrl);

    const [agent] = await ctx.db.select().from(agents).where(eq(agents.kind, "system_default"));
    const [scan] = await ctx.db
      .insert(scans)
      .values({
        agentId: agent?.id as string,
        status: "queued",
        windowStart: new Date("2026-03-01T00:00:00.000Z"),
        idempotencyKey: "pipeline:crypto:feeds-1",
      })
      .returning();
    const rss = readFileSync(
      join(
        process.cwd(),
        "packages/source-adapters/test/fixtures/feeds/rss-federalreserve-press-all.xml",
      ),
      "utf8",
    );
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("api.coingecko.com")) {
        return coinGeckoMarketsResponse();
      }
      if (url.includes("/search")) {
        return Response.json({ results: [] });
      }
      if (url.includes("federalreserve.gov/feeds/press_all.xml")) {
        return new Response(rss, {
          status: 200,
          headers: {
            "content-type": "application/rss+xml",
            etag: '"feed-etag"',
            "last-modified": "Fri, 11 Sep 2026 14:00:13 GMT",
          },
        });
      }
      return new Response("unexpected fetch", { status: 404 });
    };
    await runScan(ctx, scan?.id as string, { fetchImpl });
    const evidence = await ctx.db.select().from(evidenceItems);
    expect(
      evidence.some((row) =>
        row.canonicalUrl?.includes(
          "federalreserve.gov/newsevents/pressreleases/bcreg20260911a.htm",
        ),
      ),
    ).toBe(true);
    expect(evidence.some((row) => row.sourceFamily === "feed")).toBe(true);
    const [feedRow] = await ctx.db
      .select()
      .from(sources)
      .where(eq(sources.id, created.json().source?.id as string));
    expect(feedRow?.config.lastEtag).toBe('"feed-etag"');
  });

  it("runs per-asset SearXNG news queries, dedupes URLs, and drops price-tracker hosts", async () => {
    const hosts = await app.inject({
      method: "GET",
      url: "/api/v1/publisher-hosts",
      headers: { cookie },
    });
    expect(hosts.statusCode).toBe(200);
    expect(
      (hosts.json().hosts as Array<{ hostname: string; blocked: boolean }>).some(
        (row) => row.hostname === "coingecko.com" && row.blocked,
      ),
    ).toBe(true);
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/sources",
      headers: { cookie },
    });
    const searx = (
      listed.json().sources as Array<{
        id: string;
        adapterId: string;
        config: { endpoint?: string; engines?: string[] };
      }>
    ).find((row) => row.adapterId === "searxng");
    expect(searx?.id).toBeDefined();
    const endpoint = searx?.config.endpoint;
    const saved = await app.inject({
      method: "PATCH",
      url: `/api/v1/sources/${searx?.id}`,
      headers: { cookie },
      payload: { config: { endpoint: "http://evil.example", engines: "bing news" } },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().source.config.endpoint).toBe(endpoint);
    expect(saved.json().source.config.engines).toEqual(["bing news"]);
    const invalid = await app.inject({
      method: "PATCH",
      url: `/api/v1/sources/${searx?.id}`,
      headers: { cookie },
      payload: { config: { engines: "bad;engine" } },
    });
    expect(invalid.statusCode).toBe(400);

    const [agent] = await ctx.db.select().from(agents).where(eq(agents.kind, "system_default"));
    const [scan] = await ctx.db
      .insert(scans)
      .values({
        agentId: agent?.id as string,
        status: "queued",
        windowStart: new Date("2026-04-01T00:00:00.000Z"),
        idempotencyKey: "pipeline:crypto:searxng-news-1",
      })
      .returning();
    const searchUrls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("api.coingecko.com")) {
        return coinGeckoMarketsResponse();
      }
      let pathname = "";
      try {
        pathname = new URL(url).pathname;
      } catch {
        pathname = "";
      }
      if (pathname === "/search" || pathname === "/search/") {
        searchUrls.push(url);
        return Response.json({
          results: [
            {
              url: "https://www.coingecko.com/en/coins/bitcoin",
              title: "Bitcoin price today",
              content: "Bitcoin is quoted at USD on the tracker page.",
              engine: "fixture",
            },
            {
              url: "https://news.example.com/per-asset-news",
              title: "Bitcoin filing details today after the issuer update",
              content: "The filing said Bitcoin demand rose after reported ETF inflows.",
              engine: "fixture",
            },
          ],
        });
      }
      return new Response("unexpected fetch", { status: 404 });
    };
    await runScan(ctx, scan?.id as string, { fetchImpl });
    expect(searchUrls).toHaveLength(4);
    for (const url of searchUrls) {
      expect(url).toContain("categories=news");
      expect(url).toContain("language=en");
      expect(url).toContain("time_range=day");
      expect(url).toMatch(/engines=bing(\+|%20)news/);
    }
    const queries = searchUrls.map((url) => new URL(url).searchParams.get("q") ?? "");
    expect(queries.some((query) => query.includes('"Bitcoin" OR "BTC"'))).toBe(true);
    expect(queries.some((query) => query.includes('"Ethereum" OR "ETH"'))).toBe(true);
    expect(queries.some((query) => query.includes('"Tether" OR "USDT"'))).toBe(true);
    expect(
      queries.some((query) => query.includes("cryptocurrency bitcoin ethereum stablecoin news")),
    ).toBe(true);
    const evidence = await ctx.db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.scanId, scan?.id as string));
    expect(
      evidence.filter((row) => row.canonicalUrl?.includes("news.example.com/per-asset-news")),
    ).toHaveLength(1);
    expect(evidence.some((row) => row.canonicalUrl?.includes("coingecko.com"))).toBe(false);
    const seeded = await ctx.db
      .select()
      .from(publisherHostPolicies)
      .where(eq(publisherHostPolicies.hostname, "coingecko.com"))
      .limit(1);
    expect(seeded[0]?.blocked).toBe(true);
  });

  it("rejects seed phrases on portfolios and records WhatsApp inbound windows", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/portfolios",
      headers: { cookie },
      payload: { name: "Cold storage book" },
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().portfolio.id as string;
    const seed = await app.inject({
      method: "POST",
      url: `/api/v1/portfolios/${id}/wallets`,
      headers: { cookie },
      payload: {
        chain: "ethereum",
        address:
          "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      },
    });
    expect(seed.statusCode).toBe(400);
    const wallet = await app.inject({
      method: "POST",
      url: `/api/v1/portfolios/${id}/wallets`,
      headers: { cookie },
      payload: {
        chain: "ethereum",
        address: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
      },
    });
    expect(wallet.statusCode).toBe(200);
    const holding = await app.inject({
      method: "POST",
      url: `/api/v1/portfolios/${id}/holdings`,
      headers: { cookie },
      payload: { canonicalId: "coingecko:bitcoin", quantity: "1.5" },
    });
    expect(holding.statusCode).toBe(200);
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/portfolios",
      headers: { cookie },
    });
    expect(listed.json().onchain.implemented).toBe(false);

    const verify = await app.inject({
      method: "POST",
      url: "/api/v1/settings/whatsapp",
      headers: { cookie },
      payload: {
        accessToken: "whatsapp-access-token-fixture",
        appSecret: "whatsapp-app-secret-fixture",
        phoneNumberId: "123456789012345",
        to: "15551234567",
        templateName: "riddlr_signal",
        templateLanguage: "en_US",
        verifyToken: "verify-token-fixture",
      },
    });
    expect(verify.statusCode).toBe(200);
    const challenge = await app.inject({
      method: "GET",
      url: "/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token-fixture&hub.challenge=abc123",
    });
    expect(challenge.statusCode).toBe(200);
    expect(challenge.body).toBe("abc123");
    const unsigned = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/whatsapp",
      payload: {
        entry: [
          {
            changes: [{ value: { messages: [{ from: "15551234567", timestamp: "1690000000" }] } }],
          },
        ],
      },
    });
    expect(unsigned.statusCode).toBe(403);
    const inboundTs = String(Math.floor(Date.now() / 1000));
    const inboundBody = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: "15551234567", timestamp: inboundTs, id: "wamid.fixture" }],
              },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(inboundBody);
    const inbound = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/whatsapp",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${hmacSha256Utf8("whatsapp-app-secret-fixture", raw)}`,
      },
      payload: inboundBody,
    });
    expect(inbound.statusCode).toBe(200);
    const sessions = await ctx.db.select().from(whatsappSessions);
    expect(sessions.some((row) => row.toE164 === "15551234567")).toBe(true);
    const unused = await ctx.db.select().from(portfolios);
    expect(unused.length).toBeGreaterThan(0);
  });

  it("backfills aliases onto a pre-0012 assets row", async () => {
    const databaseUrl = ctx.config.RIDDLR_DATABASE_URL;
    const admin = postgres(databaseUrl, { max: 1 });
    await admin.unsafe("CREATE DATABASE riddlr_pre_0012");
    await admin.end();
    const migrateUrl = databaseUrl.replace(/\/riddlr$/, "/riddlr_pre_0012");
    const sql = postgres(migrateUrl, { max: 1 });
    const dir = join(process.cwd(), "packages/db/drizzle");
    const files = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const file of files) {
      if (file >= "0012_asset_registry.sql") {
        continue;
      }
      const migration = readFileSync(join(dir, file), "utf8")
        .replace(/^\s*BEGIN\s*;/i, "")
        .replace(/\bCOMMIT\s*;\s*$/i, "");
      await sql.begin(async (tx) => {
        await tx.unsafe(migration);
      });
    }
    await sql.unsafe(`
      INSERT INTO assets (asset_class, canonical_id, symbol, name)
      VALUES ('cryptocurrency', 'coingecko:litecoin', 'LTC', 'Litecoin')
    `);
    const registryMigration = readFileSync(join(dir, "0012_asset_registry.sql"), "utf8")
      .replace(/^\s*BEGIN\s*;/i, "")
      .replace(/\bCOMMIT\s*;\s*$/i, "");
    await sql.begin(async (tx) => {
      await tx.unsafe(registryMigration);
    });
    const [row] = await sql<
      {
        aliases: string[];
        status: string;
      }[]
    >`
      SELECT aliases, status FROM assets WHERE canonical_id = 'coingecko:litecoin'
    `;
    expect(row?.status).toBe("active");
    expect(row?.aliases).toEqual(expect.arrayContaining(["ltc", "litecoin", "$ltc"]));
    await sql.end();
  });

  it("seeds the CoinGecko registry from fixtures and resolves a seeded watchlist asset", async () => {
    const fixtures = join(process.cwd(), "packages/source-adapters/test/fixtures/coingecko");
    const markets = JSON.parse(
      readFileSync(join(fixtures, "markets-page1.json"), "utf8"),
    ) as unknown;
    const list = JSON.parse(
      readFileSync(join(fixtures, "coins-list-truncated.json"), "utf8"),
    ) as unknown;
    const fetchImpl: typeof fetch = async (input) => {
      const href = String(input);
      if (href.includes("/coins/markets")) {
        return Response.json(markets);
      }
      if (href.includes("/coins/list")) {
        return Response.json(list);
      }
      return new Response("not found", { status: 404 });
    };

    const unauth = await app.inject({ method: "GET", url: "/api/v1/assets?q=sol" });
    expect(unauth.statusCode).toBe(401);

    const bootstrap = await app.inject({
      method: "GET",
      url: "/api/v1/assets?q=solana",
      headers: { cookie },
    });
    expect(bootstrap.statusCode).toBe(200);
    expect(
      (bootstrap.json().assets as Array<{ canonicalId: string }>).some(
        (item) => item.canonicalId === "coingecko:solana",
      ),
    ).toBe(true);

    await ctx.db.insert(assets).values([
      {
        assetClass: "cryptocurrency",
        canonicalId: "coingecko:litecoin",
        symbol: "LTC",
        name: "Litecoin",
        aliases: ["ltc", "litecoin"],
        status: "active",
      },
      {
        assetClass: "cryptocurrency",
        canonicalId: "coingecko:pepe",
        symbol: "PEPE",
        name: "Pepe",
        aliases: ["pepe"],
        status: "active",
      },
      {
        assetClass: "stock",
        canonicalId: "sec:0001527613",
        symbol: "IMG",
        name: "CIMG Inc.",
        aliases: ["img", "cimg inc."],
        externalIds: { cik: "0001527613", ticker: "IMG" },
        status: "active",
      },
    ]);
    const [watchlist] = await ctx.db.select().from(watchlists).limit(1);
    expect(watchlist).toBeDefined();
    await ctx.db.insert(watchlistItems).values({
      watchlistId: watchlist?.id as string,
      assetClass: "cryptocurrency",
      canonicalId: "coingecko:pepe",
      symbol: "PEPE",
      name: "Pepe",
    });

    const started = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const first = seedAssetRegistry(ctx, async (input) => {
      started.resolve();
      await gate.promise;
      return fetchImpl(input);
    });
    await started.promise;
    const locked = await seedAssetRegistry(ctx, fetchImpl);
    expect(locked.upserted).toBe(0);
    gate.resolve();
    const seeded = await first;
    expect(seeded.error).toBeUndefined();
    expect(seeded.upserted).toBeGreaterThan(0);

    const limited = await seedAssetRegistry(
      ctx,
      async () => new Response("rate limited", { status: 429 }),
    );
    expect(limited.error).toContain("rate_limited");

    expect((await findRegistryAsset(ctx, "coingecko:litecoin"))?.status).toBe("inactive");
    expect((await findRegistryAsset(ctx, "coingecko:pepe"))?.status).toBe("active");
    expect((await findRegistryAsset(ctx, "sec:0001527613"))?.status).toBe("active");

    const search = await app.inject({
      method: "GET",
      url: "/api/v1/assets?q=zcash",
      headers: { cookie },
    });
    expect(search.statusCode).toBe(200);
    expect(
      (search.json().assets as Array<{ canonicalId: string }>).map((item) => item.canonicalId),
    ).toContain("coingecko:zcash");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/agents",
      headers: { cookie },
      payload: {
        name: "Zcash watcher",
        marketDomainIds: ["crypto"],
        watchlistItems: [{ canonicalId: "coingecko:zcash" }],
      },
    });
    expect(created.statusCode).toBe(200);
    expect(
      (created.json().agent.watchlist.items as Array<{ canonicalId: string }>).map(
        (item) => item.canonicalId,
      ),
    ).toEqual(["coingecko:zcash"]);

    const unknown = await app.inject({
      method: "POST",
      url: "/api/v1/agents",
      headers: { cookie },
      payload: {
        name: "Unknown coin watcher",
        marketDomainIds: ["crypto"],
        watchlistItems: [{ canonicalId: "coingecko:not-a-listed-coin" }],
      },
    });
    expect(unknown.statusCode).toBe(400);

    const registry = await listRegistryAssets(ctx);
    const extracted = cryptoDomainModule.extractAssets(
      [
        normalizeEvidence({
          sourceFamily: "search",
          adapterId: "searxng",
          title: "Zcash validators halted",
          bodyText: "ZEC halted after the upgrade.",
          fetchedAt: new Date("2026-09-13T00:00:00Z"),
        }),
      ],
      registry,
    );
    expect(extracted.map((item) => item.canonicalId)).toEqual(["coingecko:zcash"]);
  });

  it("polls observation series from fixtures, refuses zeros on 429, and fires return-shock", async () => {
    const fixtures = join(process.cwd(), "packages/source-adapters/test/fixtures/coingecko");
    const simple = JSON.parse(readFileSync(join(fixtures, "simple-price.json"), "utf8")) as unknown;
    await ctx.redis.del(`riddlr:observe:lock:${COINGECKO_SPOT_PROVIDER_ID}`);

    const unauth = await app.inject({ method: "GET", url: "/api/v1/observations/latest" });
    expect(unauth.statusCode).toBe(401);

    const first = await pollObservationProvider(ctx, COINGECKO_SPOT_PROVIDER_ID, async (input) => {
      const href = String(input);
      if (href.includes("/simple/price")) {
        return Response.json(simple);
      }
      return new Response("not found", { status: 404 });
    });
    expect(first.error).toBeUndefined();
    expect(first.observations).toBeGreaterThan(0);

    const locked = await pollObservationProvider(ctx, COINGECKO_SPOT_PROVIDER_ID, async () =>
      Response.json(simple),
    );
    expect(locked.error).toBe("lock_held");

    await ctx.redis.del(`riddlr:observe:lock:${COINGECKO_SPOT_PROVIDER_ID}`);
    const duplicate = await pollObservationProvider(ctx, COINGECKO_SPOT_PROVIDER_ID, async () =>
      Response.json(simple),
    );
    expect(duplicate.observations).toBe(0);

    await ctx.redis.del(`riddlr:observe:lock:${COINGECKO_SPOT_PROVIDER_ID}`);
    const limited = await pollObservationProvider(
      ctx,
      COINGECKO_SPOT_PROVIDER_ID,
      async () => new Response("rate limited", { status: 429 }),
    );
    expect(limited.error).toBe("rate_limited");
    const after429 = await ctx.db
      .select()
      .from(observationSeries)
      .where(eq(observationSeries.subjectCanonicalId, "coingecko:bitcoin"));
    expect(after429.some((row) => row.value === 0)).toBe(false);

    const quotes = await app.inject({
      method: "GET",
      url: "/api/v1/watchlists",
      headers: { cookie },
    });
    expect(quotes.statusCode).toBe(200);
    const items = (
      quotes.json().watchlists as Array<{ items: Array<{ lastQuote?: { value: number } }> }>
    ).flatMap((list) => list.items ?? []);
    expect(items.some((item) => item.lastQuote?.value === 77333)).toBe(true);

    const health = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { cookie },
    });
    expect(health.statusCode).toBe(200);
    expect(health.json().observations?.provider).toBe(COINGECKO_SPOT_PROVIDER_ID);
    expect(health.json().observations?.seriesCount).toBeGreaterThan(0);

    const beforeShock = await ctx.db
      .select()
      .from(events)
      .where(eq(events.reliabilityStatus, "observed"));
    expect(
      beforeShock.some(
        (row) => row.title === "bitcoin 4.25σ spot price return shock (v1, threshold 3σ)",
      ),
    ).toBe(false);

    const unknownPin = await app.inject({
      method: "POST",
      url: "/api/v1/observations/pins",
      headers: { cookie },
      payload: { subjectCanonicalId: "coingecko:does-not-exist" },
    });
    expect(unknownPin.statusCode).toBe(400);

    await ctx.db
      .delete(observationSeries)
      .where(
        and(
          eq(observationSeries.subjectCanonicalId, "coingecko:bitcoin"),
          eq(observationSeries.metric, "spot_price"),
          eq(observationSeries.resolution, "raw"),
        ),
      );
    const origin = 1_789_322_000 * 1000 - 20 * 60_000;
    await ctx.db.insert(observationSeries).values(
      Array.from({ length: 20 }, (_, index) => ({
        provider: COINGECKO_SPOT_PROVIDER_ID,
        metric: "spot_price",
        subjectCanonicalId: "coingecko:bitcoin",
        observedAt: new Date(origin + index * 60_000),
        value: 100,
        unit: "usd",
        resolution: "raw",
      })),
    );
    await ctx.db.insert(observationSeries).values(
      Array.from({ length: 20 }, (_, index) => ({
        provider: COINGECKO_SPOT_PROVIDER_ID,
        metric: "quoted_volume",
        subjectCanonicalId: "coingecko:bitcoin",
        observedAt: new Date(origin + index * 60_000),
        value: index === 19 ? 100 : 10,
        unit: "usd",
        resolution: "raw",
      })),
    );
    ctx.observationProviders = new ObservationProviderRegistry();
    ctx.observationProviders.register(
      createScriptedObservationProvider({
        id: COINGECKO_SPOT_PROVIDER_ID,
        observe: () => ({
          observations: [
            {
              provider: COINGECKO_SPOT_PROVIDER_ID,
              metric: "spot_price",
              subjectCanonicalId: "coingecko:bitcoin",
              value: 110,
              unit: "usd",
              observedAt: new Date(1_789_322_000 * 1000 + 60_000),
            },
          ],
          partial: false,
          errors: [],
        }),
      }),
    );
    await ctx.redis.del(`riddlr:observe:lock:${COINGECKO_SPOT_PROVIDER_ID}`);
    const shocked = await pollObservationProvider(ctx, COINGECKO_SPOT_PROVIDER_ID);
    expect(shocked.error).toBeUndefined();
    const detectorEvidence = await ctx.db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.sourceFamily, "observation"));
    expect(detectorEvidence.some((row) => row.bodyText?.includes("return_shock"))).toBe(true);
    expect(
      detectorEvidence.every(
        (row) => !row.canonicalUrl || row.canonicalUrl.startsWith("riddlr:observation/"),
      ),
    ).toBe(true);

    const observedEvents = await ctx.db
      .select()
      .from(events)
      .where(eq(events.reliabilityStatus, "observed"));
    const observed = observedEvents.find(
      (row) => row.title === "bitcoin 4.25σ spot price return shock (v1, threshold 3σ)",
    );
    expect(observed).toBeDefined();
    expect(observed?.materialityReason).toBe("observed_anomaly");
    expect(observed?.title).toBe("bitcoin 4.25σ spot price return shock (v1, threshold 3σ)");
    expect(observed?.status).toBe("needs_analysis");
    expect(observed?.epistemicStatus).toBe("observed");

    const linkedEvidence = await ctx.db
      .select({
        sourceFamily: evidenceItems.sourceFamily,
        canonicalUrl: evidenceItems.canonicalUrl,
        adapterId: evidenceItems.adapterId,
      })
      .from(eventEvidence)
      .innerJoin(evidenceItems, eq(eventEvidence.evidenceId, evidenceItems.id))
      .where(eq(eventEvidence.eventId, observed?.id as string));
    expect(linkedEvidence.length).toBeGreaterThan(0);
    expect(linkedEvidence.every((row) => row.sourceFamily === "observation")).toBe(true);
    expect(linkedEvidence.some((row) => row.canonicalUrl?.includes("https://"))).toBe(false);

    const eventClaimRows = await ctx.db
      .select({ kind: claims.kind, objectText: claims.objectText, title: claims.title })
      .from(eventClaims)
      .innerJoin(claims, eq(eventClaims.claimId, claims.id))
      .where(eq(eventClaims.eventId, observed?.id as string));
    expect(eventClaimRows.some((row) => row.kind === "crypto:observed_spot_price_anomaly")).toBe(
      true,
    );
    expect(eventClaimRows.some((row) => row.kind === "crypto:observed_quoted_volume_anomaly")).toBe(
      true,
    );

    const snapshot = await ctx.db
      .select()
      .from(observations)
      .where(eq(observations.eventId, observed?.id as string));
    expect(snapshot.some((row) => row.kind === "quoted_price" && row.value === 110)).toBe(true);

    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/events?limit=50",
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(
      (listed.json().events as Array<{ reliabilityStatus: string; catalystKind?: string }>).some(
        (row) => row.reliabilityStatus === "observed" && row.catalystKind === "observed_anomaly",
      ),
    ).toBe(true);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/events/${observed?.id}`,
      headers: { cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().event.reliabilityStatus).toBe("observed");
    expect(detail.json().event.catalystKind).toBe("observed_anomaly");
    expect(detail.json().event.lifecycleState).toBe("open");
    expect(detail.json().event.identityKey).toBeTruthy();
    expect((detail.json().lifecycle as unknown[]).length).toBeGreaterThan(0);
    expect(
      (detail.json().claims as Array<{ catalystKind?: string }>).some(
        (row) => row.catalystKind === "observed_anomaly",
      ),
    ).toBe(true);
    expect((detail.json().observations as unknown[]).length).toBeGreaterThan(0);

    await ctx.redis.del(`riddlr:observe:lock:${COINGECKO_SPOT_PROVIDER_ID}`);
    const again = await pollObservationProvider(ctx, COINGECKO_SPOT_PROVIDER_ID);
    expect(again.error).toBeUndefined();
    const stillOne = await ctx.db
      .select()
      .from(events)
      .where(eq(events.reliabilityStatus, "observed"));
    const stillShock = stillOne.filter((row) => row.id === observed?.id);
    expect(stillShock).toHaveLength(1);
    expect(stillShock[0]?.lifecycleState).toBe("open");
    const notifiedAt = new Date("2026-09-13T00:00:00.000Z");
    const plus24h = new Date("2026-09-14T00:00:00.000Z");
    await ctx.db
      .update(events)
      .set({ firstNotifiedAt: notifiedAt, subjectCanonicalId: "coingecko:bitcoin" })
      .where(eq(events.id, observed?.id as string));
    await ctx.db.insert(observationSeries).values([
      {
        provider: "coingecko-spot",
        metric: "spot_price",
        subjectCanonicalId: "coingecko:bitcoin",
        observedAt: notifiedAt,
        value: 100,
        unit: "usd",
      },
      {
        provider: "coingecko-spot",
        metric: "spot_price",
        subjectCanonicalId: "coingecko:bitcoin",
        observedAt: plus24h,
        value: 110,
        unit: "usd",
      },
    ]);
    await recordDueOutcomes(ctx, new Date("2026-09-14T00:10:00.000Z"));
    const recordedOutcomes = await ctx.db
      .select()
      .from(signalOutcomes)
      .where(eq(signalOutcomes.eventId, observed?.id as string));
    expect(
      recordedOutcomes.some(
        (row) => row.horizon === "24h" && row.metric === "spot_price" && row.deltaPct === 10,
      ),
    ).toBe(true);
    const scorecard = await app.inject({
      method: "GET",
      url: "/api/v1/scorecard",
      headers: { cookie },
    });
    expect(scorecard.statusCode).toBe(200);
    expect(Array.isArray(scorecard.json().scorecard)).toBe(true);
    const scorecardRows = scorecard.json().scorecard as Array<{
      retractionRate?: number;
      identityDisplayName?: string | null;
    }>;
    expect(
      scorecardRows.every(
        (row) => row.retractionRate === undefined || typeof row.retractionRate === "number",
      ),
    ).toBe(true);

    const unauthMorning = await app.inject({ method: "GET", url: "/api/v1/morning" });
    expect(unauthMorning.statusCode).toBe(401);
    const morning = await app.inject({
      method: "GET",
      url: "/api/v1/morning?since=not-a-date",
      headers: { cookie },
    });
    expect(morning.statusCode).toBe(200);
    const morningBody = morning.json() as {
      assets: Array<{ canonicalId: string; spark?: unknown[]; change24hPct?: number }>;
      since: string;
    };
    expect(Array.isArray(morningBody.assets)).toBe(true);
    expect(morningBody.assets.some((item) => item.canonicalId === "coingecko:bitcoin")).toBe(true);
    const futureMorning = await app.inject({
      method: "GET",
      url: "/api/v1/morning?since=2099-01-01T00:00:00.000Z",
      headers: { cookie },
    });
    expect(futureMorning.statusCode).toBe(200);
    expect(typeof futureMorning.json().since).toBe("string");
    const missingDesk = await app.inject({
      method: "GET",
      url: "/api/v1/asset-desk?canonicalId=coingecko:this-asset-is-not-registered",
      headers: { cookie },
    });
    expect(missingDesk.statusCode).toBe(404);
    const desk = await app.inject({
      method: "GET",
      url: "/api/v1/asset-desk?canonicalId=coingecko:bitcoin",
      headers: { cookie },
    });
    expect(desk.statusCode).toBe(200);
    expect(desk.json().asset.canonicalId).toBe("coingecko:bitcoin");
    expect(Array.isArray(desk.json().series.spot_price)).toBe(true);
    const series = await app.inject({
      method: "GET",
      url: "/api/v1/observation-series?subject=coingecko:bitcoin&metric=spot_price",
      headers: { cookie },
    });
    expect(series.statusCode).toBe(200);
    expect(Array.isArray(series.json().points)).toBe(true);
    const emptySeries = await app.inject({
      method: "GET",
      url: "/api/v1/observation-series?subject=coingecko:this-asset-is-not-registered&metric=spot_price",
      headers: { cookie },
    });
    expect(emptySeries.statusCode).toBe(200);
    expect(emptySeries.json().points).toEqual([]);

    await ctx.db
      .delete(observationSeries)
      .where(
        and(
          eq(observationSeries.subjectCanonicalId, "coingecko:bitcoin"),
          eq(observationSeries.metric, "spot_price"),
          eq(observationSeries.resolution, "raw"),
        ),
      );
    const downOrigin = 1_789_322_000 * 1000 + 2 * 60_000;
    await ctx.db.insert(observationSeries).values(
      Array.from({ length: 20 }, (_, index) => ({
        provider: COINGECKO_SPOT_PROVIDER_ID,
        metric: "spot_price",
        subjectCanonicalId: "coingecko:bitcoin",
        observedAt: new Date(downOrigin + index * 60_000),
        value: 110,
        unit: "usd",
        resolution: "raw",
      })),
    );
    ctx.observationProviders = new ObservationProviderRegistry();
    ctx.observationProviders.register(
      createScriptedObservationProvider({
        id: COINGECKO_SPOT_PROVIDER_ID,
        observe: () => ({
          observations: [
            {
              provider: COINGECKO_SPOT_PROVIDER_ID,
              metric: "spot_price",
              subjectCanonicalId: "coingecko:bitcoin",
              value: 90,
              unit: "usd",
              observedAt: new Date(downOrigin + 20 * 60_000),
            },
          ],
          partial: false,
          errors: [],
        }),
      }),
    );
    await ctx.redis.del(`riddlr:observe:lock:${COINGECKO_SPOT_PROVIDER_ID}`);
    const reversed = await pollObservationProvider(ctx, COINGECKO_SPOT_PROVIDER_ID);
    expect(reversed.error).toBeUndefined();
    const afterReverse = await ctx.db
      .select()
      .from(events)
      .where(eq(events.reliabilityStatus, "observed"));
    expect(
      afterReverse.filter(
        (row) => row.id === observed?.id || row.title.includes("spot price return shock"),
      ),
    ).toHaveLength(1);
    const polarities = await ctx.db
      .select({ objectText: claims.objectText })
      .from(eventClaims)
      .innerJoin(claims, eq(eventClaims.claimId, claims.id))
      .where(eq(eventClaims.eventId, observed?.id as string));
    expect(polarities.some((row) => row.objectText?.startsWith("up "))).toBe(true);
    expect(polarities.some((row) => row.objectText?.startsWith("down "))).toBe(true);

    await ctx.db.insert(observationSeries).values({
      provider: COINGECKO_SPOT_PROVIDER_ID,
      metric: "spot_price",
      subjectCanonicalId: "coingecko:bitcoin",
      observedAt: new Date("2025-01-01T00:00:00.000Z"),
      value: 90,
      unit: "usd",
      resolution: "raw",
    });
    const retained = await retainObservationSeries(ctx);
    expect(retained.deleted).toBeGreaterThan(0);
    const daily = await ctx.db
      .select()
      .from(observationSeries)
      .where(eq(observationSeries.resolution, "daily"));
    expect(daily.some((row) => row.value === 90)).toBe(true);
  });

  it("creates an opt-in DefiLlama source and polls captured TVL, stables, and chain series", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/sources/defillama",
      headers: { cookie },
      payload: { name: "DefiLlama", chainSlugs: ["Ethereum"], protocolSlugs: ["aave"] },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().source?.adapterId).toBe("defillama");
    expect(created.json().source?.config?.chainSlugs).toEqual(["Ethereum"]);
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/sources/defillama",
      headers: { cookie },
      payload: { name: "DefiLlama again", chainSlugs: ["Ethereum"] },
    });
    expect(duplicate.statusCode).toBe(409);
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/sources",
      headers: { cookie },
    });
    const adapter = listed.json().adapters.find((item: { id: string }) => item.id === "defillama");
    expect(adapter.capabilities.lookbackNotes).toMatch(/Personal, non-commercial/);

    const fixtures = join(process.cwd(), "packages/source-adapters/test/fixtures/defillama");
    const protocols = JSON.parse(readFileSync(join(fixtures, "protocols-truncated.json"), "utf8"));
    const detail = JSON.parse(readFileSync(join(fixtures, "protocol-aave.json"), "utf8"));
    const stables = JSON.parse(readFileSync(join(fixtures, "stablecoins-truncated.json"), "utf8"));
    const coins = JSON.parse(readFileSync(join(fixtures, "coins-current.json"), "utf8"));
    const hacks = JSON.parse(readFileSync(join(fixtures, "hacks-truncated.json"), "utf8"));
    const hist = JSON.parse(
      readFileSync(join(fixtures, "historical-chain-tvl-ethereum.json"), "utf8"),
    );
    await ctx.redis.del(`riddlr:observe:lock:${DEFILLAMA_PROVIDER_ID}`);
    const polled = await pollObservationProvider(ctx, DEFILLAMA_PROVIDER_ID, async (input) => {
      const url = String(input);
      if (url.endsWith("/protocols")) {
        return Response.json(protocols);
      }
      if (url.includes("/protocol/")) {
        return Response.json(detail);
      }
      if (url.includes("/stablecoins")) {
        return Response.json(stables);
      }
      if (url.includes("/prices/current/")) {
        return Response.json(coins);
      }
      if (url.endsWith("/hacks")) {
        return Response.json(hacks);
      }
      if (url.includes("/historicalChainTvl/Ethereum")) {
        return Response.json(hist);
      }
      return new Response("not found", { status: 404 });
    });
    expect(polled.error).toBeUndefined();
    expect(polled.observations).toBeGreaterThan(0);
    const series = await ctx.db
      .select()
      .from(observationSeries)
      .where(eq(observationSeries.provider, DEFILLAMA_PROVIDER_ID));
    expect(
      series.some((row) => row.metric === "tvl_usd" && row.subjectCanonicalId === "defillama:aave"),
    ).toBe(true);
    expect(
      series.some(
        (row) =>
          row.metric === "chain_tvl_usd" && row.subjectCanonicalId === "defillama:chain:Ethereum",
      ),
    ).toBe(true);
    expect(
      series.some(
        (row) => row.metric === "stablecoin_basis" && row.subjectCanonicalId === "coingecko:tether",
      ),
    ).toBe(true);
  });

  it("creates an opt-in Hyperliquid source and polls captured perp ctxs", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/sources/hyperliquid",
      headers: { cookie },
      payload: { name: "Hyperliquid" },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().source?.adapterId).toBe("hyperliquid");
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/sources/hyperliquid",
      headers: { cookie },
      payload: { name: "Hyperliquid again" },
    });
    expect(duplicate.statusCode).toBe(409);
    const fixtures = join(process.cwd(), "packages/source-adapters/test/fixtures/hyperliquid");
    const meta = JSON.parse(readFileSync(join(fixtures, "meta-and-asset-ctxs.json"), "utf8"));
    const predicted = JSON.parse(readFileSync(join(fixtures, "predicted-fundings.json"), "utf8"));
    await ctx.redis.del(`riddlr:observe:lock:${HYPERLIQUID_PROVIDER_ID}`);
    const polled = await pollObservationProvider(
      ctx,
      HYPERLIQUID_PROVIDER_ID,
      async (_input, init) => {
        const body = typeof init?.body === "string" ? init.body : "";
        if (body.includes("predictedFundings")) {
          return Response.json(predicted);
        }
        return Response.json(meta);
      },
    );
    expect(polled.error).toBeUndefined();
    expect(polled.observations).toBeGreaterThan(0);
    const series = await ctx.db
      .select()
      .from(observationSeries)
      .where(eq(observationSeries.provider, HYPERLIQUID_PROVIDER_ID));
    expect(
      series.some(
        (row) => row.metric === "mark_price" && row.subjectCanonicalId === "coingecko:bitcoin",
      ),
    ).toBe(true);
    expect(
      series.some(
        (row) =>
          row.metric === "funding_predicted_binance_apr" &&
          row.subjectCanonicalId === "coingecko:bitcoin",
      ),
    ).toBe(true);
  });

  it("creates an opt-in Binance USD-M Futures source and polls captured premiumIndex", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/sources/binance-futures",
      headers: { cookie },
      payload: { name: "Binance USD-M Futures" },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().source?.adapterId).toBe("binance-futures");
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/sources/binance-futures",
      headers: { cookie },
      payload: { name: "Binance again" },
    });
    expect(duplicate.statusCode).toBe(409);
    const fixtures = join(process.cwd(), "packages/source-adapters/test/fixtures/binance-futures");
    const premium = JSON.parse(readFileSync(join(fixtures, "premium-index.json"), "utf8"));
    const oi = JSON.parse(readFileSync(join(fixtures, "open-interest-btcusdt.json"), "utf8"));
    await ctx.redis.del(`riddlr:observe:lock:${BINANCE_FUTURES_PROVIDER_ID}`);
    const polled = await pollObservationProvider(
      ctx,
      BINANCE_FUTURES_PROVIDER_ID,
      async (input) => {
        const url = String(input);
        if (url.endsWith("/fapi/v1/premiumIndex")) {
          return Response.json(premium, { headers: { "x-mbx-used-weight-1m": "10" } });
        }
        if (url.includes("/futures/data/")) {
          return new Response(null, {
            status: 301,
            headers: { location: "https://demo.binance.com/en/futures/BTCUSDT" },
          });
        }
        if (url.includes("/fapi/v1/openInterest?symbol=BTCUSDT")) {
          return Response.json(oi);
        }
        return new Response("not found", { status: 404 });
      },
    );
    expect(polled.error).toBeUndefined();
    expect(polled.observations).toBeGreaterThan(0);
    const series = await ctx.db
      .select()
      .from(observationSeries)
      .where(eq(observationSeries.provider, BINANCE_FUTURES_PROVIDER_ID));
    expect(
      series.some(
        (row) => row.metric === "mark_price" && row.subjectCanonicalId === "coingecko:bitcoin",
      ),
    ).toBe(true);
    expect(
      series.some(
        (row) => row.metric === "open_interest" && row.subjectCanonicalId === "coingecko:bitcoin",
      ),
    ).toBe(true);
  });

  it("creates an opt-in Polymarket source and polls captured Gamma and CLOB bodies", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/sources/polymarket",
      headers: { cookie },
      payload: { name: "Polymarket", marketSlugs: ["fed-rate-hike-in-2026"] },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().source?.adapterId).toBe("polymarket");
    expect(created.json().source?.config?.marketSlugs).toEqual(["fed-rate-hike-in-2026"]);
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/sources/polymarket",
      headers: { cookie },
      payload: { name: "Polymarket again" },
    });
    expect(duplicate.statusCode).toBe(409);
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/sources",
      headers: { cookie },
    });
    const adapter = listed.json().adapters.find((item: { id: string }) => item.id === "polymarket");
    expect(adapter.capabilities.lookbackNotes).toMatch(/events\/keyset/);
    const fixtures = join(process.cwd(), "packages/source-adapters/test/fixtures/polymarket");
    const keyset = JSON.parse(readFileSync(join(fixtures, "events-keyset-truncated.json"), "utf8"));
    const market = JSON.parse(readFileSync(join(fixtures, "market-fed-rate-hike.json"), "utf8"));
    const mid = JSON.parse(readFileSync(join(fixtures, "midpoint.json"), "utf8"));
    const hist = JSON.parse(readFileSync(join(fixtures, "prices-history.json"), "utf8"));
    await ctx.redis.del(`riddlr:observe:lock:${POLYMARKET_PROVIDER_ID}`);
    const polled = await pollObservationProvider(ctx, POLYMARKET_PROVIDER_ID, async (input) => {
      const url = String(input);
      if (url.includes("/events/keyset")) {
        return Response.json(keyset);
      }
      if (url.includes("/markets?")) {
        return Response.json(market);
      }
      if (url.includes("/midpoint")) {
        return Response.json(mid);
      }
      if (url.includes("/prices-history")) {
        return Response.json(hist);
      }
      return new Response("not found", { status: 404 });
    });
    expect(polled.error).toBeUndefined();
    expect(polled.observations).toBeGreaterThan(0);
    const series = await ctx.db
      .select()
      .from(observationSeries)
      .where(eq(observationSeries.provider, POLYMARKET_PROVIDER_ID));
    expect(
      series.some(
        (row) =>
          row.metric === "odds_yes" &&
          row.subjectCanonicalId === "polymarket:fed-rate-hike-in-2026" &&
          row.value === 0.905,
      ),
    ).toBe(true);
    expect(
      series.some((row) => row.metric === "odds_liquidity_usd" && row.value === 190183.1871),
    ).toBe(true);
  });

  it("creates an opt-in Kalshi source and polls captured KXCPI series", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/sources/kalshi",
      headers: { cookie },
      payload: { name: "Kalshi", seriesTickers: ["KXCPI"] },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().source?.adapterId).toBe("kalshi");
    expect(created.json().source?.config?.seriesTickers).toEqual(["KXCPI"]);
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/sources/kalshi",
      headers: { cookie },
      payload: { name: "Kalshi again" },
    });
    expect(duplicate.statusCode).toBe(409);
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/sources",
      headers: { cookie },
    });
    const adapter = listed.json().adapters.find((item: { id: string }) => item.id === "kalshi");
    expect(adapter.capabilities.lookbackNotes).toMatch(/status=active/);
    const fixtures = join(process.cwd(), "packages/source-adapters/test/fixtures/kalshi");
    const seriesBody = JSON.parse(readFileSync(join(fixtures, "series-kxcpi.json"), "utf8"));
    const markets = JSON.parse(
      readFileSync(join(fixtures, "markets-kxcpi-truncated.json"), "utf8"),
    );
    await ctx.redis.del(`riddlr:observe:lock:${KALSHI_PROVIDER_ID}`);
    const polled = await pollObservationProvider(ctx, KALSHI_PROVIDER_ID, async (input) => {
      const url = String(input);
      if (url.includes("/series/KXCPI")) {
        return Response.json(seriesBody);
      }
      if (url.includes("/markets?")) {
        return Response.json(markets);
      }
      return new Response("not found", { status: 404 });
    });
    expect(polled.error).toBeUndefined();
    expect(polled.observations).toBeGreaterThan(0);
    const series = await ctx.db
      .select()
      .from(observationSeries)
      .where(eq(observationSeries.provider, KALSHI_PROVIDER_ID));
    expect(
      series.some(
        (row) =>
          row.metric === "odds_yes" &&
          row.subjectCanonicalId === "kalshi:KXCPI-26SEP-T0.6" &&
          Math.abs(row.value - 0.175) < 1e-10,
      ),
    ).toBe(true);
    expect(series.some((row) => row.metric === "volume" && row.value === 55474.97)).toBe(true);
  });

  it("creates an opt-in Snapshot source and persists captured Grove proposals", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/sources/snapshot",
      headers: { cookie },
      payload: { name: "Snapshot", spaces: ["grovefinance.eth"] },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().source?.adapterId).toBe("snapshot");
    expect(created.json().source?.config?.spaces).toEqual(["grovefinance.eth"]);
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/sources/snapshot",
      headers: { cookie },
      payload: { name: "Snapshot again" },
    });
    expect(duplicate.statusCode).toBe(409);
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/sources",
      headers: { cookie },
    });
    const adapter = listed.json().adapters.find((item: { id: string }) => item.id === "snapshot");
    expect(adapter.capabilities.lookbackNotes).toMatch(/hub.snapshot.org/);
    const grove = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          "packages/source-adapters/test/fixtures/snapshot/proposals-grove-truncated.json",
        ),
        "utf8",
      ),
    );
    const [agent] = await ctx.db.select().from(agents).where(eq(agents.kind, "system_default"));
    const [scan] = await ctx.db
      .insert(scans)
      .values({
        agentId: agent?.id as string,
        status: "queued",
        windowStart: new Date("2026-09-14T00:00:00.000Z"),
        idempotencyKey: "pipeline:crypto:snapshot-1",
      })
      .returning();
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("api.coingecko.com")) {
        return coinGeckoMarketsResponse();
      }
      if (url.includes("/search")) {
        return Response.json({ results: [] });
      }
      if (url.includes("hub.snapshot.org/graphql")) {
        return Response.json(grove);
      }
      return new Response("unexpected fetch", { status: 404 });
    };
    await runScan(ctx, scan?.id as string, { fetchImpl });
    const evidence = await ctx.db.select().from(evidenceItems);
    expect(
      evidence.some(
        (row) =>
          row.adapterId === "snapshot" &&
          row.sourceFamily === "governance" &&
          row.contentCompleteness === "native_complete" &&
          row.canonicalUrl?.includes("grovefinance.eth/proposal/"),
      ),
    ).toBe(true);
  });

  it("creates an EDGAR source, scans an Equities agent, and notifies on an official 8-K", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/sources/edgar",
      headers: { cookie },
      payload: { name: "SEC EDGAR", contactEmail: "ops@example.com" },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().source?.adapterId).toBe("edgar");
    expect(created.json().source?.config?.contactEmail).toBe("ops@example.com");
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/sources/edgar",
      headers: { cookie },
      payload: { name: "EDGAR again", contactEmail: "ops@example.com" },
    });
    expect(duplicate.statusCode).toBe(409);
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/sources",
      headers: { cookie },
    });
    const adapter = listed.json().adapters.find((item: { id: string }) => item.id === "edgar");
    expect(adapter.capabilities.lookbackNotes).toMatch(/User-Agent/);
    if (!(await findRegistryAsset(ctx, "sec:0001527613"))) {
      await ctx.db.insert(assets).values({
        assetClass: "stock",
        canonicalId: "sec:0001527613",
        symbol: "IMG",
        name: "CIMG Inc.",
        aliases: ["img", "cimg inc.", "0001527613"],
        externalIds: { cik: "0001527613", ticker: "IMG" },
        status: "active",
      });
    }
    const policy = await app.inject({
      method: "POST",
      url: "/api/v1/settings/notifications",
      headers: { cookie },
      payload: { minRisk: "moderate", cooldownMinutes: 0, earlyWarnings: true },
    });
    expect(policy.statusCode).toBe(200);
    const token = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abce";
    const webhookUrl = `https://discord.com/api/webhooks/123456789012345679/${token}`;
    await createDiscordWebhookTarget(
      ctx,
      { webhookUrl, primary: true },
      {
        lookup: async () => [{ address: "8.8.8.8", family: 4 }],
        fetchImpl: async (input) => {
          if (String(input).includes("?wait=true")) {
            return Response.json({ id: "should-not-validate" });
          }
          return Response.json({ type: 1, channel_id: "channel-edgar", name: "edgar" });
        },
      },
    );
    const agent = await app.inject({
      method: "POST",
      url: "/api/v1/agents",
      headers: { cookie },
      payload: {
        name: "EDGAR 8-K watcher",
        description: "Watches CIMG 8-K filings on EDGAR only.",
        marketDomainIds: ["equities"],
        sourceIds: [created.json().source.id],
        watchlistItems: [{ canonicalId: "sec:0001527613" }],
      },
    });
    expect(agent.statusCode).toBe(200);
    expect(agent.json().agent.domains).toEqual(["equities"]);
    const atom = readFileSync(
      join(process.cwd(), "packages/source-adapters/test/fixtures/edgar/atom-8k-truncated.xml"),
      "utf8",
    );
    const emptyAtom = readFileSync(
      join(process.cwd(), "packages/source-adapters/test/fixtures/edgar/atom-8k-empty.xml"),
      "utf8",
    );
    const [scan] = await ctx.db
      .insert(scans)
      .values({
        agentId: agent.json().agent.id as string,
        status: "queued",
        windowStart: new Date("2026-09-14T00:00:00.000Z"),
        idempotencyKey: "pipeline:equities:edgar-1",
      })
      .returning();
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("api.coingecko.com")) {
        return coinGeckoMarketsResponse();
      }
      if (url.includes("/search")) {
        return Response.json({ results: [] });
      }
      if (url.includes("/chat/completions") || url.includes("/v1/messages")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          messages?: Array<{ role: string; content: string }>;
        };
        const user = body.messages?.find((item) => item.role === "user")?.content ?? "";
        const ids = proofIdsFromAnalysisPrompt(user);
        return Response.json({
          id: "chatcmpl-edgar",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  headline: "CIMG 8-K officer change",
                  whyItMatters: "Official 8-K item 5.02 on a watched issuer.",
                  proof: {
                    evidenceIds: ids.evidenceIds.slice(0, 1),
                    claimIds: ids.claimIds.slice(0, 1),
                    summary: "SEC 8-K item 5.02.",
                  },
                  action: "Read the filing. Do not trade.",
                  risk: "high",
                  confidence: 0.8,
                  assets: ["sec:0001527613"],
                  eventType: "material_corporate_event",
                  marketContext: "SEC EDGAR.",
                  contradictoryEvidence: "none",
                  invalidationConditions: "amended 8-K retracts the item.",
                }),
              },
            },
          ],
          usage: { prompt_tokens: 40, completion_tokens: 20 },
        });
      }
      if (url.includes("discord.com/api/webhooks") && url.includes("wait=true")) {
        return Response.json({ id: "discord-edgar-1" });
      }
      if (url.includes("browse-edgar") && url.includes("type=8-K")) {
        return new Response(atom, { headers: { "content-type": "application/atom+xml" } });
      }
      if (url.includes("browse-edgar")) {
        return new Response(emptyAtom, { headers: { "content-type": "application/atom+xml" } });
      }
      return new Response("unexpected fetch", { status: 404 });
    };
    await runScan(ctx, scan?.id as string, { fetchImpl });
    const evidence = await ctx.db.select().from(evidenceItems);
    expect(
      evidence.some(
        (row) =>
          row.adapterId === "edgar" &&
          row.sourceFamily === "filing" &&
          row.contentCompleteness === "native_complete" &&
          row.canonicalUrl?.includes("1527613") &&
          (row.adapterPayload as { items?: string[] } | null)?.items?.includes("5.02"),
      ),
    ).toBe(true);
    const identities = await ctx.db
      .select()
      .from(sourceIdentities)
      .where(eq(sourceIdentities.platform, "sec"));
    expect(identities.some((row) => row.externalId === "0001527613")).toBe(true);
    const identityId = identities.find((row) => row.externalId === "0001527613")?.id;
    const policies = await ctx.db
      .select()
      .from(sourceIdentityPolicies)
      .where(eq(sourceIdentityPolicies.identityId, identityId as string));
    expect(policies.some((row) => row.trustTier === "official_firsthand" && row.active)).toBe(true);
    const eventRows = await ctx.db.select().from(events);
    expect(
      eventRows.some(
        (row) =>
          row.agentId === (agent.json().agent.id as string) &&
          row.catalystKind === "material_corporate_event",
      ),
    ).toBe(true);
    const deliveries = await ctx.db.select().from(notificationDeliveries);
    expect(deliveries.some((row) => row.channel === "discord")).toBe(true);
  });

  it("creates Alchemy and Helius sources and verifies inbound webhooks", async () => {
    const createdAlchemy = await app.inject({
      method: "POST",
      url: "/api/v1/sources/alchemy",
      headers: { cookie },
      payload: { name: "Alchemy", notifyToken: "notify-token-fixture", network: "ETH_MAINNET" },
    });
    expect(createdAlchemy.statusCode).toBe(200);
    expect(createdAlchemy.json().source?.adapterId).toBe("alchemy");
    expect(createdAlchemy.json().source?.config?.notifySecretId).toBeUndefined();
    expect(createdAlchemy.json().source?.config?.webhookUrl).toMatch(/\/hooks\/alchemy\//);
    const duplicateAlchemy = await app.inject({
      method: "POST",
      url: "/api/v1/sources/alchemy",
      headers: { cookie },
      payload: { name: "Alchemy again", notifyToken: "notify-token-fixture" },
    });
    expect(duplicateAlchemy.statusCode).toBe(409);
    const createdHelius = await app.inject({
      method: "POST",
      url: "/api/v1/sources/helius",
      headers: { cookie },
      payload: { name: "Helius", apiKey: "helius-api-key-fixture" },
    });
    expect(createdHelius.statusCode).toBe(200);
    expect(createdHelius.json().source?.adapterId).toBe("helius");
    expect(createdHelius.json().source?.config?.authHeaderSecretId).toBeUndefined();
    const duplicateHelius = await app.inject({
      method: "POST",
      url: "/api/v1/sources/helius",
      headers: { cookie },
      payload: { name: "Helius again", apiKey: "helius-api-key-fixture" },
    });
    expect(duplicateHelius.statusCode).toBe(409);
    const labels = await app.inject({
      method: "GET",
      url: "/api/v1/labeled-addresses",
      headers: { cookie },
    });
    expect(labels.statusCode).toBe(200);
    expect(
      labels
        .json()
        .addresses.some(
          (row: { label: string; role: string }) =>
            row.label === "Binance 14" && row.role === "exchange",
        ),
    ).toBe(true);
    const duplicateLabel = await app.inject({
      method: "POST",
      url: "/api/v1/labeled-addresses",
      headers: { cookie },
      payload: {
        chain: "ethereum",
        address: "0x28c6c06298d514db089934071355e5743bf21d60",
        label: "Binance 14",
        role: "exchange",
      },
    });
    expect(duplicateLabel.statusCode).toBe(409);
    const addedLabel = await app.inject({
      method: "POST",
      url: "/api/v1/labeled-addresses",
      headers: { cookie },
      payload: {
        chain: "ethereum",
        address: "0x1111111111111111111111111111111111111111",
        label: "Test desk",
        role: "other",
      },
    });
    expect(addedLabel.statusCode).toBe(200);
    const [alchemySource] = await ctx.db
      .select()
      .from(sources)
      .where(eq(sources.adapterId, "alchemy"))
      .limit(1);
    expect(alchemySource?.id).toBeDefined();
    const signingPlain = "alchemy-signing-key-fixture";
    const signing = encryptSecret({
      masterKey: ctx.masterKey,
      plaintext: signingPlain,
      purpose: "alchemy_signing",
      keyVersion: 1,
      aad: "alchemy_signing|1",
    });
    const [signingRow] = await ctx.db
      .insert(encryptedSecrets)
      .values({
        purpose: "alchemy_signing",
        keyVersion: 1,
        ciphertext: signing.ciphertext,
        nonce: signing.nonce,
        tag: signing.tag,
        alg: signing.alg,
      })
      .returning();
    await ctx.db
      .update(sources)
      .set({ secretId: signingRow?.id })
      .where(eq(sources.id, alchemySource?.id as string));
    const documented = JSON.parse(
      readFileSync(
        join(process.cwd(), "packages/source-adapters/test/fixtures/alchemy/address-activity.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const staleRaw = JSON.stringify(documented);
    const stale = await app.inject({
      method: "POST",
      url: `/hooks/alchemy/${alchemySource?.id}`,
      headers: {
        "content-type": "application/json",
        "x-alchemy-signature": hmacSha256Utf8(signingPlain, staleRaw),
      },
      payload: staleRaw,
    });
    expect(stale.statusCode).toBe(200);
    expect(stale.json().ignored).toBe("stale");
    const freshDocumented = {
      ...documented,
      id: "whevt_documented_fresh",
      createdAt: new Date().toISOString(),
    };
    const freshRaw = JSON.stringify(freshDocumented);
    const fresh = await app.inject({
      method: "POST",
      url: `/hooks/alchemy/${alchemySource?.id}`,
      headers: {
        "content-type": "application/json",
        "x-alchemy-signature": hmacSha256Utf8(signingPlain, freshRaw),
      },
      payload: freshRaw,
    });
    expect(fresh.statusCode).toBe(200);
    const replay = await app.inject({
      method: "POST",
      url: `/hooks/alchemy/${alchemySource?.id}`,
      headers: {
        "content-type": "application/json",
        "x-alchemy-signature": hmacSha256Utf8(signingPlain, freshRaw),
      },
      payload: freshRaw,
    });
    expect(replay.statusCode).toBe(200);
    const receipts = await ctx.db.select().from(inboundWebhookReceipts);
    expect(receipts.filter((row) => row.eventId === "whevt_documented_fresh")).toHaveLength(1);
    const documentedReceipt = receipts.find((row) => row.eventId === "whevt_documented_fresh");
    await processInboundReceipt(ctx, documentedReceipt?.id as string);
    const claimsAfterDocumented = await ctx.db.select().from(claims);
    expect(claimsAfterDocumented.some((row) => row.kind === "crypto:large_transfer")).toBe(false);
    const activity = (documented.event as { activity: Record<string, unknown>[] }).activity[0];
    const largeBody = {
      webhookId: documented.webhookId,
      id: "whevt_usdc_1m",
      createdAt: new Date().toISOString(),
      type: "ADDRESS_ACTIVITY",
      event: {
        network: "ETH_MAINNET",
        activity: [
          {
            ...activity,
            hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            toAddress: "0x28c6c06298d514db089934071355e5743bf21d60",
            value: 1_000_000,
          },
        ],
      },
    };
    const largeRaw = JSON.stringify(largeBody);
    const large = await app.inject({
      method: "POST",
      url: `/hooks/alchemy/${alchemySource?.id}`,
      headers: {
        "content-type": "application/json",
        "x-alchemy-signature": hmacSha256Utf8(signingPlain, largeRaw),
      },
      payload: largeRaw,
    });
    expect(large.statusCode).toBe(200);
    const largeReceipt = (
      await ctx.db
        .select()
        .from(inboundWebhookReceipts)
        .where(eq(inboundWebhookReceipts.eventId, "whevt_usdc_1m"))
    )[0];
    await processInboundReceipt(ctx, largeReceipt?.id as string);
    const persistedClaims = await ctx.db.select().from(claims);
    expect(
      persistedClaims.some(
        (row) =>
          row.kind === "crypto:large_transfer" &&
          row.value === 1_000_000 &&
          row.unit === "usd" &&
          (row.objectText ?? "").includes("exchange_inflow"),
      ),
    ).toBe(true);
    const evidence = await ctx.db.select().from(evidenceItems);
    expect(
      evidence.some(
        (row) =>
          row.adapterId === "alchemy" &&
          row.sourceFamily === "onchain" &&
          row.contentCompleteness === "native_complete",
      ),
    ).toBe(true);
    const badSig = await app.inject({
      method: "POST",
      url: `/hooks/alchemy/${alchemySource?.id}`,
      headers: {
        "content-type": "application/json",
        "x-alchemy-signature": "00",
      },
      payload: largeRaw,
    });
    expect(badSig.statusCode).toBe(401);
    const audits = await ctx.db.select().from(auditLogs);
    expect(audits.some((row) => row.action === "webhook.signature_mismatch")).toBe(true);
    const oversized = await app.inject({
      method: "POST",
      url: `/hooks/alchemy/${alchemySource?.id}`,
      headers: { "content-type": "application/json" },
      payload: `{"x":"${"a".repeat(1_000_001)}"}`,
    });
    expect(oversized.statusCode).toBe(413);
    const [heliusSource] = await ctx.db
      .select()
      .from(sources)
      .where(eq(sources.adapterId, "helius"))
      .limit(1);
    const authHeaderId =
      typeof heliusSource?.config.authHeaderSecretId === "string"
        ? heliusSource.config.authHeaderSecretId
        : undefined;
    const [authSecret] = await ctx.db
      .select()
      .from(encryptedSecrets)
      .where(eq(encryptedSecrets.id, authHeaderId as string))
      .limit(1);
    const authHeader = decryptSecretWithKeys({
      keys: ctx.masterKeys,
      secret: {
        ciphertext: authSecret?.ciphertext as string,
        nonce: authSecret?.nonce as string,
        tag: authSecret?.tag as string,
        alg: "aes-256-gcm",
        keyVersion: authSecret?.keyVersion as number,
      },
      purpose: authSecret?.purpose as string,
      aad: `${authSecret?.purpose}|${authSecret?.keyVersion}`,
    });
    const emptyHelius = await app.inject({
      method: "POST",
      url: `/hooks/helius/${heliusSource?.id}`,
      headers: { "content-type": "application/json", authorization: authHeader },
      payload: "[]",
    });
    expect(emptyHelius.statusCode).toBe(200);
    expect(
      (await ctx.db.select().from(inboundWebhookReceipts)).filter(
        (row) => row.adapterId === "helius",
      ),
    ).toHaveLength(0);
    const badHelius = await app.inject({
      method: "POST",
      url: `/hooks/helius/${heliusSource?.id}`,
      headers: { "content-type": "application/json", authorization: "nope-nope-nope-nope" },
      payload: "[]",
    });
    expect(badHelius.statusCode).toBe(401);
    const heliusFixture = JSON.parse(
      readFileSync(
        join(process.cwd(), "packages/source-adapters/test/fixtures/helius/enhanced-transfer.json"),
        "utf8",
      ),
    ) as Array<Record<string, unknown>>;
    const heliusFresh = [{ ...heliusFixture[0], timestamp: Math.floor(Date.now() / 1000) }];
    const heliusRaw = JSON.stringify(heliusFresh);
    const heliusOk = await app.inject({
      method: "POST",
      url: `/hooks/helius/${heliusSource?.id}`,
      headers: { "content-type": "application/json", authorization: authHeader },
      payload: heliusRaw,
    });
    expect(heliusOk.statusCode).toBe(200);
    expect(
      (await ctx.db.select().from(inboundWebhookReceipts)).some(
        (row) => row.adapterId === "helius",
      ),
    ).toBe(true);
  });

  it("rejects a Discord webhook URL that is not an incoming webhook", async () => {
    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/notification-targets",
      headers: { cookie },
      payload: { webhookUrl: "http://127.0.0.1/api/webhooks/1/not-a-discord-token" },
    });
    expect(rejected.statusCode).toBe(400);
  });

  it("returns the existing Discord webhook target for the same channel", async () => {
    const webhookUrl = `https://discord.com/api/webhooks/323456789012345682/${DISCORD_TEST_TOKEN_PAD}samech`;
    const deps = {
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      fetchImpl: async (input: string | URL | Request) => {
        if (String(input).includes("?wait=true")) {
          return Response.json({ id: "should-not-validate" });
        }
        return Response.json({ type: 1, channel_id: "channel-same", name: "same" });
      },
    };
    const first = await createDiscordWebhookTarget(ctx, { webhookUrl }, deps);
    const second = await createDiscordWebhookTarget(ctx, { webhookUrl }, deps);
    expect(first?.id).toBeDefined();
    expect(second?.id).toBe(first?.id);
  });

  it("returns the existing observation alert rule for the same threshold", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/observation-alert-rules",
      headers: { cookie },
      payload: {
        metric: "spot_price",
        op: "gte",
        threshold: 1,
        subjectCanonicalId: "coingecko:idempotent-alert-subject",
      },
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().rule.id as string;
    expect(id).toBeDefined();
    const again = await app.inject({
      method: "POST",
      url: "/api/v1/observation-alert-rules",
      headers: { cookie },
      payload: {
        metric: "spot_price",
        op: "gte",
        threshold: 1,
        subjectCanonicalId: "coingecko:idempotent-alert-subject",
      },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().rule.id).toBe(id);
  });

  it("claims a Discord webhook delivery once under bounded retry with wait=true", async () => {
    const agentRows = await ctx.db.select().from(agents).limit(1);
    const scanRows = await ctx.db.select().from(scans).limit(1);
    const agentId = agentRows[0]?.id as string;
    const scanId = scanRows[0]?.id as string;
    const token = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd";
    const webhookUrl = `https://discord.com/api/webhooks/123456789012345678/${token}`;
    const target = await createDiscordWebhookTarget(
      ctx,
      { webhookUrl, primary: true },
      {
        lookup: async () => [{ address: "8.8.8.8", family: 4 }],
        fetchImpl: async (input) => {
          if (String(input).includes("?wait=true")) {
            return Response.json({ id: "should-not-validate" });
          }
          return Response.json({ type: 1, channel_id: "channel-alerts", name: "alerts" });
        },
      },
    );
    expect(target?.destination).toBe("channel-alerts");
    const [event] = await ctx.db
      .insert(events)
      .values({
        agentId,
        scanId,
        title: "Discord notify cluster",
        status: "analyzed",
        windowStart: new Date(),
        impactLevel: "high",
        reliabilityStatus: "corroborated",
        catalystKind: "security_incident",
        independentCount: 2,
      })
      .returning();
    const [signal] = await ctx.db
      .insert(signals)
      .values({
        eventId: event?.id as string,
        agentId,
        headline: "Bridge drain",
        whyItMatters: "Funds moved",
        proof: { evidenceIds: ["ev-d"], summary: "fixture" },
        action: "Watch",
        risk: "high",
        confidence: "0.7",
        schemaVersion: "discord-notify",
      })
      .returning();
    let posts = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const href = String(input);
      if (href.includes(token) && href.includes("?wait=true")) {
        posts += 1;
        expect(href).toContain("wait=true");
        if (posts === 1) {
          return Response.json({ retry_after: 1 }, { status: 429 });
        }
        return Response.json({ id: "discord-msg-1" });
      }
      return Response.json({ type: 1, channel_id: "channel-alerts" });
    };
    await deliverSignalNotifications(ctx, signal?.id as string, fetchImpl);
    await deliverSignalNotifications(ctx, signal?.id as string, fetchImpl);
    expect(posts).toBe(2);
    const rows = await ctx.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.signalId, signal?.id as string));
    const sent = rows.filter(
      (row) => row.channel === "discord" && row.status === "sent" && row.targetId === target?.id,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.providerMessageId).toBe("discord-msg-1");
    expect(sent[0]?.kind).toBe("signal");
  });

  it("sends confirmation to the original Discord destination after a failed original", async () => {
    const agentId = await firstAgentId(ctx);
    const scanId = await scanIdForAgent(ctx, agentId);
    const { target, token } = await isolatedDiscordTarget(
      ctx,
      "channel-confirm",
      "323456789012345678",
    );
    const [event] = await ctx.db
      .insert(events)
      .values({
        agentId,
        scanId,
        title: "Failed original then confirm",
        status: "analyzed",
        windowStart: new Date(),
        impactLevel: "high",
        reliabilityStatus: "corroborated",
        catalystKind: "security_incident",
      })
      .returning();
    const [original] = await ctx.db
      .insert(signals)
      .values({
        eventId: event?.id as string,
        agentId,
        headline: "Unconfirmed drain",
        whyItMatters: "First origin",
        proof: { evidenceIds: ["ev-fail"], summary: "fixture" },
        action: "Watch",
        risk: "high",
        confidence: "0.5",
        schemaVersion: "discord-fail-original",
      })
      .returning();
    await ctx.db.insert(notificationDeliveries).values({
      signalId: original?.id as string,
      kind: "signal",
      channel: "discord",
      destination: target.destination,
      targetId: target.id,
      status: "failed",
      errorClass: "provider_error",
      idempotencyKey: `signal:${original?.id}:discord:${target.id}`,
    });
    const [confirmation] = await ctx.db
      .insert(signals)
      .values({
        eventId: event?.id as string,
        agentId,
        headline: "Drain confirmed",
        whyItMatters: "Second origin",
        proof: { evidenceIds: ["ev-confirm"], summary: "fixture" },
        action: "Watch",
        risk: "high",
        confidence: "0.8",
        schemaVersion: "discord-confirm",
        notifyKind: "confirmation",
      })
      .returning();
    let posts = 0;
    await deliverSignalNotifications(ctx, confirmation?.id as string, async (input) => {
      if (String(input).includes(token) && String(input).includes("?wait=true")) {
        posts += 1;
        return Response.json({ id: "discord-confirm-1" });
      }
      return Response.json({ ok: true });
    });
    expect(posts).toBe(1);
    const rows = await ctx.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.signalId, confirmation?.id as string));
    expect(
      rows.some(
        (row) =>
          row.status === "sent" &&
          row.destination === target.destination &&
          row.targetId === target.id,
      ),
    ).toBe(true);
  });

  it("delivers once when two routing rules name the same Discord target", async () => {
    const agentId = await firstAgentId(ctx);
    const scanId = await scanIdForAgent(ctx, agentId);
    const { target, token } = await isolatedDiscordTarget(
      ctx,
      "channel-tworule",
      "323456789012345679",
    );
    await ctx.db
      .delete(agentNotificationRoutes)
      .where(eq(agentNotificationRoutes.agentId, agentId));
    try {
      await ctx.db.insert(agentNotificationRoutes).values([
        {
          agentId,
          minImpact: "moderate",
          targetIds: [target.id],
        },
        {
          agentId,
          minImpact: "high",
          catalystKinds: ["security_incident"],
          targetIds: [target.id],
        },
      ]);
      const [event] = await ctx.db
        .insert(events)
        .values({
          agentId,
          scanId,
          title: "Two-rule cluster",
          status: "analyzed",
          windowStart: new Date(),
          impactLevel: "high",
          reliabilityStatus: "corroborated",
          catalystKind: "security_incident",
        })
        .returning();
      const [signal] = await ctx.db
        .insert(signals)
        .values({
          eventId: event?.id as string,
          agentId,
          headline: "Two-rule drain",
          whyItMatters: "Once",
          proof: { evidenceIds: ["ev-two"], summary: "fixture" },
          action: "Watch",
          risk: "high",
          confidence: "0.7",
          schemaVersion: "discord-two-rules",
        })
        .returning();
      let posts = 0;
      await deliverSignalNotifications(ctx, signal?.id as string, async (input) => {
        if (String(input).includes(token) && String(input).includes("?wait=true")) {
          posts += 1;
          return Response.json({ id: "discord-once" });
        }
        return Response.json({ ok: true });
      });
      expect(posts).toBe(1);
      const rows = await ctx.db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.signalId, signal?.id as string));
      expect(
        rows.filter((row) => row.channel === "discord" && row.targetId === target.id),
      ).toHaveLength(1);
    } finally {
      await ctx.db
        .delete(agentNotificationRoutes)
        .where(eq(agentNotificationRoutes.agentId, agentId));
    }
  });

  it("records Discord queue overflow instead of dropping the delivery", async () => {
    const agentId = await firstAgentId(ctx);
    const scanId = await scanIdForAgent(ctx, agentId);
    const { target, token } = await isolatedDiscordTarget(
      ctx,
      "channel-overflow",
      "323456789012345680",
    );
    await ctx.db
      .delete(agentNotificationRoutes)
      .where(eq(agentNotificationRoutes.agentId, agentId));
    try {
      await ctx.db.insert(agentNotificationRoutes).values({
        agentId,
        minImpact: "moderate",
        targetIds: [target.id],
      });
      await ctx.db.insert(notificationDeliveries).values(
        Array.from({ length: 32 }, (_, index) => ({
          kind: "signal" as const,
          channel: "discord",
          destination: target.destination,
          targetId: target.id,
          status: "pending",
          idempotencyKey: `discord-overflow-pending-${index}`,
        })),
      );
      const [event] = await ctx.db
        .insert(events)
        .values({
          agentId,
          scanId,
          title: "Overflow cluster",
          status: "analyzed",
          windowStart: new Date(),
          impactLevel: "high",
          catalystKind: "security_incident",
        })
        .returning();
      const [signal] = await ctx.db
        .insert(signals)
        .values({
          eventId: event?.id as string,
          agentId,
          headline: "Overflow",
          whyItMatters: "Cap",
          proof: { evidenceIds: ["ev-ov"], summary: "fixture" },
          action: "Watch",
          risk: "high",
          confidence: "0.6",
          schemaVersion: "discord-overflow",
        })
        .returning();
      let posts = 0;
      await deliverSignalNotifications(ctx, signal?.id as string, async (input) => {
        if (String(input).includes(token) && String(input).includes("?wait=true")) {
          posts += 1;
          return Response.json({ id: "should-not-send" });
        }
        return Response.json({ ok: true });
      });
      expect(posts).toBe(0);
      const rows = await ctx.db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.signalId, signal?.id as string));
      expect(
        rows.some(
          (row) =>
            row.status === "failed" &&
            row.errorClass === "queue_overflow" &&
            row.targetId === target.id,
        ),
      ).toBe(true);
    } finally {
      await ctx.db.delete(notificationDeliveries).where(
        inArray(
          notificationDeliveries.idempotencyKey,
          Array.from({ length: 32 }, (_, index) => `discord-overflow-pending-${index}`),
        ),
      );
      await ctx.db
        .delete(agentNotificationRoutes)
        .where(eq(agentNotificationRoutes.agentId, agentId));
    }
  });

  it("delivers an observation alert without inserting a signal", async () => {
    const { target, token } = await isolatedDiscordTarget(
      ctx,
      "channel-observe",
      "323456789012345681",
    );
    const [rule] = await ctx.db
      .insert(observationAlertRules)
      .values({
        metric: "spot_price",
        op: "gte",
        threshold: 100,
        targetIds: [target.id],
        enabled: true,
      })
      .returning();
    const before = await ctx.db.select({ id: signals.id }).from(signals);
    let posts = 0;
    await deliverObservationAlerts(
      ctx,
      [
        {
          provider: "coingecko",
          metric: "spot_price",
          subjectCanonicalId: "coingecko:bitcoin",
          observedAt: new Date("2026-09-14T16:00:00.000Z"),
          value: 110,
          unit: "usd",
        },
      ],
      async (input) => {
        if (String(input).includes(token) && String(input).includes("?wait=true")) {
          posts += 1;
          return Response.json({ id: "obs-msg-1" });
        }
        return Response.json({ ok: true });
      },
    );
    expect(posts).toBe(1);
    const after = await ctx.db.select({ id: signals.id }).from(signals);
    expect(after.length).toBe(before.length);
    const rows = await ctx.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.kind, "observation"));
    expect(
      rows.some(
        (row) =>
          row.observationRuleId === rule?.id && row.signalId === null && row.targetId === target.id,
      ),
    ).toBe(true);
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/notifications",
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(
      (listed.json().deliveries as Array<{ kind?: string; targetId?: string }>).some(
        (row) => row.kind === "observation" && row.targetId === target.id,
      ),
    ).toBe(true);
  });

  it("invalidates unused sibling password-reset tokens", async () => {
    const [user] = await ctx.db.select().from(users);
    expect(user?.id).toBeDefined();
    const first = randomToken();
    const sibling = randomToken();
    await ctx.db.insert(passwordResetTokens).values([
      {
        userId: user?.id as string,
        tokenHash: hashToken(first),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      {
        userId: user?.id as string,
        tokenHash: hashToken(sibling),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    ]);
    const complete = await app.inject({
      method: "POST",
      url: "/api/v1/auth/reset/complete",
      payload: { token: first, newPassword: "replacement horse battery" },
    });
    expect(complete.statusCode).toBe(200);
    const reuseSibling = await app.inject({
      method: "POST",
      url: "/api/v1/auth/reset/complete",
      payload: { token: sibling, newPassword: "another horse battery!" },
    });
    expect(reuseSibling.statusCode).toBe(400);
  });
});
