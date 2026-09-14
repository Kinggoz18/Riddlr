import { decryptSecretWithKeys } from "@riddlr/crypto";
import {
  agentNotificationRoutes,
  agents,
  assets,
  encryptedSecrets,
  eventAssets,
  eventEvidence,
  events,
  evidenceItems,
  instanceSettings,
  notificationDeliveries,
  notificationTargets,
  observationAlertRules,
  observationSeries,
  providerConfigs,
  signals,
  whatsappSessions,
} from "@riddlr/db";
import {
  confirmationTargetIds,
  DISCORD_WEBHOOK_QUEUE_CAP,
  defaultNotificationRoutes,
  evaluateObservationAlert,
  type ImpactLevel,
  INSTANCE_TELEGRAM_TARGET_ID,
  INSTANCE_WHATSAPP_TARGET_ID,
  MAX_DISCORD_WEBHOOK_PER_MINUTE,
  MAX_NOTIFICATION_ROUTES_PER_AGENT,
  MAX_NOTIFICATION_TARGETS,
  MAX_OBSERVATION_ALERT_RULES,
  type NotificationRoute,
  observationAlertHourBucket,
  observationAlertLookbackMs,
  orderByImpactPriority,
  pickPrimaryTargetId,
  selectRoutedTargetIds,
  sourceHostname,
  takeBounded,
} from "@riddlr/domain";
import {
  buildDiscordObservationPayload,
  buildDiscordSignalPayload,
  DEFAULT_NOTIFICATION_POLICY,
  decideNotification,
  decideObservationNotification,
  executeDiscordWebhook,
  formatObservationAlert,
  formatSignalNotification,
  sendTelegramMessage,
  sendWhatsAppSessionText,
  sendWhatsAppTemplate,
  sessionWindowOpen,
} from "@riddlr/notifications";
import { and, count, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { AppContext } from "../context.js";
import { markFirstNotifiedAt } from "./event-lifecycle.js";

const IMPACT_SET = new Set(["informational", "low", "moderate", "high", "critical"]);

type NotifyKind = "signal" | "early_warning" | "confirmation" | "dispute" | "retraction";
type DeliveryKind = "signal" | "observation";

type AvailableTarget = {
  id: string;
  channel: "telegram" | "whatsapp" | "discord";
  destination: string;
  status: "ok" | "auth";
  secretId?: string;
  username?: string;
  avatarUrl?: string;
  telegramChatId?: string;
  whatsapp?: {
    phoneNumberId: string;
    to: string;
    templateName?: string;
    templateLanguage?: string;
    graphVersion?: string;
  };
};

type Policy = {
  minRisk: "low" | "moderate" | "high" | "critical";
  cooldownMs: number;
  quietHours?: { startHour: number; endHour: number };
  earlyWarnings: boolean;
};

function asImpact(value: string | null | undefined): ImpactLevel {
  if (value && IMPACT_SET.has(value)) {
    return value as ImpactLevel;
  }
  return "moderate";
}

function riskLevel(value: string): "low" | "moderate" | "high" | "critical" {
  if (value === "low" || value === "moderate" || value === "high" || value === "critical") {
    return value;
  }
  return "moderate";
}

function notifyKindOf(value: string | null | undefined): NotifyKind {
  if (
    value === "early_warning" ||
    value === "confirmation" ||
    value === "dispute" ||
    value === "retraction"
  ) {
    return value;
  }
  return "signal";
}

function destinationKey(channel: string, destination: string): string {
  return `${channel}:${destination}`;
}

function ageLabel(at?: Date | null): string | undefined {
  if (!at) {
    return undefined;
  }
  const minutes = Math.max(0, Math.round((Date.now() - at.getTime()) / 60_000));
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

async function decryptPurpose(
  ctx: AppContext,
  secretId: string,
  purpose: string,
): Promise<string | undefined> {
  const secretRows = await ctx.db
    .select()
    .from(encryptedSecrets)
    .where(eq(encryptedSecrets.id, secretId))
    .limit(1);
  const secret = secretRows[0];
  if (!secret) {
    return undefined;
  }
  return decryptSecretWithKeys({
    keys: ctx.masterKeys,
    secret: {
      ciphertext: secret.ciphertext,
      nonce: secret.nonce,
      tag: secret.tag,
      alg: "aes-256-gcm",
      keyVersion: secret.keyVersion,
    },
    purpose,
    aad: `${secret.purpose}|${secret.keyVersion}`,
  });
}

export async function loadAvailableNotificationTargets(
  ctx: AppContext,
): Promise<AvailableTarget[]> {
  const providers = await ctx.db.select().from(providerConfigs).limit(16);
  const discordRows = await ctx.db
    .select()
    .from(notificationTargets)
    .limit(MAX_NOTIFICATION_TARGETS);
  const targets: AvailableTarget[] = [];
  const telegram = providers.find((item) => item.kind === "telegram");
  if (telegram?.secretId) {
    const chatId = String((telegram.settings as { chatId?: string }).chatId ?? "");
    targets.push({
      id: INSTANCE_TELEGRAM_TARGET_ID,
      channel: "telegram",
      destination: destinationKey("telegram", chatId),
      status: "ok",
      secretId: telegram.secretId,
      telegramChatId: chatId,
    });
  }
  const whatsapp = providers.find((item) => item.kind === "whatsapp");
  if (whatsapp?.secretId) {
    const settings = whatsapp.settings as {
      phoneNumberId?: string;
      to?: string;
      templateName?: string;
      templateLanguage?: string;
      graphVersion?: string;
    };
    const to = String(settings.to ?? "");
    targets.push({
      id: INSTANCE_WHATSAPP_TARGET_ID,
      channel: "whatsapp",
      destination: destinationKey("whatsapp", to),
      status: "ok",
      secretId: whatsapp.secretId,
      whatsapp: {
        phoneNumberId: String(settings.phoneNumberId ?? ""),
        to,
        templateName: settings.templateName,
        templateLanguage: settings.templateLanguage,
        graphVersion: settings.graphVersion,
      },
    });
  }
  for (const row of takeBounded(discordRows, MAX_NOTIFICATION_TARGETS)) {
    if (row.channel !== "discord") {
      continue;
    }
    targets.push({
      id: row.id,
      channel: "discord",
      destination: row.destination,
      status: row.status === "auth" ? "auth" : "ok",
      secretId: row.secretId ?? undefined,
      username: row.username ?? undefined,
      avatarUrl: row.avatarUrl ?? undefined,
    });
  }
  return targets;
}

async function loadInstancePolicy(ctx: AppContext): Promise<Policy> {
  const settingsRows = await ctx.db.select().from(instanceSettings).limit(1);
  const stored = settingsRows[0]?.notificationPolicy;
  return {
    minRisk: stored?.minRisk ?? DEFAULT_NOTIFICATION_POLICY.minRisk,
    cooldownMs: (stored?.cooldownMinutes ?? 30) * 60 * 1000,
    quietHours: stored?.quietHours,
    earlyWarnings: Boolean(stored?.earlyWarnings),
  };
}

async function loadAgentRoutes(ctx: AppContext, agentId: string): Promise<NotificationRoute[]> {
  const rows = await ctx.db
    .select()
    .from(agentNotificationRoutes)
    .where(eq(agentNotificationRoutes.agentId, agentId))
    .limit(MAX_NOTIFICATION_ROUTES_PER_AGENT);
  return takeBounded(rows, MAX_NOTIFICATION_ROUTES_PER_AGENT).map((row) => ({
    minImpact: asImpact(row.minImpact),
    catalystKinds: row.catalystKinds ?? [],
    assetCanonicalIds: row.assetCanonicalIds ?? [],
    reliabilityStatuses: row.reliabilityStatuses ?? [],
    includeEarlyWarnings: row.includeEarlyWarnings,
    targetIds: row.targetIds ?? [],
  }));
}

async function lastSentDestination(ctx: AppContext, channel: string, destination: string) {
  const [row] = await ctx.db
    .select()
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.channel, channel),
        eq(notificationDeliveries.destination, destination),
        eq(notificationDeliveries.status, "sent"),
      ),
    )
    .orderBy(desc(notificationDeliveries.createdAt))
    .limit(1);
  return row?.createdAt;
}

async function pendingForTarget(ctx: AppContext, targetId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ value: count() })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.targetId, targetId),
        eq(notificationDeliveries.status, "pending"),
      ),
    );
  return Number(row?.value ?? 0);
}

async function consumeDiscordBudget(
  ctx: AppContext,
  targetId: string,
  impact: ImpactLevel,
): Promise<"ok" | "rate_limited"> {
  const minute = new Date().toISOString().slice(0, 16);
  const key = `riddlr:notify:discord:${targetId}:${minute}`;
  const n = await ctx.redis.incr(key);
  if (n === 1) {
    await ctx.redis.expire(key, 70);
  }
  if (n > MAX_DISCORD_WEBHOOK_PER_MINUTE && (impact === "informational" || impact === "low")) {
    return "rate_limited";
  }
  return "ok";
}

async function claimDelivery(input: {
  ctx: AppContext;
  signalId?: string;
  kind: DeliveryKind;
  channel: "telegram" | "whatsapp" | "discord";
  destination: string;
  targetId?: string;
  key: string;
  observation?: {
    ruleId: string;
    metric: string;
    value: number;
    threshold: number;
    provider: string;
    observedAt: Date;
  };
}): Promise<{ id: string; attempt: number } | "skip"> {
  const inserted = await input.ctx.db
    .insert(notificationDeliveries)
    .values({
      signalId: input.signalId,
      kind: input.kind,
      targetId: input.targetId,
      observationRuleId: input.observation?.ruleId,
      observationMetric: input.observation?.metric,
      observationValue: input.observation?.value,
      observationThreshold: input.observation?.threshold,
      observationProvider: input.observation?.provider,
      observedAt: input.observation?.observedAt,
      channel: input.channel,
      destination: input.destination,
      status: "pending",
      idempotencyKey: input.key,
      attempt: 1,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) {
    return { id: inserted[0].id, attempt: inserted[0].attempt };
  }
  const [existing] = await input.ctx.db
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.idempotencyKey, input.key))
    .limit(1);
  if (!existing) {
    return "skip";
  }
  if (
    existing.status === "sent" ||
    existing.status === "suppressed" ||
    existing.status === "dead"
  ) {
    return "skip";
  }
  if (existing.status === "pending") {
    const staleMs = Date.now() - existing.updatedAt.getTime();
    if (staleMs < 60_000) {
      return "skip";
    }
  }
  if (existing.attempt >= 8) {
    await input.ctx.db
      .update(notificationDeliveries)
      .set({ status: "dead", errorClass: "retry_exhausted", updatedAt: new Date() })
      .where(eq(notificationDeliveries.id, existing.id));
    return "skip";
  }
  const [claimed] = await input.ctx.db
    .update(notificationDeliveries)
    .set({
      status: "pending",
      attempt: existing.attempt + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(notificationDeliveries.id, existing.id),
        eq(notificationDeliveries.status, existing.status),
      ),
    )
    .returning();
  return claimed ? { id: claimed.id, attempt: claimed.attempt } : "skip";
}

async function finishDelivery(
  ctx: AppContext,
  id: string,
  status: "sent" | "failed",
  extra?: { providerMessageId?: string; errorClass?: string; eventId?: string },
) {
  await ctx.db
    .update(notificationDeliveries)
    .set({
      status,
      providerMessageId: extra?.providerMessageId,
      errorClass: extra?.errorClass,
      updatedAt: new Date(),
    })
    .where(eq(notificationDeliveries.id, id));
  if (status === "sent" && extra?.eventId) {
    await markFirstNotifiedAt(ctx, extra.eventId, new Date());
  }
}

async function recordTerminal(input: {
  ctx: AppContext;
  key: string;
  signalId?: string;
  kind: DeliveryKind;
  channel: string;
  destination: string;
  targetId?: string;
  status: "suppressed" | "failed";
  errorClass?: string;
  observation?: {
    ruleId: string;
    metric: string;
    value: number;
    threshold: number;
    provider: string;
    observedAt: Date;
  };
}) {
  await input.ctx.db
    .insert(notificationDeliveries)
    .values({
      signalId: input.signalId,
      kind: input.kind,
      targetId: input.targetId,
      observationRuleId: input.observation?.ruleId,
      observationMetric: input.observation?.metric,
      observationValue: input.observation?.value,
      observationThreshold: input.observation?.threshold,
      observationProvider: input.observation?.provider,
      observedAt: input.observation?.observedAt,
      channel: input.channel,
      destination: input.destination,
      status: input.status,
      errorClass: input.errorClass,
      idempotencyKey: input.key,
    })
    .onConflictDoNothing();
}

async function sendTelegram(
  ctx: AppContext,
  target: AvailableTarget,
  body: string,
  fetchImpl?: typeof fetch,
): Promise<{ ok: boolean; message: string; providerMessageId?: string; errorClass?: string }> {
  if (!target.secretId || !target.telegramChatId) {
    return { ok: false, message: "missing_secret", errorClass: "missing_secret" };
  }
  const token = await decryptPurpose(ctx, target.secretId, "telegram");
  if (!token) {
    return { ok: false, message: "missing_secret", errorClass: "missing_secret" };
  }
  const result = await sendTelegramMessage({
    token,
    chatId: target.telegramChatId,
    text: body,
    fetchImpl,
  });
  return {
    ok: result.ok,
    message: result.message,
    errorClass: result.ok ? undefined : "provider_error",
  };
}

async function sendWhatsApp(
  ctx: AppContext,
  target: AvailableTarget,
  body: string,
  fetchImpl?: typeof fetch,
): Promise<{ ok: boolean; message: string; providerMessageId?: string; errorClass?: string }> {
  if (!target.secretId || !target.whatsapp) {
    return { ok: false, message: "missing_secret", errorClass: "missing_secret" };
  }
  const accessToken = await decryptPurpose(ctx, target.secretId, "whatsapp");
  if (!accessToken) {
    return { ok: false, message: "missing_secret", errorClass: "missing_secret" };
  }
  const settings = target.whatsapp;
  const graphBase = `https://graph.facebook.com/${settings.graphVersion ?? "v22"}.0`;
  const [session] = await ctx.db
    .select()
    .from(whatsappSessions)
    .where(eq(whatsappSessions.toE164, settings.to.replace(/\D+/g, "")))
    .limit(1);
  if (sessionWindowOpen(session?.lastInboundAt)) {
    const result = await sendWhatsAppSessionText({
      accessToken,
      phoneNumberId: settings.phoneNumberId,
      to: settings.to,
      text: body,
      lastInboundAt: session?.lastInboundAt,
      graphBase,
      fetchImpl,
    });
    return {
      ok: result.ok,
      message: result.message,
      providerMessageId: result.providerMessageId,
      errorClass: result.ok ? undefined : "provider_error",
    };
  }
  if (settings.templateName) {
    const result = await sendWhatsAppTemplate({
      accessToken,
      phoneNumberId: settings.phoneNumberId,
      to: settings.to,
      templateName: settings.templateName,
      templateLanguage: settings.templateLanguage ?? "en_US",
      bodyText: body.slice(0, 1024),
      graphBase,
      fetchImpl,
    });
    return {
      ok: result.ok,
      message: result.message,
      providerMessageId: result.providerMessageId,
      errorClass: result.ok ? undefined : "provider_error",
    };
  }
  return {
    ok: false,
    message: "WhatsApp session window is closed and no approved template is configured.",
    errorClass: "provider_error",
  };
}

async function sendDiscord(
  ctx: AppContext,
  target: AvailableTarget,
  payload: { content: string; embeds: Parameters<typeof executeDiscordWebhook>[0]["embeds"] },
  fetchImpl?: typeof fetch,
): Promise<{ ok: boolean; message: string; providerMessageId?: string; errorClass?: string }> {
  if (target.status === "auth") {
    return { ok: false, message: "Discord webhook was deleted.", errorClass: "auth" };
  }
  if (!target.secretId) {
    return { ok: false, message: "missing_secret", errorClass: "missing_secret" };
  }
  const url = await decryptPurpose(ctx, target.secretId, "discord_webhook");
  if (!url) {
    return { ok: false, message: "missing_secret", errorClass: "missing_secret" };
  }
  const result = await executeDiscordWebhook({
    url,
    content: payload.content,
    embeds: payload.embeds,
    username: target.username,
    avatarUrl: target.avatarUrl,
    fetchImpl,
  });
  if (result.errorClass === "auth") {
    await ctx.db
      .update(notificationTargets)
      .set({ status: "auth" })
      .where(eq(notificationTargets.id, target.id));
  }
  return result;
}

async function deliverToTarget(input: {
  ctx: AppContext;
  target: AvailableTarget;
  key: string;
  signalId?: string;
  kind: DeliveryKind;
  body: string;
  discordPayload?: {
    content: string;
    embeds: Parameters<typeof executeDiscordWebhook>[0]["embeds"];
  };
  policy: Policy;
  impact: ImpactLevel;
  risk?: "low" | "moderate" | "high" | "critical";
  eventId?: string;
  fetchImpl?: typeof fetch;
  observation?: {
    ruleId: string;
    metric: string;
    value: number;
    threshold: number;
    provider: string;
    observedAt: Date;
  };
}) {
  const decision =
    input.kind === "observation"
      ? decideObservationNotification({
          policy: input.policy,
          lastSentAt: await lastSentDestination(
            input.ctx,
            input.target.channel,
            input.target.destination,
          ),
        })
      : decideNotification({
          policy: input.policy,
          risk: input.risk ?? "moderate",
          lastSentAt: await lastSentDestination(
            input.ctx,
            input.target.channel,
            input.target.destination,
          ),
        });
  if (!decision.send) {
    await recordTerminal({
      ctx: input.ctx,
      key: `${input.key}:suppressed`,
      signalId: input.signalId,
      kind: input.kind,
      channel: input.target.channel,
      destination: input.target.destination,
      targetId: input.target.id,
      status: "suppressed",
      observation: input.observation,
    });
    return;
  }
  if (input.target.channel === "discord") {
    const pending = await pendingForTarget(input.ctx, input.target.id);
    if (pending >= DISCORD_WEBHOOK_QUEUE_CAP) {
      await recordTerminal({
        ctx: input.ctx,
        key: input.key,
        signalId: input.signalId,
        kind: input.kind,
        channel: input.target.channel,
        destination: input.target.destination,
        targetId: input.target.id,
        status: "failed",
        errorClass: "queue_overflow",
        observation: input.observation,
      });
      return;
    }
    const budget = await consumeDiscordBudget(input.ctx, input.target.id, input.impact);
    if (budget === "rate_limited") {
      await recordTerminal({
        ctx: input.ctx,
        key: input.key,
        signalId: input.signalId,
        kind: input.kind,
        channel: input.target.channel,
        destination: input.target.destination,
        targetId: input.target.id,
        status: "failed",
        errorClass: "rate_limited",
        observation: input.observation,
      });
      return;
    }
  }
  const claimed = await claimDelivery({
    ctx: input.ctx,
    signalId: input.signalId,
    kind: input.kind,
    channel: input.target.channel,
    destination: input.target.destination,
    targetId: input.target.id,
    key: input.key,
    observation: input.observation,
  });
  if (claimed === "skip") {
    return;
  }
  let result: { ok: boolean; message: string; providerMessageId?: string; errorClass?: string };
  if (input.target.channel === "telegram") {
    result = await sendTelegram(input.ctx, input.target, input.body, input.fetchImpl);
  } else if (input.target.channel === "whatsapp") {
    result = await sendWhatsApp(input.ctx, input.target, input.body, input.fetchImpl);
  } else {
    result = await sendDiscord(
      input.ctx,
      input.target,
      input.discordPayload ?? { content: input.body.slice(0, 2000), embeds: [] },
      input.fetchImpl,
    );
  }
  await finishDelivery(input.ctx, claimed.id, result.ok ? "sent" : "failed", {
    providerMessageId: result.providerMessageId,
    errorClass: result.ok ? undefined : (result.errorClass ?? "provider_error"),
    eventId: input.eventId,
  });
}

async function resolveSignalTargetIds(input: {
  ctx: AppContext;
  agentId: string;
  eventId: string;
  notifyKind: NotifyKind;
  impact: ImpactLevel;
  catalystKind?: string;
  assetCanonicalIds: string[];
  reliability?: string;
  earlyWarningsEnabled: boolean;
  available: AvailableTarget[];
}): Promise<string[]> {
  if (
    input.notifyKind === "confirmation" ||
    input.notifyKind === "dispute" ||
    input.notifyKind === "retraction"
  ) {
    const priorSignals = await input.ctx.db
      .select({ id: signals.id })
      .from(signals)
      .where(eq(signals.eventId, input.eventId))
      .limit(32);
    const priorIds = takeBounded(
      priorSignals.map((row) => row.id),
      32,
    );
    const prior =
      priorIds.length > 0
        ? await input.ctx.db
            .select({
              channel: notificationDeliveries.channel,
              destination: notificationDeliveries.destination,
            })
            .from(notificationDeliveries)
            .where(inArray(notificationDeliveries.signalId, priorIds))
            .limit(64)
        : [];
    const mapped = confirmationTargetIds({
      prior: prior
        .filter((row) => row.destination)
        .map((row) => ({ channel: row.channel, destination: row.destination as string })),
      available: input.available.map((target) => ({
        id: target.id,
        channel: target.channel,
        destination: target.destination,
      })),
    });
    if (mapped.length > 0) {
      return mapped;
    }
  }
  const custom = await loadAgentRoutes(input.ctx, input.agentId);
  const discordPrimary = input.available.find((item) => item.channel === "discord" && item.id)?.id;
  const primaryRows = await input.ctx.db
    .select({ id: notificationTargets.id })
    .from(notificationTargets)
    .where(eq(notificationTargets.isPrimary, true))
    .limit(1);
  const routes =
    custom.length > 0
      ? custom
      : defaultNotificationRoutes({
          allTargetIds: input.available.map((item) => item.id),
          primaryTargetId: pickPrimaryTargetId({
            discordPrimaryId: primaryRows[0]?.id ?? discordPrimary,
            telegramConfigured: input.available.some(
              (item) => item.id === INSTANCE_TELEGRAM_TARGET_ID,
            ),
            whatsappConfigured: input.available.some(
              (item) => item.id === INSTANCE_WHATSAPP_TARGET_ID,
            ),
            discordIds: input.available
              .filter((item) => item.channel === "discord")
              .map((item) => item.id),
          }),
          earlyWarningsEnabled: input.earlyWarningsEnabled,
        });
  return selectRoutedTargetIds(routes, {
    impact: input.impact,
    catalystKind: input.catalystKind,
    assetCanonicalIds: input.assetCanonicalIds,
    reliability: input.reliability,
    notifyKind: input.notifyKind,
    earlyWarningsEnabled: input.earlyWarningsEnabled,
  });
}

export async function enqueueSignalNotifications(ctx: AppContext, signalId: string) {
  await deliverSignalNotifications(ctx, signalId);
}

export async function maybeNotify(
  ctx: AppContext,
  signalId: string,
  _risk: string,
  _headline: string,
  fetchImpl?: typeof fetch,
) {
  await deliverSignalNotifications(ctx, signalId, fetchImpl);
}

export async function deliverSignalNotifications(
  ctx: AppContext,
  signalId: string,
  fetchImpl?: typeof fetch,
) {
  const [signal] = await ctx.db.select().from(signals).where(eq(signals.id, signalId)).limit(1);
  if (!signal || signal.notifyEligible === false) {
    return;
  }
  const policy = await loadInstancePolicy(ctx);
  const [event] = await ctx.db.select().from(events).where(eq(events.id, signal.eventId)).limit(1);
  const [agent] = await ctx.db.select().from(agents).where(eq(agents.id, signal.agentId)).limit(1);
  const linked = await ctx.db
    .select({
      canonicalUrl: evidenceItems.canonicalUrl,
      publishedAt: evidenceItems.publishedAt,
      fetchedAt: evidenceItems.fetchedAt,
      adapterId: evidenceItems.adapterId,
    })
    .from(eventEvidence)
    .innerJoin(evidenceItems, eq(eventEvidence.evidenceId, evidenceItems.id))
    .where(eq(eventEvidence.eventId, signal.eventId))
    .limit(8);
  const assetRows = await ctx.db
    .select({ canonicalId: assets.canonicalId })
    .from(eventAssets)
    .innerJoin(assets, eq(eventAssets.assetId, assets.id))
    .where(eq(eventAssets.eventId, signal.eventId))
    .limit(16);
  const assetCanonicalIds = takeBounded(
    assetRows.map((row) => row.canonicalId),
    16,
  );
  const hosts = [
    ...new Set(
      linked
        .map((row) => sourceHostname(row.canonicalUrl))
        .filter((item) => item && item !== "unknown-host"),
    ),
  ];
  const newest = linked
    .map((row) => row.publishedAt ?? row.fetchedAt)
    .sort((left, right) => right.getTime() - left.getTime())[0];
  const kind = notifyKindOf(signal.notifyKind);
  const impact = asImpact(event?.impactLevel);
  const reliability = event?.reliabilityStatus ?? undefined;
  const catalystKind = event?.catalystKind ?? undefined;
  const age = ageLabel(newest ?? event?.windowStart ?? signal.createdAt);
  const proofUrl = `${ctx.config.RIDDLR_PUBLIC_URL}/signals/${signal.id}`;
  const body = formatSignalNotification({
    headline: signal.headline,
    whyItMatters: signal.whyItMatters,
    proofSummary: signal.proof.summary,
    risk: signal.risk,
    invalidation: signal.invalidationConditions ?? undefined,
    publicUrl: proofUrl,
    kind,
    sourceLabel: hosts[0] ?? linked[0]?.adapterId ?? undefined,
    ageLabel: age,
    reliability,
    catalystKind,
    independentOrigins: event?.independentCount,
  });
  const discordPayload = buildDiscordSignalPayload({
    headline: signal.headline,
    kind,
    reliability,
    whyItMatters: signal.whyItMatters,
    catalystKind,
    impact,
    independentOrigins: event?.independentCount,
    ageLabel: age,
    assets: assetCanonicalIds,
    proofUrl,
    agentName: agent?.name,
  });
  const available = await loadAvailableNotificationTargets(ctx);
  const targetIds = await resolveSignalTargetIds({
    ctx,
    agentId: signal.agentId,
    eventId: signal.eventId,
    notifyKind: kind,
    impact,
    catalystKind,
    assetCanonicalIds,
    reliability,
    earlyWarningsEnabled: policy.earlyWarnings,
    available,
  });
  const selected = orderByImpactPriority(
    targetIds
      .map((id) => available.find((item) => item.id === id))
      .filter((item): item is AvailableTarget => Boolean(item))
      .map((item) => ({ ...item, impact })),
  );
  for (const target of selected) {
    const key =
      target.channel === "telegram"
        ? `signal:${signal.id}:telegram:${target.telegramChatId ?? target.destination}`
        : target.channel === "whatsapp"
          ? `signal:${signal.id}:whatsapp:${target.whatsapp?.to ?? target.destination}`
          : `signal:${signal.id}:discord:${target.id}`;
    await deliverToTarget({
      ctx,
      target,
      key,
      signalId: signal.id,
      kind: "signal",
      body,
      discordPayload,
      policy,
      impact,
      risk: riskLevel(signal.risk),
      eventId: signal.eventId,
      fetchImpl,
    });
  }
  for (const id of targetIds) {
    if (available.some((item) => item.id === id)) {
      continue;
    }
    await recordTerminal({
      ctx,
      key: `signal:${signalId}:missing:${id}`,
      signalId: signal.id,
      kind: "signal",
      channel: "discord",
      destination: id,
      targetId: id,
      status: "failed",
      errorClass: "target_missing",
    });
  }
}

export async function deliverObservationAlerts(
  ctx: AppContext,
  points: Array<{
    provider: string;
    metric: string;
    subjectCanonicalId: string;
    observedAt: Date;
    value: number;
    unit: string;
  }>,
  fetchImpl?: typeof fetch,
) {
  if (points.length === 0) {
    return;
  }
  const rules = takeBounded(
    await ctx.db
      .select()
      .from(observationAlertRules)
      .where(eq(observationAlertRules.enabled, true))
      .limit(MAX_OBSERVATION_ALERT_RULES),
    MAX_OBSERVATION_ALERT_RULES,
  );
  if (rules.length === 0) {
    return;
  }
  const policy = await loadInstancePolicy(ctx);
  const available = await loadAvailableNotificationTargets(ctx);
  if (available.length === 0) {
    return;
  }
  for (const point of takeBounded(points, 100)) {
    for (const rule of rules) {
      if (rule.metric !== point.metric) {
        continue;
      }
      if (rule.subjectCanonicalId && rule.subjectCanonicalId !== point.subjectCanonicalId) {
        continue;
      }
      if (rule.provider && rule.provider !== point.provider) {
        continue;
      }
      const op = rule.op as "gte" | "lte" | "pct_drop" | "pct_move";
      const lookbackMs = observationAlertLookbackMs(op, rule.windowMinutes ?? undefined);
      let baseline: number | undefined;
      if (lookbackMs > 0) {
        const targetAt = new Date(point.observedAt.getTime() - lookbackMs);
        const earliest = new Date(targetAt.getTime() - lookbackMs);
        const [prior] = await ctx.db
          .select({ value: observationSeries.value })
          .from(observationSeries)
          .where(
            and(
              eq(observationSeries.metric, point.metric),
              eq(observationSeries.subjectCanonicalId, point.subjectCanonicalId),
              lte(observationSeries.observedAt, targetAt),
              gte(observationSeries.observedAt, earliest),
            ),
          )
          .orderBy(desc(observationSeries.observedAt))
          .limit(1);
        baseline = prior?.value;
      }
      const verdict = evaluateObservationAlert({
        metric: rule.metric,
        op,
        threshold: rule.threshold,
        current: point.value,
        baseline,
      });
      if (!verdict.fired) {
        continue;
      }
      const hour = observationAlertHourBucket(point.observedAt);
      const wanted = takeBounded(rule.targetIds ?? [], MAX_NOTIFICATION_TARGETS);
      const ids = wanted.length > 0 ? wanted : available.map((item) => item.id);
      const body = formatObservationAlert({
        metric: rule.metric,
        op: rule.op,
        threshold: rule.threshold,
        value: point.value,
        unit: point.unit,
        provider: point.provider,
        subjectCanonicalId: point.subjectCanonicalId,
        observedAt: point.observedAt,
      });
      const discordPayload = buildDiscordObservationPayload({
        metric: rule.metric,
        op: rule.op,
        threshold: rule.threshold,
        value: point.value,
        unit: point.unit,
        provider: point.provider,
        subjectCanonicalId: point.subjectCanonicalId,
        observedAt: point.observedAt,
      });
      const observation = {
        ruleId: rule.id,
        metric: rule.metric,
        value: point.value,
        threshold: rule.threshold,
        provider: point.provider,
        observedAt: point.observedAt,
      };
      for (const targetId of ids) {
        const target = available.find((item) => item.id === targetId);
        const key = `observation:${rule.id}:${point.subjectCanonicalId}:${hour}:${targetId}`;
        if (!target) {
          await recordTerminal({
            ctx,
            key,
            kind: "observation",
            channel: "discord",
            destination: targetId,
            targetId,
            status: "failed",
            errorClass: "target_missing",
            observation,
          });
          continue;
        }
        await deliverToTarget({
          ctx,
          target,
          key,
          kind: "observation",
          body,
          discordPayload,
          policy,
          impact: "moderate",
          fetchImpl,
          observation,
        });
      }
    }
  }
}
