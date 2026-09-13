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
  agentSources,
  agents,
  aiUsageEvents,
  assets,
  claimEvidence,
  createDb,
  encryptedSecrets,
  events,
  evidenceItems,
  migrate,
  notificationDeliveries,
  observationSeries,
  passwordResetTokens,
  portfolios,
  scans,
  sessions,
  signalClaimProofs,
  signals,
  skills,
  users,
  watchlistItems,
  watchlists,
  whatsappSessions,
} from "@riddlr/db";

import { DomainModuleRegistry, normalizeEvidence } from "@riddlr/domain";
import { cryptoDomainModule } from "@riddlr/domain-crypto";
import { createLogger, createMetrics, snapshotProcessMemory } from "@riddlr/observability";
import { QUEUE_NAMES } from "@riddlr/queue";
import {
  COINGECKO_SPOT_PROVIDER_ID,
  createScriptedObservationProvider,
  ObservationProviderRegistry,
} from "@riddlr/source-adapters";
import { Queue } from "bullmq";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { Redis } from "ioredis";
import postgres from "postgres";
import { GenericContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { AppContext } from "../src/context.js";
import {
  findRegistryAsset,
  listRegistryAssets,
  seedAssetRegistry,
} from "../src/modules/asset-registry.js";
import { pollObservationProvider, retainObservationSeries } from "../src/modules/observe.js";
import { runScan } from "../src/modules/pipeline.js";
import { enforceSessionCap } from "../src/modules/sessions.js";

function cookieHeader(setCookie: string | string[] | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const session = list.find((item) => item.startsWith("riddlr_session=")) ?? list[0];
  return String(session ?? "").split(";")[0] ?? "";
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
    for (const id of ["equities", "forex", "commodities", "macro"]) {
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
      payload: { marketDomainIds: ["equities"] },
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
      marketDomainId: "equities",
    });
    const scan = await app.inject({
      method: "POST",
      url: `/api/v1/agents/${agentId}/scan`,
      headers: { cookie },
    });
    expect(scan.statusCode).toBe(400);
    await ctx.db
      .delete(agentMarketDomains)
      .where(eq(agentMarketDomains.marketDomainId, "equities"));
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
                        kind: "crypto:market_move",
                        predicate: "market_move",
                        polarity: "asserted",
                        modality: "asserted",
                        excerpt: "ETF inflows",
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
                  eventType: "narrative",
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
    const signalRows = await ctx.db.select().from(signals);
    const produced = signalRows.find((row) => row.headline.includes("Bitcoin ETF"));
    expect(produced).toBeDefined();
    const proofIds = produced?.proof.evidenceIds ?? [];
    expect(proofIds.length).toBeGreaterThan(0);
    expect((produced?.proof.claimIds ?? []).length).toBeGreaterThan(0);
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
        name: "Equities watcher",
        marketDomainIds: ["equities"],
        schedule: "1h",
      },
    });
    expect(comingSoon.statusCode).toBe(400);

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
        llmCalled = true;
        throw new Error("LLM must not be called when the token budget is exhausted");
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
        llmCalled = true;
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          messages?: Array<{ role?: string; content?: string }>;
        };
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
                  eventType: "narrative",
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
        keywords: ["bitcoin"],
        lookbackHours: 24,
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
      listed.json().adapters.find((item: { id: string }) => item.id === "onchain").comingSoon,
    ).toBe(true);
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
