import {
  discordWebhookTargetSchema,
  notificationRouteSchema,
  observationAlertRuleSchema,
} from "@riddlr/api-contract";
import { encryptSecret } from "@riddlr/crypto";
import {
  agentNotificationRoutes,
  agents,
  auditLogs,
  encryptedSecrets,
  instanceSettings,
  notificationTargets,
  observationAlertRules,
  providerConfigs,
} from "@riddlr/db";
import {
  DISCORD_WEBHOOK_URL_RE,
  INSTANCE_TELEGRAM_TARGET_ID,
  INSTANCE_WHATSAPP_TARGET_ID,
  MAX_NOTIFICATION_ROUTES_PER_AGENT,
  MAX_NOTIFICATION_TARGETS,
  MAX_OBSERVATION_ALERT_RULES,
  takeBounded,
} from "@riddlr/domain";
import { parseDiscordWebhookUrl, validateDiscordWebhook } from "@riddlr/notifications";
import { assertSafeResolvedHttpUrl, type LookupFn } from "@riddlr/source-adapters";
import { count, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../context.js";

function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

export async function assertDiscordWebhookTargetUrl(url: string, lookup?: LookupFn) {
  if (!DISCORD_WEBHOOK_URL_RE.test(url) || !parseDiscordWebhookUrl(url)) {
    const error = new Error("Discord webhook URL shape is invalid.");
    (error as Error & { code: string }).code = "invalid_webhook_url";
    throw error;
  }
  try {
    return await assertSafeResolvedHttpUrl(url, [], lookup);
  } catch {
    const error = new Error("Discord webhook URL host is not allowed.");
    (error as Error & { code: string }).code = "unsafe_url";
    throw error;
  }
}

export async function publicNotificationTargets(ctx: AppContext) {
  const rows = await ctx.db.select().from(notificationTargets).limit(MAX_NOTIFICATION_TARGETS);
  return takeBounded(rows, MAX_NOTIFICATION_TARGETS).map((row) => ({
    id: row.id,
    channel: row.channel,
    destination: row.destination,
    name: row.name,
    guildId: row.guildId,
    username: row.username,
    isPrimary: row.isPrimary,
    status: row.status,
    createdAt: row.createdAt,
  }));
}

export async function publicObservationAlertRules(ctx: AppContext) {
  const rows = await ctx.db.select().from(observationAlertRules).limit(MAX_OBSERVATION_ALERT_RULES);
  return takeBounded(rows, MAX_OBSERVATION_ALERT_RULES).map((row) => ({
    id: row.id,
    metric: row.metric,
    op: row.op,
    threshold: row.threshold,
    windowMinutes: row.windowMinutes,
    subjectCanonicalId: row.subjectCanonicalId,
    provider: row.provider,
    targetIds: row.targetIds,
    enabled: row.enabled,
    createdAt: row.createdAt,
  }));
}

async function knownTargetIds(ctx: AppContext): Promise<Set<string>> {
  const rows = await ctx.db
    .select({ id: notificationTargets.id })
    .from(notificationTargets)
    .limit(MAX_NOTIFICATION_TARGETS);
  const providers = await ctx.db
    .select({ kind: providerConfigs.kind })
    .from(providerConfigs)
    .limit(16);
  const ids = new Set(rows.map((row) => row.id));
  if (providers.some((item) => item.kind === "telegram")) {
    ids.add(INSTANCE_TELEGRAM_TARGET_ID);
  }
  if (providers.some((item) => item.kind === "whatsapp")) {
    ids.add(INSTANCE_WHATSAPP_TARGET_ID);
  }
  return ids;
}

export async function createDiscordWebhookTarget(
  ctx: AppContext,
  input: { webhookUrl: string; username?: string; avatarUrl?: string; primary?: boolean },
  deps?: { fetchImpl?: typeof fetch; lookup?: LookupFn },
) {
  await assertDiscordWebhookTargetUrl(input.webhookUrl, deps?.lookup);
  if (input.avatarUrl) {
    await assertSafeResolvedHttpUrl(input.avatarUrl, [], deps?.lookup);
  }
  const [{ value: existing } = { value: 0 }] = await ctx.db
    .select({ value: count() })
    .from(notificationTargets);
  if (Number(existing) >= MAX_NOTIFICATION_TARGETS) {
    const error = new Error(`At most ${MAX_NOTIFICATION_TARGETS} Discord webhook targets.`);
    (error as Error & { code: string }).code = "target_limit";
    throw error;
  }
  const validated = await validateDiscordWebhook({
    url: input.webhookUrl,
    fetchImpl: deps?.fetchImpl,
  });
  if (!validated.ok) {
    const error = new Error(validated.message);
    (error as Error & { code: string }).code = "discord_webhook_invalid";
    throw error;
  }
  const settingsRows = await ctx.db.select().from(instanceSettings).limit(1);
  const keyVersion = settingsRows[0]?.keyVersion ?? 1;
  const encrypted = encryptSecret({
    masterKey: ctx.masterKey,
    plaintext: input.webhookUrl,
    purpose: "discord_webhook",
    keyVersion,
    aad: `discord_webhook|${keyVersion}`,
  });
  const [secret] = await ctx.db
    .insert(encryptedSecrets)
    .values({
      purpose: "discord_webhook",
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      tag: encrypted.tag,
      alg: encrypted.alg,
      keyVersion,
    })
    .returning();
  if (input.primary) {
    await ctx.db.update(notificationTargets).set({ isPrimary: false });
  }
  const [row] = await ctx.db
    .insert(notificationTargets)
    .values({
      channel: "discord",
      name: validated.info.name,
      destination: validated.info.channelId,
      guildId: validated.info.guildId,
      username: input.username,
      avatarUrl: input.avatarUrl,
      isPrimary: Boolean(input.primary),
      status: "ok",
      secretId: secret?.id,
    })
    .returning();
  return row;
}

export function registerNotificationTargetRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  authed: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
) {
  app.get("/api/v1/notification-targets", { preHandler: authed }, async () => ({
    targets: await publicNotificationTargets(ctx),
  }));

  app.post("/api/v1/notification-targets", { preHandler: authed }, async (request, reply) => {
    const body = discordWebhookTargetSchema.parse(request.body);
    try {
      const row = await createDiscordWebhookTarget(ctx, body);
      const auth = (request as FastifyRequest & { auth?: { user: { id: string } } }).auth;
      await ctx.db.insert(auditLogs).values({
        actorUserId: auth?.user.id,
        action: "settings.discord_webhook",
        resource: row?.id,
      });
      return {
        target: row
          ? {
              id: row.id,
              channel: row.channel,
              destination: row.destination,
              name: row.name,
              isPrimary: row.isPrimary,
              status: row.status,
            }
          : undefined,
      };
    } catch (error) {
      const code = (error as Error & { code?: string }).code;
      if (
        code === "invalid_webhook_url" ||
        code === "unsafe_url" ||
        code === "discord_webhook_invalid" ||
        code === "target_limit"
      ) {
        return sendError(
          reply,
          400,
          code,
          error instanceof Error ? error.message : "Invalid Discord webhook.",
        );
      }
      throw error;
    }
  });

  app.delete("/api/v1/notification-targets/:id", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await ctx.db
      .select()
      .from(notificationTargets)
      .where(eq(notificationTargets.id, id))
      .limit(1);
    if (!row) {
      return sendError(reply, 404, "not_found", "Notification target not found");
    }
    await ctx.db.delete(notificationTargets).where(eq(notificationTargets.id, id));
    if (row.secretId) {
      await ctx.db.delete(encryptedSecrets).where(eq(encryptedSecrets.id, row.secretId));
    }
    return { ok: true };
  });

  app.get(
    "/api/v1/agents/:id/notification-routes",
    { preHandler: authed },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const [agent] = await ctx.db.select().from(agents).where(eq(agents.id, id)).limit(1);
      if (!agent) {
        return sendError(reply, 404, "not_found", "Agent not found");
      }
      const routes = await ctx.db
        .select()
        .from(agentNotificationRoutes)
        .where(eq(agentNotificationRoutes.agentId, id))
        .limit(MAX_NOTIFICATION_ROUTES_PER_AGENT);
      return { routes: takeBounded(routes, MAX_NOTIFICATION_ROUTES_PER_AGENT) };
    },
  );

  app.post(
    "/api/v1/agents/:id/notification-routes",
    { preHandler: authed },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const [agent] = await ctx.db.select().from(agents).where(eq(agents.id, id)).limit(1);
      if (!agent) {
        return sendError(reply, 404, "not_found", "Agent not found");
      }
      const body = notificationRouteSchema.parse(request.body);
      const [{ value: existing } = { value: 0 }] = await ctx.db
        .select({ value: count() })
        .from(agentNotificationRoutes)
        .where(eq(agentNotificationRoutes.agentId, id));
      if (Number(existing) >= MAX_NOTIFICATION_ROUTES_PER_AGENT) {
        return sendError(
          reply,
          400,
          "route_limit",
          `At most ${MAX_NOTIFICATION_ROUTES_PER_AGENT} routing rules per agent.`,
        );
      }
      const known = await knownTargetIds(ctx);
      if (body.targetIds.some((targetId) => !known.has(targetId))) {
        return sendError(reply, 400, "unknown_target", "A routing target does not exist.");
      }
      const [row] = await ctx.db
        .insert(agentNotificationRoutes)
        .values({
          agentId: id,
          minImpact: body.minImpact,
          catalystKinds: body.catalystKinds,
          assetCanonicalIds: body.assetCanonicalIds,
          reliabilityStatuses: body.reliabilityStatuses,
          includeEarlyWarnings: body.includeEarlyWarnings,
          targetIds: body.targetIds,
        })
        .returning();
      return { route: row };
    },
  );

  app.delete(
    "/api/v1/agents/:id/notification-routes/:routeId",
    { preHandler: authed },
    async (request, reply) => {
      const { id, routeId } = request.params as { id: string; routeId: string };
      const [row] = await ctx.db
        .select()
        .from(agentNotificationRoutes)
        .where(eq(agentNotificationRoutes.id, routeId))
        .limit(1);
      if (!row || row.agentId !== id) {
        return sendError(reply, 404, "not_found", "Notification route not found");
      }
      await ctx.db.delete(agentNotificationRoutes).where(eq(agentNotificationRoutes.id, routeId));
      return { ok: true };
    },
  );

  app.get("/api/v1/observation-alert-rules", { preHandler: authed }, async () => ({
    rules: await publicObservationAlertRules(ctx),
  }));

  app.post("/api/v1/observation-alert-rules", { preHandler: authed }, async (request, reply) => {
    const body = observationAlertRuleSchema.parse(request.body);
    const [{ value: existing } = { value: 0 }] = await ctx.db
      .select({ value: count() })
      .from(observationAlertRules);
    if (Number(existing) >= MAX_OBSERVATION_ALERT_RULES) {
      return sendError(
        reply,
        400,
        "alert_limit",
        `At most ${MAX_OBSERVATION_ALERT_RULES} observation alert rules.`,
      );
    }
    const [row] = await ctx.db
      .insert(observationAlertRules)
      .values({
        metric: body.metric,
        op: body.op,
        threshold: body.threshold,
        windowMinutes: body.windowMinutes,
        subjectCanonicalId: body.subjectCanonicalId,
        provider: body.provider,
        targetIds: body.targetIds,
        enabled: true,
      })
      .returning();
    return { rule: row };
  });

  app.delete(
    "/api/v1/observation-alert-rules/:id",
    { preHandler: authed },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const [row] = await ctx.db
        .select()
        .from(observationAlertRules)
        .where(eq(observationAlertRules.id, id))
        .limit(1);
      if (!row) {
        return sendError(reply, 404, "not_found", "Observation alert rule not found");
      }
      await ctx.db.delete(observationAlertRules).where(eq(observationAlertRules.id, id));
      return { ok: true };
    },
  );
}
