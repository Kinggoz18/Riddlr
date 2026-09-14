import { timingSafeEqual } from "node:crypto";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import {
  completeSetupSchema,
  emailSetupSchema,
  keyRotateSchema,
  llmSetupSchema,
  loginSchema,
  pageQuerySchema,
  passwordChangeSchema,
  passwordResetCompleteSchema,
  passwordResetRequestSchema,
  recoveryRotateSchema,
  setupAdminSchema,
  setupUnlockSchema,
  totpVerifySchema,
  twoFactorSchema,
} from "@riddlr/api-contract";
import {
  decryptSecretWithKeys,
  encryptSecret,
  generateRecoveryCodes,
  hashPassword,
  hashRecoveryCode,
  hashToken,
  randomToken,
  verifyMetaSignature,
  verifyPassword,
  verifyTotp,
} from "@riddlr/crypto";
import {
  agents,
  aiUsageEvents,
  analyses,
  assets,
  auditLogs,
  claimEvidence,
  claims,
  encryptedSecrets,
  eventAssessmentReasons,
  eventAssessments,
  eventAssets,
  eventClaims,
  eventEvidence,
  events,
  evidenceDocuments,
  evidenceItems,
  evidenceRelations,
  instanceSettings,
  marketDomains,
  notificationDeliveries,
  observations,
  passwordResetTokens,
  portfolios,
  providerConfigs,
  recoveryCodes,
  scanSourceRuns,
  scans,
  sessions,
  signalClaimProofs,
  signalOutcomes,
  signals,
  sourceIdentities,
  sourceIdentityPolicies,
  sources,
  users,
  whatsappSessions,
  whatsappWebhookMessages,
} from "@riddlr/db";
import {
  assertSupportedMarketDomains,
  clampPageSize,
  type EvidenceRole,
  independenceGraph,
  leadTimeHours,
  MARKET_DOMAIN_REGISTRY,
  MAX_CLAIMS_PER_DOCUMENT,
  ONBOARDING_STEP_COUNT,
  parsePageCursor,
  sourceHostname,
  takeBounded,
  UnsupportedMarketDomainError,
} from "@riddlr/domain";
import { parseWhatsAppInbound, WHATSAPP_SESSION_WINDOW_MS } from "@riddlr/notifications";
import { snapshotProcessMemory } from "@riddlr/observability";
import { QUEUE_NAMES } from "@riddlr/queue";
import { assertSafeResolvedHttpUrl } from "@riddlr/source-adapters";
import { and, count, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { ZodError } from "zod";
import type { AppContext } from "./context.js";
import { registerAgentRoutes } from "./modules/agent-api.js";
import { catalystKindForClaim, catalystKindForEvent } from "./modules/catalyst-api.js";
import { publicEmailSettings, resolveEmailTransport } from "./modules/email.js";
import { loadEventTransitions } from "./modules/event-lifecycle.js";
import { registerInboundWebhookRoutes } from "./modules/inbound-webhooks.js";
import { rotateEncryptionKeys } from "./modules/key-rotation.js";
import {
  publicNotificationTargets,
  publicObservationAlertRules,
  registerNotificationTargetRoutes,
} from "./modules/notification-api.js";
import { observationHealth, registerObservationRoutes } from "./modules/observe.js";
import { loadScorecard } from "./modules/outcomes.js";
import {
  registerNotificationSettingsRoutes,
  registerPortfolioRoutes,
} from "./modules/portfolio-api.js";
import { enqueueAgentScan } from "./modules/scans.js";
import { sendSecurityMail } from "./modules/security-mail.js";
import {
  COOKIE,
  isIdleExpired,
  issueSession,
  readSessionToken,
  revokeOtherSessions,
  revokeSession,
  rotateSessionCookie,
  sessionCookieOptions,
  touchSession,
} from "./modules/sessions.js";
import {
  assertLlmReachable,
  createDefaultCryptoAgent,
  ensureShippedCryptoSkills,
  getSetupState,
  requireSetupStep,
  saveLlmProvider,
  setSetupStep,
  toPublicLlm,
} from "./modules/setup.js";
import {
  assertSetupAccess,
  clearSetupCookie,
  consumeSetupGate,
  ensureSetupGate,
  isSetupGateRoute,
  issueSetupCookie,
  markSetupClaimed,
  setupCodeRecordExpired,
  setupExpired,
  setupStatusAccess,
  verifySetupCode,
} from "./modules/setup-gate.js";
import { publicSource, registerSourceRoutes } from "./modules/source-api.js";
import {
  confirmTotpEnrollment,
  decryptTotpSecret,
  discardUnverifiedTotp,
  loadVerifiedTotpFactor,
  startTotpEnrollment,
} from "./modules/totp.js";

async function currentUser(ctx: AppContext, request: FastifyRequest) {
  const token = readSessionToken(ctx.config.cookieSecret, request.cookies[COOKIE]);
  if (!token) {
    return undefined;
  }
  const rows = await ctx.db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);
  const session = rows[0];
  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    return undefined;
  }
  if (isIdleExpired(ctx, session.lastSeenAt)) {
    await revokeSession(ctx, session.id);
    return undefined;
  }
  const userRows = await ctx.db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  const user = userRows[0];
  if (!user) {
    return undefined;
  }
  await touchSession(ctx, session.id);
  return { user, session };
}

function requireUser(
  user: Awaited<ReturnType<typeof currentUser>>,
): asserts user is NonNullable<typeof user> {
  if (!user) {
    const error = new Error("Unauthorized");
    (error as Error & { statusCode?: number }).statusCode = 401;
    throw error;
  }
}

export async function buildApp(ctx: AppContext) {
  ensureSetupGate(ctx);
  const app = Fastify({ loggerInstance: ctx.logger, bodyLimit: 1_000_000 });
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    const raw = Buffer.isBuffer(body) ? body : Buffer.from(body);
    (request as FastifyRequest & { rawBody?: Buffer }).rawBody = raw;
    try {
      const parsed = body.length === 0 ? {} : JSON.parse(body.toString("utf8"));
      done(null, parsed);
    } catch (error) {
      done(error as Error, undefined);
    }
  });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  await app.register(cors, { origin: ctx.config.RIDDLR_PUBLIC_URL, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute",
    redis: ctx.redis,
    nameSpace: "riddlr-rl-",
  });
  const authLimit = { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } };
  const totpLimit = { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } };
  const setupLimit = { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } };

  app.addHook("preHandler", async (request) => {
    if (!isSetupGateRoute(request.url, request.method)) {
      return;
    }
    const state = await getSetupState(ctx);
    await assertSetupAccess(ctx, request, state.completed);
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: { code: "invalid_request", message: "Request validation failed." },
      });
    }
    const status = (error as Error & { statusCode?: number }).statusCode ?? 500;
    if (status === 401) {
      return reply.code(401).send({
        error: {
          code: (error as Error & { code?: string }).code ?? "unauthorized",
          message: error.message || "Unauthorized",
        },
      });
    }
    if (status === 409) {
      return reply.code(409).send({
        error: {
          code: (error as Error & { code?: string }).code ?? "conflict",
          message: error.message,
        },
      });
    }
    ctx.logger.error({ err: error }, error.message);
    return reply.code(status).send({
      error: { code: "internal", message: "Unexpected error." },
    });
  });

  app.get("/healthz", async () => ({ ok: true }));
  app.get("/readyz", async (_request, reply) => {
    await ctx.db.select().from(instanceSettings).limit(1);
    let valkey = true;
    try {
      await ctx.redis.ping();
    } catch {
      valkey = false;
    }
    return reply.send({ ok: true, postgres: true, valkey, degraded: !valkey });
  });
  app.get("/metrics", async (request, reply) => {
    if (ctx.config.RIDDLR_METRICS_PUBLIC !== "true") {
      const auth = await currentUser(ctx, request);
      if (!auth?.session.twoFactorSatisfied) {
        return reply.code(404).send({ error: { code: "not_found", message: "Not found" } });
      }
    }
    reply.header("content-type", ctx.metrics.register.contentType);
    return ctx.metrics.register.metrics();
  });

  app.get("/api/v1/setup/status", async (request) => {
    const state = await getSetupState(ctx);
    const access = setupStatusAccess(ctx, request, state.completed);
    return {
      initialized: state.currentStep !== "admin" || state.completed,
      completed: state.completed,
      currentStep: state.currentStep,
      stepCount: ONBOARDING_STEP_COUNT,
      setupAccess: access.setupAccess,
      canContinue: access.canContinue,
      setupCodeExpired: access.setupCodeExpired,
      domains: MARKET_DOMAIN_REGISTRY,
    };
  });

  app.post("/api/v1/setup/unlock", setupLimit, async (request, reply) => {
    const state = await getSetupState(ctx);
    if (state.completed) {
      const error = new Error("Setup is already complete.");
      (error as Error & { statusCode?: number; code?: string }).statusCode = 409;
      (error as Error & { code?: string }).code = "setup_locked";
      throw error;
    }
    if (setupCodeRecordExpired(ctx)) {
      throw setupExpired();
    }
    const body = setupUnlockSchema.parse(request.body);
    if (!verifySetupCode(ctx, body.code)) {
      const error = new Error("Enter the setup code from the first start of this instance.");
      (error as Error & { statusCode?: number; code?: string }).statusCode = 401;
      (error as Error & { code?: string }).code = "setup_code";
      throw error;
    }
    markSetupClaimed(ctx);
    issueSetupCookie(ctx, reply);
    await ctx.db.insert(auditLogs).values({
      action: "setup.unlock",
      resource: "setup",
    });
    return { ok: true };
  });

  app.get("/api/v1/market-domains", async () => ({ domains: MARKET_DOMAIN_REGISTRY }));

  app.post("/api/v1/setup/admin", setupLimit, async (request, reply) => {
    const body = setupAdminSchema.parse(request.body);
    const passwordHash = await hashPassword(body.password);
    const user = await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(850001)`);
      const stateRows = await tx.select().from(instanceSettings).limit(1);
      const current = stateRows[0]?.onboardingCompletedAt
        ? "complete"
        : (stateRows[0]?.setupStep ?? "admin");
      if (current !== "admin") {
        const error = new Error(`Setup is on '${current}', not 'admin'.`);
        (error as Error & { statusCode?: number; code?: string }).statusCode = 409;
        (error as Error & { code?: string }).code = "setup_step";
        throw error;
      }
      const existing = await tx.select({ id: users.id }).from(users).limit(1);
      if (existing[0]) {
        const error = new Error("Administrator already exists.");
        (error as Error & { statusCode?: number; code?: string }).statusCode = 409;
        (error as Error & { code?: string }).code = "setup_locked";
        throw error;
      }
      const [created] = await tx
        .insert(users)
        .values({
          email: body.email.toLowerCase(),
          username: body.username?.toLowerCase(),
          passwordHash,
          isAdmin: true,
        })
        .returning();
      if (!created) {
        throw new Error("Failed to create user");
      }
      if (stateRows[0]) {
        await tx
          .update(instanceSettings)
          .set({ setupStep: "security" })
          .where(eq(instanceSettings.id, 1));
      } else {
        await tx.insert(instanceSettings).values({ id: 1, setupStep: "security" });
      }
      await tx.insert(auditLogs).values({
        actorUserId: created.id,
        action: "setup.admin",
        resource: created.id,
      });
      return created;
    });
    await issueSession(ctx, request, reply, { userId: user.id, twoFactorSatisfied: false });
    return { ok: true, next: "security" };
  });

  app.post("/api/v1/setup/totp/start", totpLimit, async (request) => {
    const auth = await currentUser(ctx, request);
    requireUser(auth);
    await requireSetupStep(ctx, "security");
    return startTotpEnrollment(ctx, auth.user.id, auth.user.email);
  });

  app.post("/api/v1/setup/totp/verify", totpLimit, async (request, reply) => {
    const auth = await currentUser(ctx, request);
    requireUser(auth);
    await requireSetupStep(ctx, "security");
    const body = totpVerifySchema.parse(request.body);
    const result = await confirmTotpEnrollment(ctx, auth.user.id, body.token);
    if (!result.ok) {
      if (result.code === "invalid_totp") {
        ctx.metrics.authEvents.inc({ result: "invalid_totp" });
        return reply.code(401).send({ error: { code: result.code, message: result.message } });
      }
      return reply.code(400).send({ error: { code: result.code, message: result.message } });
    }
    await rotateSessionCookie(ctx, request, reply, {
      userId: auth.user.id,
      twoFactorSatisfied: true,
      keepId: auth.session.id,
    });
    await setSetupStep(ctx, "llm");
    return { recoveryCodes: result.recoveryCodes, next: "llm" };
  });

  app.post("/api/v1/setup/totp/skip", totpLimit, async (request, reply) => {
    const auth = await currentUser(ctx, request);
    requireUser(auth);
    await requireSetupStep(ctx, "security");
    await discardUnverifiedTotp(ctx, auth.user.id);
    await rotateSessionCookie(ctx, request, reply, {
      userId: auth.user.id,
      twoFactorSatisfied: true,
      keepId: auth.session.id,
    });
    await setSetupStep(ctx, "llm");
    await ctx.db.insert(auditLogs).values({
      actorUserId: auth.user.id,
      action: "setup.totp_skipped",
      resource: auth.user.id,
    });
    return { ok: true, next: "llm", totpEnabled: false };
  });

  app.post("/api/v1/setup/llm", async (request, reply) => {
    const auth = await currentUser(ctx, request);
    requireUser(auth);
    await requireSetupStep(ctx, "llm");
    const body = llmSetupSchema.parse(request.body);
    try {
      await assertSafeResolvedHttpUrl(body.baseUrl);
    } catch {
      return reply.code(400).send({
        error: { code: "unsafe_url", message: "LLM base URL host is not allowed." },
      });
    }
    try {
      await assertLlmReachable(ctx, body);
    } catch (error) {
      const code = (error as Error & { code?: string }).code;
      if (code === "llm_unreachable") {
        return reply.code(400).send({
          error: {
            code,
            message: error instanceof Error ? error.message : "Could not reach that model.",
          },
        });
      }
      throw error;
    }
    await saveLlmProvider(ctx, body);
    await setSetupStep(ctx, "domains_sources");
    return { ok: true, next: "domains_sources", configured: true };
  });

  app.post("/api/v1/setup/llm/skip", async (request) => {
    const auth = await currentUser(ctx, request);
    requireUser(auth);
    await requireSetupStep(ctx, "llm");
    await setSetupStep(ctx, "domains_sources");
    await ctx.db.insert(auditLogs).values({
      actorUserId: auth.user.id,
      action: "setup.llm_skipped",
      resource: auth.user.id,
    });
    return { ok: true, next: "domains_sources", configured: false };
  });

  app.post("/api/v1/setup/complete", async (request, reply) => {
    const auth = await currentUser(ctx, request);
    requireUser(auth);
    await requireSetupStep(ctx, "domains_sources");
    const body = completeSetupSchema.parse(request.body);
    try {
      assertSupportedMarketDomains(body.marketDomainIds);
    } catch (error) {
      const comingSoon = error instanceof UnsupportedMarketDomainError;
      return reply.code(400).send({
        error: {
          code: comingSoon ? "coming_soon" : "unsupported_domain",
          message: error instanceof Error ? error.message : "invalid",
        },
      });
    }
    const searxngUrl = body.searxngUrl ?? ctx.config.RIDDLR_SEARXNG_URL;
    try {
      await assertSafeResolvedHttpUrl(searxngUrl, ["searxng"]);
    } catch {
      return reply.code(400).send({
        error: { code: "unsafe_url", message: "SearXNG URL host is not allowed." },
      });
    }
    const agent = await createDefaultCryptoAgent(ctx, searxngUrl);
    if (body.telegramBotToken && body.telegramChatId) {
      const settingsRows = await ctx.db.select().from(instanceSettings).limit(1);
      const keyVersion = settingsRows[0]?.keyVersion ?? 1;
      const encrypted = encryptSecret({
        masterKey: ctx.masterKey,
        plaintext: body.telegramBotToken,
        purpose: "telegram",
        keyVersion,
        aad: `telegram|${keyVersion}`,
      });
      const [secret] = await ctx.db
        .insert(encryptedSecrets)
        .values({
          purpose: "telegram",
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce,
          tag: encrypted.tag,
          alg: encrypted.alg,
          keyVersion: 1,
        })
        .returning();
      await ctx.db.insert(providerConfigs).values({
        kind: "telegram",
        settings: { chatId: body.telegramChatId, configured: true },
        secretId: secret?.id,
      });
    }
    await setSetupStep(ctx, "complete", true);
    consumeSetupGate(ctx);
    clearSetupCookie(ctx, reply);
    let firstScanQueued = false;
    try {
      await enqueueAgentScan(ctx, agent.id);
      firstScanQueued = true;
    } catch (error) {
      ctx.logger.warn({ err: error, agentId: agent.id }, "first scan enqueue failed");
    }
    return { ok: true, next: "complete", firstScanQueued };
  });

  app.post("/api/v1/auth/login", authLimit, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const identifier = body.email.toLowerCase();
    const rows = await ctx.db
      .select()
      .from(users)
      .where(or(eq(users.email, identifier), eq(users.username, identifier)))
      .limit(2);
    const user = rows[0];
    if (!user || !(await verifyPassword(user.passwordHash, body.password))) {
      ctx.metrics.authEvents.inc({ result: "invalid_password" });
      return reply
        .code(401)
        .send({ error: { code: "invalid_credentials", message: "Invalid credentials." } });
    }
    const totp = await loadVerifiedTotpFactor(ctx, user.id);
    await issueSession(ctx, request, reply, {
      userId: user.id,
      twoFactorSatisfied: !totp,
    });
    ctx.metrics.authEvents.inc({ result: "login" });
    if (!totp) {
      await sendSecurityMail({
        ctx,
        to: user.email,
        kind: "new_session",
        text: `A session was opened for ${user.email}. You can revoke it from Settings.`,
      });
    }
    return { ok: true, requiresTwoFactor: Boolean(totp) };
  });

  app.post("/api/v1/auth/2fa", authLimit, async (request, reply) => {
    const auth = await currentUser(ctx, request);
    requireUser(auth);
    const body = twoFactorSchema.parse(request.body);
    const factor = await loadVerifiedTotpFactor(ctx, auth.user.id);
    if (!factor) {
      return reply
        .code(400)
        .send({ error: { code: "missing_totp", message: "No TOTP configured." } });
    }
    const secret = decryptTotpSecret(ctx, factor, auth.user.id);
    const codes = await ctx.db
      .select()
      .from(recoveryCodes)
      .where(eq(recoveryCodes.userId, auth.user.id))
      .limit(16);
    const recovery = codes.find(
      (row) => !row.usedAt && row.codeHash === hashRecoveryCode(body.token),
    );
    const totpOk = verifyTotp(secret, body.token);
    if (!totpOk && !recovery) {
      return reply.code(401).send({ error: { code: "invalid_totp", message: "Invalid code." } });
    }
    if (recovery) {
      const [consumed] = await ctx.db
        .update(recoveryCodes)
        .set({ usedAt: new Date() })
        .where(and(eq(recoveryCodes.id, recovery.id), isNull(recoveryCodes.usedAt)))
        .returning();
      if (!consumed) {
        return reply.code(401).send({ error: { code: "invalid_totp", message: "Invalid code." } });
      }
      await sendSecurityMail({
        ctx,
        to: auth.user.email,
        kind: "recovery_used",
        text: "A recovery code was used to sign in to this Riddlr instance. If this was not you, reset your password.",
      });
      await ctx.db.insert(auditLogs).values({
        actorUserId: auth.user.id,
        action: "auth.recovery_used",
        resource: auth.user.id,
      });
    }
    await rotateSessionCookie(ctx, request, reply, {
      userId: auth.user.id,
      twoFactorSatisfied: true,
      keepId: auth.session.id,
    });
    await sendSecurityMail({
      ctx,
      to: auth.user.email,
      kind: "new_session",
      text: `A session was opened for ${auth.user.email}. You can revoke it from Settings.`,
    });
    await ctx.db.insert(auditLogs).values({
      actorUserId: auth.user.id,
      action: "auth.2fa",
      resource: auth.session.id,
    });
    return { ok: true };
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    const auth = await currentUser(ctx, request);
    if (auth) {
      await ctx.db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.id, auth.session.id));
    }
    reply.clearCookie(COOKIE, sessionCookieOptions(ctx));
    return { ok: true };
  });

  const authed = async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await currentUser(ctx, request);
    if (!auth || !auth.session.twoFactorSatisfied) {
      return reply.code(401).send({ error: { code: "unauthorized", message: "Unauthorized" } });
    }
    (request as FastifyRequest & { auth: typeof auth }).auth = auth;
  };

  registerAgentRoutes(app as unknown as import("fastify").FastifyInstance, ctx, authed);
  registerObservationRoutes(app as unknown as import("fastify").FastifyInstance, ctx, authed);
  registerSourceRoutes(app as unknown as import("fastify").FastifyInstance, ctx, authed);
  registerInboundWebhookRoutes(app as unknown as import("fastify").FastifyInstance, ctx);
  registerPortfolioRoutes(app as unknown as import("fastify").FastifyInstance, ctx, authed);
  registerNotificationSettingsRoutes(
    app as unknown as import("fastify").FastifyInstance,
    ctx,
    authed,
  );
  registerNotificationTargetRoutes(
    app as unknown as import("fastify").FastifyInstance,
    ctx,
    authed,
  );

  app.get("/api/v1/webhooks/whatsapp", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const mode = query["hub.mode"];
    const token = query["hub.verify_token"] ?? "";
    const challenge = query["hub.challenge"];
    const [provider] = await ctx.db
      .select()
      .from(providerConfigs)
      .where(eq(providerConfigs.kind, "whatsapp"))
      .limit(1);
    const expected = String(
      (provider?.settings as { verifyTokenHash?: string })?.verifyTokenHash ?? "",
    );
    const presented = hashToken(token);
    const match =
      expected.length > 0 &&
      expected.length === presented.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(presented));
    if (mode === "subscribe" && match && challenge) {
      return reply.type("text/plain").send(challenge);
    }
    return reply
      .code(403)
      .send({ error: { code: "forbidden", message: "Verify token mismatch." } });
  });

  app.post("/api/v1/webhooks/whatsapp", async (request, reply) => {
    const [provider] = await ctx.db
      .select()
      .from(providerConfigs)
      .where(eq(providerConfigs.kind, "whatsapp"))
      .limit(1);
    const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
    const header = request.headers["x-hub-signature-256"];
    const settings = (provider?.settings ?? {}) as { appSecretId?: string };
    if (!provider || !rawBody || !settings.appSecretId) {
      return reply.code(403).send({ error: { code: "forbidden", message: "Invalid signature." } });
    }
    const [appSecretRow] = await ctx.db
      .select()
      .from(encryptedSecrets)
      .where(eq(encryptedSecrets.id, settings.appSecretId))
      .limit(1);
    if (!appSecretRow) {
      return reply.code(403).send({ error: { code: "forbidden", message: "Invalid signature." } });
    }
    const appSecret = decryptSecretWithKeys({
      keys: ctx.masterKeys,
      secret: {
        ciphertext: appSecretRow.ciphertext,
        nonce: appSecretRow.nonce,
        tag: appSecretRow.tag,
        alg: "aes-256-gcm",
        keyVersion: appSecretRow.keyVersion,
      },
      purpose: "whatsapp_app",
      aad: `whatsapp_app|${appSecretRow.keyVersion}`,
    });
    if (
      !verifyMetaSignature({
        appSecret,
        rawBody,
        header: typeof header === "string" ? header : undefined,
      })
    ) {
      return reply.code(403).send({ error: { code: "forbidden", message: "Invalid signature." } });
    }
    const inbound = parseWhatsAppInbound(request.body);
    for (const item of inbound) {
      if (item.messageId) {
        const inserted = await ctx.db
          .insert(whatsappWebhookMessages)
          .values({
            messageId: item.messageId,
            fromE164: item.from,
            inboundAt: item.timestamp,
          })
          .onConflictDoNothing()
          .returning();
        if (!inserted[0]) {
          continue;
        }
      }
      const [existing] = await ctx.db
        .select()
        .from(whatsappSessions)
        .where(eq(whatsappSessions.toE164, item.from))
        .limit(1);
      if (existing && existing.lastInboundAt.getTime() >= item.timestamp.getTime()) {
        continue;
      }
      const windowUntil = new Date(item.timestamp.getTime() + WHATSAPP_SESSION_WINDOW_MS);
      await ctx.db
        .insert(whatsappSessions)
        .values({
          toE164: item.from,
          lastInboundAt: item.timestamp,
          windowUntil,
          lastMessageId: item.messageId,
          receivedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: whatsappSessions.toE164,
          set: {
            lastInboundAt: item.timestamp,
            windowUntil,
            lastMessageId: item.messageId,
            receivedAt: new Date(),
          },
        });
    }
    return { ok: true };
  });

  app.post("/api/v1/auth/password", { preHandler: authed }, async (request, reply) => {
    const auth = await currentUser(ctx, request);
    requireUser(auth);
    const body = passwordChangeSchema.parse(request.body);
    if (!(await verifyPassword(auth.user.passwordHash, body.currentPassword))) {
      return reply
        .code(401)
        .send({ error: { code: "invalid_credentials", message: "Invalid credentials." } });
    }
    const passwordHash = await hashPassword(body.newPassword);
    await ctx.db.update(users).set({ passwordHash }).where(eq(users.id, auth.user.id));
    await revokeOtherSessions(ctx, auth.user.id, auth.session.id);
    await ctx.db.insert(auditLogs).values({
      actorUserId: auth.user.id,
      action: "auth.password_change",
      resource: auth.user.id,
    });
    await sendSecurityMail({
      ctx,
      to: auth.user.email,
      kind: "password_changed",
      text: "The password for this Riddlr instance was changed. Other sessions were signed out.",
    });
    return { ok: true };
  });

  app.get("/api/v1/auth/reset/status", async () => {
    const transport = await resolveEmailTransport(ctx);
    return { delivered: transport.transport !== "none" };
  });

  app.post("/api/v1/auth/reset/request", authLimit, async (request) => {
    const body = passwordResetRequestSchema.parse(request.body);
    const transport = await resolveEmailTransport(ctx);
    const rows = await ctx.db
      .select()
      .from(users)
      .where(eq(users.email, body.email.toLowerCase()))
      .limit(1);
    const user = rows[0];
    if (user) {
      const token = randomToken();
      await ctx.db.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      const resetUrl = new URL("/reset", ctx.config.RIDDLR_PUBLIC_URL);
      resetUrl.searchParams.set("token", token);
      await sendSecurityMail({
        ctx,
        to: user.email,
        kind: "password_reset",
        text: `Use this single-use link within one hour:\n${resetUrl.toString()}`,
      });
    }
    return { ok: true, delivered: transport.transport !== "none" };
  });

  app.post("/api/v1/auth/reset/complete", authLimit, async (request, reply) => {
    const body = passwordResetCompleteSchema.parse(request.body);
    const rows = await ctx.db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, hashToken(body.token)),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
    const reset = rows[0];
    if (!reset) {
      return reply
        .code(400)
        .send({ error: { code: "invalid_reset", message: "Reset token is invalid or expired." } });
    }
    const passwordHash = await hashPassword(body.newPassword);
    await ctx.db.update(users).set({ passwordHash }).where(eq(users.id, reset.userId));
    await ctx.db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.userId, reset.userId), isNull(passwordResetTokens.usedAt)));
    await ctx.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.userId, reset.userId));
    await ctx.db.insert(auditLogs).values({
      actorUserId: reset.userId,
      action: "auth.password_reset",
      resource: reset.userId,
    });
    const [resetUser] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.id, reset.userId))
      .limit(1);
    if (resetUser) {
      await sendSecurityMail({
        ctx,
        to: resetUser.email,
        kind: "password_changed",
        text: "Your Riddlr password was reset. All sessions were signed out.",
      });
    }
    return { ok: true };
  });

  app.get("/api/v1/me", async (request, reply) => {
    const auth = await currentUser(ctx, request);
    if (!auth) {
      return reply.code(401).send({ error: { code: "unauthorized", message: "Unauthorized" } });
    }
    return {
      id: auth.user.id,
      email: auth.user.email,
      twoFactorSatisfied: auth.session.twoFactorSatisfied,
      totpEnabled: Boolean(await loadVerifiedTotpFactor(ctx, auth.user.id)),
    };
  });

  app.get("/api/v1/overview", { preHandler: authed }, async (request) => {
    const auth = await currentUser(ctx, request);
    const agentRows = await ctx.db
      .select()
      .from(agents)
      .limit(ctx.config.RIDDLR_SCHEDULER_AGENT_LIMIT);
    const signalRows = await ctx.db
      .select()
      .from(signals)
      .orderBy(desc(signals.createdAt))
      .limit(10);
    const scanRows = await ctx.db.select().from(scans).orderBy(desc(scans.startedAt)).limit(10);
    const sourceRows = await ctx.db
      .select()
      .from(sources)
      .limit(ctx.config.RIDDLR_SCAN_SOURCE_LIMIT);
    const domains = await ctx.db.select().from(marketDomains).limit(16);
    const eventRows = await ctx.db.select().from(events).orderBy(desc(events.windowStart)).limit(8);
    const usage = await ctx.db.select().from(aiUsageEvents).limit(20);
    const providers = await ctx.db.select().from(providerConfigs).limit(16);
    const portfolioRows = await ctx.db.select().from(portfolios).limit(16);
    const llmConfigured = providers.some(
      (item) =>
        item.kind.includes("compatible") ||
        item.kind.includes("openai") ||
        item.kind.includes("anthropic"),
    );
    const totpEnabled = Boolean(auth && (await loadVerifiedTotpFactor(ctx, auth.user.id)));
    const telegramConfigured = providers.some((item) => item.kind === "telegram");
    const whatsappConfigured = providers.some((item) => item.kind === "whatsapp");
    const hasPrimarySocial = sourceRows.some(
      (item) => item.adapterId === "discord" || item.adapterId === "x",
    );
    const workerHealthy = Boolean(await ctx.redis.get("riddlr:worker:heartbeat"));
    return {
      agents: agentRows,
      signals: signalRows,
      scans: scanRows,
      events: eventRows,
      sources: sourceRows.map(publicSource),
      domains,
      aiUsage: usage,
      llmConfigured,
      totpEnabled,
      workerHealthy,
      nextSteps: [
        {
          id: "llm",
          title: "Connect a model",
          body: "Analysis needs a provider. Scans still collect evidence without one.",
          href: "/settings",
          done: llmConfigured,
        },
        {
          id: "totp",
          title: "Turn on authenticator",
          body: "Sign-in should require a 6-digit code once a factor is verified.",
          href: "/settings/security",
          done: totpEnabled,
        },
        {
          id: "social",
          title: "Add Discord or X",
          body: "Search hits are not independent primaries. Discord and X can be.",
          href: "/sources/new",
          done: hasPrimarySocial,
        },
        {
          id: "portfolio",
          title: "Record a portfolio",
          body: "Declared holdings let material events overlap with what you hold. Public addresses only.",
          href: "/portfolios/new",
          done: portfolioRows.length > 0,
        },
        {
          id: "notify",
          title: "Send signals somewhere",
          body: "Telegram or WhatsApp delivers after risk, cooldown, and quiet hours.",
          href: "/settings/notifications",
          done: telegramConfigured || whatsappConfigured,
        },
        {
          id: "scan",
          title: "Run the first scan",
          body: workerHealthy
            ? "A scan clusters evidence. Signals appear only after a material event is analyzed."
            : "The worker is not running. Start it, then run a scan from Agents.",
          href: "/agents",
          done: scanRows.length > 0,
        },
      ],
    };
  });

  app.get("/api/v1/signals", { preHandler: authed }, async (request) => {
    const query = pageQuerySchema.parse(request.query);
    const limit = clampPageSize(query.limit, ctx.config.RIDDLR_PAGE_SIZE);
    const before = parsePageCursor(query.before);
    const rows = before
      ? await ctx.db
          .select()
          .from(signals)
          .where(lt(signals.createdAt, before))
          .orderBy(desc(signals.createdAt))
          .limit(limit)
      : await ctx.db.select().from(signals).orderBy(desc(signals.createdAt)).limit(limit);
    const eventIds = [...new Set(rows.map((row) => row.eventId))];
    const eventMeta =
      eventIds.length > 0
        ? await ctx.db
            .select({ id: events.id, marketDomainId: events.marketDomainId })
            .from(events)
            .where(inArray(events.id, eventIds))
            .limit(limit)
        : [];
    const claimKindRows =
      eventIds.length > 0
        ? await ctx.db
            .select({ eventId: eventClaims.eventId, kind: claims.kind })
            .from(eventClaims)
            .innerJoin(claims, eq(eventClaims.claimId, claims.id))
            .where(inArray(eventClaims.eventId, eventIds))
            .limit(eventIds.length * MAX_CLAIMS_PER_DOCUMENT)
        : [];
    const kindsByEvent = new Map<string, string[]>();
    for (const row of claimKindRows) {
      const current = kindsByEvent.get(row.eventId) ?? [];
      current.push(row.kind);
      kindsByEvent.set(row.eventId, current);
    }
    return {
      signals: rows.map((row) => {
        const event = eventMeta.find((item) => item.id === row.eventId);
        return {
          ...row,
          catalystKind: catalystKindForEvent(
            ctx,
            event?.marketDomainId,
            kindsByEvent.get(row.eventId) ?? [],
          ),
        };
      }),
    };
  });
  app.get("/api/v1/signals/:id", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await ctx.db.select().from(signals).where(eq(signals.id, id)).limit(1);
    const signal = rows[0];
    if (!signal) {
      return reply.code(404).send({ error: { code: "not_found", message: "Not found" } });
    }
    const evidenceIds = takeBounded(signal.proof.evidenceIds, 50);
    const evidence =
      evidenceIds.length > 0
        ? await ctx.db.select().from(evidenceItems).where(inArray(evidenceItems.id, evidenceIds))
        : [];
    const [analysis] = await ctx.db
      .select({ skillTrace: analyses.skillTrace })
      .from(analyses)
      .where(eq(analyses.eventId, signal.eventId))
      .orderBy(desc(analyses.createdAt))
      .limit(1);
    const proofLinks = await ctx.db
      .select({
        claimId: signalClaimProofs.claimId,
        evidenceId: signalClaimProofs.evidenceId,
        excerpt: claimEvidence.excerpt,
        stance: claimEvidence.stance,
        title: claims.title,
      })
      .from(signalClaimProofs)
      .innerJoin(claims, eq(signalClaimProofs.claimId, claims.id))
      .innerJoin(
        claimEvidence,
        and(
          eq(claimEvidence.claimId, signalClaimProofs.claimId),
          eq(claimEvidence.evidenceId, signalClaimProofs.evidenceId),
        ),
      )
      .where(eq(signalClaimProofs.signalId, id))
      .limit(32);
    const [event] = await ctx.db
      .select({ id: events.id, marketDomainId: events.marketDomainId })
      .from(events)
      .where(eq(events.id, signal.eventId))
      .limit(1);
    const eventClaimKinds = await ctx.db
      .select({ kind: claims.kind })
      .from(eventClaims)
      .innerJoin(claims, eq(eventClaims.claimId, claims.id))
      .where(eq(eventClaims.eventId, signal.eventId))
      .limit(MAX_CLAIMS_PER_DOCUMENT);
    return {
      signal: {
        ...signal,
        catalystKind: catalystKindForEvent(
          ctx,
          event?.marketDomainId,
          eventClaimKinds.map((item) => item.kind),
        ),
      },
      evidence,
      skillTrace: analysis?.skillTrace,
      proofLinks,
    };
  });
  app.get("/api/v1/events", { preHandler: authed }, async (request) => {
    const query = pageQuerySchema.parse(request.query);
    const limit = clampPageSize(query.limit, ctx.config.RIDDLR_PAGE_SIZE);
    const before = parsePageCursor(query.before);
    const rows = before
      ? await ctx.db
          .select()
          .from(events)
          .where(lt(events.windowStart, before))
          .orderBy(desc(events.windowStart))
          .limit(limit)
      : await ctx.db.select().from(events).orderBy(desc(events.windowStart)).limit(limit);
    const ids = rows.map((row) => row.id);
    const assetLinks =
      ids.length > 0
        ? await ctx.db
            .select()
            .from(eventAssets)
            .where(inArray(eventAssets.eventId, ids))
            .limit(200)
        : [];
    const assetIds = [...new Set(assetLinks.map((item) => item.assetId))];
    const assetRows =
      assetIds.length > 0
        ? await ctx.db.select().from(assets).where(inArray(assets.id, assetIds)).limit(200)
        : [];
    const claimKindRows =
      ids.length > 0
        ? await ctx.db
            .select({ eventId: eventClaims.eventId, kind: claims.kind })
            .from(eventClaims)
            .innerJoin(claims, eq(eventClaims.claimId, claims.id))
            .where(inArray(eventClaims.eventId, ids))
            .limit(ids.length * MAX_CLAIMS_PER_DOCUMENT)
        : [];
    const kindsByEvent = new Map<string, string[]>();
    for (const row of claimKindRows) {
      const current = kindsByEvent.get(row.eventId) ?? [];
      current.push(row.kind);
      kindsByEvent.set(row.eventId, current);
    }
    return {
      events: rows.map((row) => ({
        ...row,
        catalystKind: catalystKindForEvent(ctx, row.marketDomainId, kindsByEvent.get(row.id) ?? []),
        leadTimeHours: leadTimeHours(row.firstObservedAt, row.firstPrimaryAt),
        assets: assetLinks
          .filter((link) => link.eventId === row.id)
          .map((link) => assetRows.find((asset) => asset.id === link.assetId))
          .filter((item): item is (typeof assetRows)[number] => Boolean(item))
          .map((asset) => ({
            canonicalId: asset.canonicalId,
            symbol: asset.symbol,
            name: asset.name,
          })),
      })),
    };
  });
  app.get("/api/v1/events/:id", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const eventRows = await ctx.db.select().from(events).where(eq(events.id, id)).limit(1);
    const event = eventRows[0];
    if (!event) {
      return reply.code(404).send({ error: { code: "not_found", message: "Not found" } });
    }
    const links = await ctx.db
      .select()
      .from(eventEvidence)
      .where(eq(eventEvidence.eventId, id))
      .limit(100);
    const evidenceIds = links.map((item) => item.evidenceId);
    const evidence =
      evidenceIds.length > 0
        ? await ctx.db.select().from(evidenceItems).where(inArray(evidenceItems.id, evidenceIds))
        : [];
    const observationRows = await ctx.db
      .select()
      .from(observations)
      .where(eq(observations.eventId, id))
      .limit(20);
    const assetLinks = await ctx.db
      .select()
      .from(eventAssets)
      .where(eq(eventAssets.eventId, id))
      .limit(50);
    const assetIds = assetLinks.map((item) => item.assetId);
    const eventAssetRows =
      assetIds.length > 0
        ? await ctx.db.select().from(assets).where(inArray(assets.id, assetIds)).limit(50)
        : [];
    const relationRows =
      evidenceIds.length > 0
        ? await ctx.db
            .select()
            .from(evidenceRelations)
            .where(inArray(evidenceRelations.fromId, evidenceIds))
            .limit(200)
        : [];
    const independence = independenceGraph(
      evidence.map((item) => ({
        id: item.id,
        url: item.canonicalUrl,
        role: (links.find((link) => link.evidenceId === item.id)?.role ??
          "primary") as EvidenceRole,
        reprintOfId: relationRows.find(
          (relation) => relation.fromId === item.id && relation.kind === "reprint_of",
        )?.toId,
        nearDuplicateOfId: relationRows.find(
          (relation) => relation.fromId === item.id && relation.kind === "near_duplicate_of",
        )?.toId,
      })),
    );
    const [analysis] = await ctx.db
      .select({ skillTrace: analyses.skillTrace })
      .from(analyses)
      .where(eq(analyses.eventId, id))
      .orderBy(desc(analyses.createdAt))
      .limit(1);
    const claimRows =
      evidenceIds.length > 0
        ? await ctx.db
            .select({
              claimId: eventClaims.claimId,
              stance: eventClaims.stance,
              title: claims.title,
              kind: claims.kind,
              fingerprint: claims.fingerprint,
              excerpt: claimEvidence.excerpt,
              excerptStart: claimEvidence.excerptStart,
              excerptEnd: claimEvidence.excerptEnd,
              evidenceId: claimEvidence.evidenceId,
            })
            .from(eventClaims)
            .innerJoin(claims, eq(eventClaims.claimId, claims.id))
            .leftJoin(
              claimEvidence,
              and(
                eq(claimEvidence.claimId, claims.id),
                inArray(claimEvidence.evidenceId, evidenceIds),
              ),
            )
            .where(eq(eventClaims.eventId, id))
            .limit(64)
        : [];
    const assessmentHistory = await ctx.db
      .select()
      .from(eventAssessments)
      .where(eq(eventAssessments.eventId, id))
      .orderBy(desc(eventAssessments.revision))
      .limit(12);
    const assessment = assessmentHistory[0];
    const assessmentIds = assessmentHistory.map((item) => item.id);
    const reasonRows =
      assessmentIds.length > 0
        ? await ctx.db
            .select()
            .from(eventAssessmentReasons)
            .where(inArray(eventAssessmentReasons.assessmentId, assessmentIds))
            .limit(64)
        : [];
    const identityIds = [
      ...new Set(
        evidence
          .map((item) => item.sourceIdentityId)
          .filter((item): item is string => Boolean(item)),
      ),
    ];
    const identityRows =
      identityIds.length > 0
        ? await ctx.db
            .select()
            .from(sourceIdentities)
            .where(inArray(sourceIdentities.id, identityIds))
            .limit(32)
        : [];
    const identityPolicies =
      identityIds.length > 0
        ? await ctx.db
            .select()
            .from(sourceIdentityPolicies)
            .where(
              and(
                inArray(sourceIdentityPolicies.identityId, identityIds),
                eq(sourceIdentityPolicies.active, true),
              ),
            )
            .limit(32)
        : [];
    const trustSnapshot = evidence.map((item) => {
      const identity = identityRows.find((row) => row.id === item.sourceIdentityId);
      const policy = identityPolicies
        .filter((row) => row.identityId === item.sourceIdentityId)
        .sort((left, right) => right.revision - left.revision)[0];
      const hostname = identity?.hostname ?? sourceHostname(item.canonicalUrl);
      const hostLabel = hostname && hostname !== "unknown-host" ? hostname : undefined;
      return {
        evidenceId: item.id,
        identityId: item.sourceIdentityId,
        hostname: hostLabel,
        displayName: identity?.displayName ?? identity?.externalId ?? hostLabel,
        platform: identity?.platform,
        trustTier: policy?.trustTier ?? "unknown",
        allowedUses: policy?.allowedUses ?? [],
        originKey: item.originKey,
      };
    });
    const documents =
      evidenceIds.length > 0
        ? await ctx.db
            .select({
              evidenceId: evidenceDocuments.evidenceId,
              summary: evidenceDocuments.extractedTitle,
              cleanedText: evidenceDocuments.cleanedText,
              status: evidenceDocuments.status,
            })
            .from(evidenceDocuments)
            .where(inArray(evidenceDocuments.evidenceId, evidenceIds))
            .limit(20)
        : [];
    const lifecycle = await loadEventTransitions(ctx, id);
    const outcomeRows = await ctx.db
      .select()
      .from(signalOutcomes)
      .where(eq(signalOutcomes.eventId, id))
      .limit(12);
    return {
      event: {
        ...event,
        catalystKind: catalystKindForEvent(
          ctx,
          event.marketDomainId,
          claimRows.map((item) => item.kind),
        ),
        leadTimeHours: leadTimeHours(event.firstObservedAt, event.firstPrimaryAt),
      },
      evidence,
      roles: links,
      observations: observationRows,
      assets: eventAssetRows,
      independence,
      skillTrace: analysis?.skillTrace,
      claims: claimRows.map((item) => ({
        ...item,
        catalystKind: catalystKindForClaim(ctx, event.marketDomainId, item.kind),
      })),
      assessment,
      assessments: assessmentHistory.map((item) => ({
        ...item,
        reasons: reasonRows.filter((reason) => reason.assessmentId === item.id),
      })),
      trustSnapshot,
      documents,
      lifecycle,
      outcomes: outcomeRows,
    };
  });
  app.get("/api/v1/scorecard", { preHandler: authed }, async () => {
    const rows = await loadScorecard(ctx);
    return { scorecard: rows };
  });
  app.get("/api/v1/scans", { preHandler: authed }, async (request) => {
    const query = pageQuerySchema.parse(request.query);
    const limit = clampPageSize(query.limit, ctx.config.RIDDLR_PAGE_SIZE);
    const before = parsePageCursor(query.before);
    const scanRows = before
      ? await ctx.db
          .select()
          .from(scans)
          .where(lt(scans.startedAt, before))
          .orderBy(desc(scans.startedAt))
          .limit(limit)
      : await ctx.db.select().from(scans).orderBy(desc(scans.startedAt)).limit(limit);
    const ids = scanRows.map((row) => row.id);
    const sourceRuns =
      ids.length > 0
        ? await ctx.db
            .select()
            .from(scanSourceRuns)
            .where(inArray(scanSourceRuns.scanId, ids))
            .limit(ids.length * ctx.config.RIDDLR_SCAN_SOURCE_LIMIT)
        : [];
    return { scans: scanRows, sourceRuns };
  });
  app.get("/api/v1/ai-usage", { preHandler: authed }, async (request) => {
    const query = pageQuerySchema.parse(request.query);
    const limit = clampPageSize(query.limit, ctx.config.RIDDLR_PAGE_SIZE);
    const before = parsePageCursor(query.before);
    const usage = before
      ? await ctx.db
          .select()
          .from(aiUsageEvents)
          .where(lt(aiUsageEvents.createdAt, before))
          .orderBy(desc(aiUsageEvents.createdAt))
          .limit(limit)
      : await ctx.db
          .select()
          .from(aiUsageEvents)
          .orderBy(desc(aiUsageEvents.createdAt))
          .limit(limit);
    return { usage };
  });
  app.get("/api/v1/health", { preHandler: authed }, async () => {
    let postgres = true;
    let valkey = true;
    try {
      await ctx.db.select().from(instanceSettings).limit(1);
    } catch {
      postgres = false;
    }
    try {
      await ctx.redis.ping();
    } catch {
      valkey = false;
    }
    const sourceRows = await ctx.db
      .select()
      .from(sources)
      .limit(ctx.config.RIDDLR_SCAN_SOURCE_LIMIT);
    const [enrichmentBacklog] = await ctx.db
      .select({ count: count() })
      .from(evidenceItems)
      .where(eq(evidenceItems.contentCompleteness, "snippet"));
    const [staleAssessments] = await ctx.db
      .select({ count: count() })
      .from(events)
      .where(eq(events.reliabilityStatus, "legacy_unassessed"));
    return {
      postgres,
      valkey,
      workerHeartbeat: await ctx.redis.get("riddlr:worker:heartbeat"),
      workerConcurrency: ctx.config.RIDDLR_WORKER_CONCURRENCY,
      memory: snapshotProcessMemory(),
      sources: sourceRows.map(publicSource),
      enrichmentBacklog: Number(enrichmentBacklog?.count ?? 0),
      staleAssessments: Number(staleAssessments?.count ?? 0),
      observations: await observationHealth(ctx),
    };
  });
  app.get("/api/v1/settings", { preHandler: authed }, async (request) => {
    const auth = await currentUser(ctx, request);
    const providers = await ctx.db.select().from(providerConfigs).limit(16);
    const settingsRows = await ctx.db.select().from(instanceSettings).limit(1);
    const llm = toPublicLlm(providers);
    return {
      llmConfigured: llm.configured,
      llm,
      email: {
        ...publicEmailSettings(await resolveEmailTransport(ctx)),
        resendSaved: providers.some((item) => item.kind === "resend" && Boolean(item.secretId)),
      },
      telegramConfigured: providers.some((item) => item.kind === "telegram"),
      whatsappConfigured: providers.some((item) => item.kind === "whatsapp"),
      totpEnabled: Boolean(auth && (await loadVerifiedTotpFactor(ctx, auth.user.id))),
      notificationPolicy: settingsRows[0]?.notificationPolicy ?? {
        minRisk: "moderate",
        cooldownMinutes: 30,
      },
      notificationTargets: await publicNotificationTargets(ctx),
      observationAlertRules: await publicObservationAlertRules(ctx),
      encryption: {
        alg: "aes-256-gcm",
        keyVersion: settingsRows[0]?.keyVersion ?? 1,
        previousKeyConfigured: Boolean(ctx.config.previousMasterKey),
      },
      sessionPolicy: {
        absoluteHours: ctx.config.RIDDLR_SESSION_ABSOLUTE_HOURS,
        idleMinutes: ctx.config.RIDDLR_SESSION_IDLE_MINUTES,
        maxSessions: ctx.config.RIDDLR_MAX_SESSIONS,
      },
      providers: providers.map((item) => ({
        kind: item.kind,
        settings: {
          ...item.settings,
          apiKey: undefined,
          accessToken: undefined,
          verifyToken: undefined,
        },
        configured: Boolean(item.secretId),
      })),
    };
  });
  app.post("/api/v1/settings/email", { preHandler: authed }, async (request) => {
    const body = emailSetupSchema.parse(request.body);
    const settingsRows = await ctx.db.select().from(instanceSettings).limit(1);
    const keyVersion = settingsRows[0]?.keyVersion ?? 1;
    const encrypted = encryptSecret({
      masterKey: ctx.masterKey,
      plaintext: body.apiKey,
      purpose: "resend",
      keyVersion,
      aad: `resend|${keyVersion}`,
    });
    const [secret] = await ctx.db
      .insert(encryptedSecrets)
      .values({
        purpose: "resend",
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        tag: encrypted.tag,
        alg: encrypted.alg,
        keyVersion,
      })
      .returning();
    await ctx.db.delete(providerConfigs).where(eq(providerConfigs.kind, "resend"));
    await ctx.db.insert(providerConfigs).values({
      kind: "resend",
      secretId: secret?.id,
      settings: { from: body.from, configured: true },
    });
    const auth = await currentUser(ctx, request);
    await ctx.db.insert(auditLogs).values({
      actorUserId: auth?.user.id,
      action: "settings.email",
      resource: "resend",
    });
    return { ok: true, configured: true };
  });
  app.delete("/api/v1/settings/email", { preHandler: authed }, async () => {
    await ctx.db.delete(providerConfigs).where(eq(providerConfigs.kind, "resend"));
    await ctx.db.delete(encryptedSecrets).where(eq(encryptedSecrets.purpose, "resend"));
    return { ok: true };
  });
  app.post("/api/v1/settings/llm", { preHandler: authed }, async (request, reply) => {
    const body = llmSetupSchema.parse(request.body);
    try {
      await assertSafeResolvedHttpUrl(body.baseUrl);
    } catch {
      return reply.code(400).send({
        error: { code: "unsafe_url", message: "LLM base URL host is not allowed." },
      });
    }
    try {
      await assertLlmReachable(ctx, body);
    } catch (error) {
      const code = (error as Error & { code?: string }).code;
      if (code === "llm_unreachable") {
        return reply.code(400).send({
          error: {
            code,
            message: error instanceof Error ? error.message : "Could not reach that model.",
          },
        });
      }
      throw error;
    }
    await saveLlmProvider(ctx, body);
    const auth = await currentUser(ctx, request);
    await ctx.db.insert(auditLogs).values({
      actorUserId: auth?.user.id,
      action: "settings.llm",
      resource: auth?.user.id,
    });
    return { ok: true, configured: true };
  });
  app.post("/api/v1/settings/totp/start", { ...totpLimit, preHandler: authed }, async (request) => {
    const auth = await currentUser(ctx, request);
    requireUser(auth);
    return startTotpEnrollment(ctx, auth.user.id, auth.user.email);
  });
  app.post(
    "/api/v1/settings/totp/verify",
    { ...totpLimit, preHandler: authed },
    async (request, reply) => {
      const auth = await currentUser(ctx, request);
      requireUser(auth);
      const body = totpVerifySchema.parse(request.body);
      const result = await confirmTotpEnrollment(ctx, auth.user.id, body.token);
      if (!result.ok) {
        if (result.code === "invalid_totp") {
          ctx.metrics.authEvents.inc({ result: "invalid_totp" });
          return reply.code(401).send({ error: { code: result.code, message: result.message } });
        }
        const status = result.code === "totp_enabled" ? 409 : 400;
        return reply.code(status).send({ error: { code: result.code, message: result.message } });
      }
      await ctx.db.insert(auditLogs).values({
        actorUserId: auth.user.id,
        action: "auth.totp_enabled",
        resource: auth.user.id,
      });
      return { recoveryCodes: result.recoveryCodes, totpEnabled: true };
    },
  );
  app.get("/api/v1/sessions", { preHandler: authed }, async (request) => {
    const auth = await currentUser(ctx, request);
    requireUser(auth);
    const rows = await ctx.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, auth.user.id),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(sessions.lastSeenAt))
      .limit(ctx.config.RIDDLR_MAX_SESSIONS);
    return {
      sessions: rows
        .filter((row) => row.id === auth.session.id || !isIdleExpired(ctx, row.lastSeenAt))
        .map((row) => ({
          id: row.id,
          current: row.id === auth.session.id,
          createdAt: row.createdAt,
          lastSeenAt: row.lastSeenAt,
          expiresAt: row.expiresAt,
          ip: row.ip,
          userAgent: row.userAgent,
        })),
    };
  });
  app.post("/api/v1/sessions/:id/revoke", { preHandler: authed }, async (request, reply) => {
    const auth = await currentUser(ctx, request);
    requireUser(auth);
    const { id } = request.params as { id: string };
    const rows = await ctx.db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
    const session = rows[0];
    if (!session || session.userId !== auth.user.id) {
      return reply.code(404).send({ error: { code: "not_found", message: "Session not found" } });
    }
    await revokeSession(ctx, id);
    await ctx.db.insert(auditLogs).values({
      actorUserId: auth.user.id,
      action: "auth.session_revoke",
      resource: id,
    });
    if (id === auth.session.id) {
      reply.clearCookie(COOKIE, sessionCookieOptions(ctx));
    }
    return { ok: true, current: id === auth.session.id };
  });
  app.post("/api/v1/sessions/revoke-others", { preHandler: authed }, async (request) => {
    const auth = await currentUser(ctx, request);
    requireUser(auth);
    await revokeOtherSessions(ctx, auth.user.id, auth.session.id);
    await ctx.db.insert(auditLogs).values({
      actorUserId: auth.user.id,
      action: "auth.session_revoke_others",
      resource: auth.user.id,
    });
    return { ok: true };
  });
  app.get("/api/v1/auth/recovery", { preHandler: authed }, async (request) => {
    const auth = await currentUser(ctx, request);
    requireUser(auth);
    const [row] = await ctx.db
      .select({ remaining: count() })
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, auth.user.id), isNull(recoveryCodes.usedAt)));
    return { remaining: Number(row?.remaining ?? 0) };
  });
  app.post("/api/v1/auth/recovery/rotate", { preHandler: authed }, async (request, reply) => {
    const auth = await currentUser(ctx, request);
    requireUser(auth);
    const body = recoveryRotateSchema.parse(request.body);
    const factor = await loadVerifiedTotpFactor(ctx, auth.user.id);
    if (!factor) {
      return reply
        .code(400)
        .send({ error: { code: "missing_totp", message: "No TOTP configured." } });
    }
    const secret = decryptTotpSecret(ctx, factor, auth.user.id);
    if (!verifyTotp(secret, body.token)) {
      return reply.code(401).send({ error: { code: "invalid_totp", message: "Invalid code." } });
    }
    const codes = generateRecoveryCodes();
    await ctx.db.delete(recoveryCodes).where(eq(recoveryCodes.userId, auth.user.id));
    await ctx.db
      .insert(recoveryCodes)
      .values(codes.map((code) => ({ userId: auth.user.id, codeHash: hashRecoveryCode(code) })));
    await ctx.db.insert(auditLogs).values({
      actorUserId: auth.user.id,
      action: "auth.recovery_rotate",
      resource: auth.user.id,
    });
    await sendSecurityMail({
      ctx,
      to: auth.user.email,
      kind: "recovery_rotated",
      text: "New recovery codes were generated. Previous unused codes no longer work.",
    });
    return { recoveryCodes: codes };
  });
  app.get("/api/v1/audit", { preHandler: authed }, async (request) => {
    const query = pageQuerySchema.parse(request.query);
    const limit = clampPageSize(query.limit, ctx.config.RIDDLR_PAGE_SIZE);
    const before = parsePageCursor(query.before);
    const rows = before
      ? await ctx.db
          .select()
          .from(auditLogs)
          .where(lt(auditLogs.createdAt, before))
          .orderBy(desc(auditLogs.createdAt))
          .limit(limit)
      : await ctx.db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
    return { audit: rows };
  });
  app.delete("/api/v1/audit", { preHandler: authed }, async (request) => {
    const auth = await currentUser(ctx, request);
    requireUser(auth);
    await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM audit_logs`);
      await tx.insert(auditLogs).values({
        actorUserId: auth.user.id,
        action: "audit.cleared",
      });
    });
    return { ok: true };
  });
  app.post("/api/v1/settings/encryption/rotate", { preHandler: authed }, async (request, reply) => {
    const auth = await currentUser(ctx, request);
    requireUser(auth);
    const body = keyRotateSchema.parse(request.body);
    if (!(await verifyPassword(auth.user.passwordHash, body.currentPassword))) {
      return reply
        .code(401)
        .send({ error: { code: "invalid_credentials", message: "Invalid credentials." } });
    }
    const totp = await loadVerifiedTotpFactor(ctx, auth.user.id);
    if (totp) {
      if (!body.token) {
        return reply
          .code(400)
          .send({ error: { code: "missing_totp", message: "Authenticator code is required." } });
      }
      const secret = decryptTotpSecret(ctx, totp, auth.user.id);
      if (!verifyTotp(secret, body.token)) {
        return reply.code(401).send({ error: { code: "invalid_totp", message: "Invalid code." } });
      }
    }
    const rotated = await rotateEncryptionKeys(ctx);
    await ctx.db.insert(auditLogs).values({
      actorUserId: auth.user.id,
      action: "secrets.key_rotate",
      resource: String(rotated.keyVersion),
    });
    await sendSecurityMail({
      ctx,
      to: auth.user.email,
      kind: "keys_rotated",
      text: `Encryption key version is now ${rotated.keyVersion}. Stored credentials were re-encrypted in batches.`,
    });
    return rotated;
  });
  app.get("/api/v1/notifications", { preHandler: authed }, async (request) => {
    const query = pageQuerySchema.parse(request.query);
    const limit = clampPageSize(query.limit, ctx.config.RIDDLR_PAGE_SIZE);
    const before = parsePageCursor(query.before);
    const deliveries = before
      ? await ctx.db
          .select()
          .from(notificationDeliveries)
          .where(lt(notificationDeliveries.createdAt, before))
          .orderBy(desc(notificationDeliveries.createdAt))
          .limit(limit)
      : await ctx.db
          .select()
          .from(notificationDeliveries)
          .orderBy(desc(notificationDeliveries.createdAt))
          .limit(limit);
    return { deliveries };
  });

  const setup = await getSetupState(ctx);
  if (setup.completed) {
    const [defaultAgent] = await ctx.db
      .select()
      .from(agents)
      .where(eq(agents.kind, "system_default"))
      .limit(1);
    await ensureShippedCryptoSkills(ctx, defaultAgent?.id);
  }

  return app;
}

export { QUEUE_NAMES };
