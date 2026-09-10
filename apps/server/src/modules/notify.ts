import { decryptSecretWithKeys } from "@riddlr/crypto";
import {
  encryptedSecrets,
  instanceSettings,
  notificationDeliveries,
  providerConfigs,
  signals,
  whatsappSessions,
} from "@riddlr/db";
import {
  DEFAULT_NOTIFICATION_POLICY,
  decideNotification,
  formatSignalNotification,
  sendTelegramMessage,
  sendWhatsAppSessionText,
  sendWhatsAppTemplate,
  sessionWindowOpen,
} from "@riddlr/notifications";
import { and, desc, eq } from "drizzle-orm";
import type { AppContext } from "../context.js";

function riskLevel(value: string): "low" | "moderate" | "high" | "critical" {
  if (value === "low" || value === "moderate" || value === "high" || value === "critical") {
    return value;
  }
  return "moderate";
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

function destinationKey(channel: string, destination: string): string {
  return `${channel}:${destination}`;
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
  if (!signal) {
    return;
  }
  const settingsRows = await ctx.db.select().from(instanceSettings).limit(1);
  const stored = settingsRows[0]?.notificationPolicy;
  const policy = {
    minRisk: stored?.minRisk ?? DEFAULT_NOTIFICATION_POLICY.minRisk,
    cooldownMs: (stored?.cooldownMinutes ?? 30) * 60 * 1000,
    quietHours: stored?.quietHours,
  };
  const body = formatSignalNotification({
    headline: signal.headline,
    whyItMatters: signal.whyItMatters,
    proofSummary: signal.proof.summary,
    risk: signal.risk,
    invalidation: signal.invalidationConditions ?? undefined,
    publicUrl: `${ctx.config.RIDDLR_PUBLIC_URL}/signals/${signal.id}`,
  });
  const providers = await ctx.db.select().from(providerConfigs).limit(8);
  await deliverTelegram(ctx, providers, signal, body, policy, fetchImpl);
  await deliverWhatsApp(ctx, providers, signal, body, policy, fetchImpl);
}

async function lastSentDestination(
  ctx: AppContext,
  channel: "telegram" | "whatsapp",
  destination: string,
) {
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

async function claimDelivery(input: {
  ctx: AppContext;
  signalId: string;
  channel: "telegram" | "whatsapp";
  destination: string;
  key: string;
}): Promise<{ id: string; attempt: number } | "skip"> {
  const inserted = await input.ctx.db
    .insert(notificationDeliveries)
    .values({
      signalId: input.signalId,
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
  extra?: { providerMessageId?: string; errorClass?: string },
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
}

async function deliverTelegram(
  ctx: AppContext,
  providers: Array<typeof providerConfigs.$inferSelect>,
  signal: typeof signals.$inferSelect,
  body: string,
  policy: {
    minRisk: "low" | "moderate" | "high" | "critical";
    cooldownMs: number;
    quietHours?: { startHour: number; endHour: number };
  },
  fetchImpl?: typeof fetch,
) {
  const telegram = providers.find((item) => item.kind === "telegram");
  if (!telegram?.secretId) {
    return;
  }
  const chatId = String((telegram.settings as { chatId?: string }).chatId ?? "");
  const destination = destinationKey("telegram", chatId);
  const key = `signal:${signal.id}:telegram:${chatId}`;
  const decision = decideNotification({
    policy,
    risk: riskLevel(signal.risk),
    lastSentAt: await lastSentDestination(ctx, "telegram", destination),
  });
  if (!decision.send) {
    await ctx.db
      .insert(notificationDeliveries)
      .values({
        signalId: signal.id,
        channel: "telegram",
        destination,
        status: "suppressed",
        idempotencyKey: `${key}:suppressed`,
      })
      .onConflictDoNothing();
    return;
  }
  const claimed = await claimDelivery({
    ctx,
    signalId: signal.id,
    channel: "telegram",
    destination,
    key,
  });
  if (claimed === "skip") {
    return;
  }
  const token = await decryptPurpose(ctx, telegram.secretId, "telegram");
  if (!token) {
    await finishDelivery(ctx, claimed.id, "failed", { errorClass: "missing_secret" });
    return;
  }
  const result = await sendTelegramMessage({ token, chatId, text: body, fetchImpl });
  await finishDelivery(ctx, claimed.id, result.ok ? "sent" : "failed", {
    errorClass: result.ok ? undefined : "provider_error",
  });
}

async function deliverWhatsApp(
  ctx: AppContext,
  providers: Array<typeof providerConfigs.$inferSelect>,
  signal: typeof signals.$inferSelect,
  body: string,
  policy: {
    minRisk: "low" | "moderate" | "high" | "critical";
    cooldownMs: number;
    quietHours?: { startHour: number; endHour: number };
  },
  fetchImpl?: typeof fetch,
) {
  const whatsapp = providers.find((item) => item.kind === "whatsapp");
  if (!whatsapp?.secretId) {
    return;
  }
  const settings = whatsapp.settings as {
    phoneNumberId?: string;
    to?: string;
    templateName?: string;
    templateLanguage?: string;
    graphVersion?: string;
  };
  const to = String(settings.to ?? "");
  const destination = destinationKey("whatsapp", to);
  const key = `signal:${signal.id}:whatsapp:${to}`;
  const decision = decideNotification({
    policy,
    risk: riskLevel(signal.risk),
    lastSentAt: await lastSentDestination(ctx, "whatsapp", destination),
  });
  if (!decision.send) {
    await ctx.db
      .insert(notificationDeliveries)
      .values({
        signalId: signal.id,
        channel: "whatsapp",
        destination,
        status: "suppressed",
        idempotencyKey: `${key}:suppressed`,
      })
      .onConflictDoNothing();
    return;
  }
  const claimed = await claimDelivery({
    ctx,
    signalId: signal.id,
    channel: "whatsapp",
    destination,
    key,
  });
  if (claimed === "skip") {
    return;
  }
  const accessToken = await decryptPurpose(ctx, whatsapp.secretId, "whatsapp");
  if (!accessToken) {
    await finishDelivery(ctx, claimed.id, "failed", { errorClass: "missing_secret" });
    return;
  }
  const phoneNumberId = String(settings.phoneNumberId ?? "");
  const graphBase = `https://graph.facebook.com/${settings.graphVersion ?? "v22"}.0`;
  const [session] = await ctx.db
    .select()
    .from(whatsappSessions)
    .where(eq(whatsappSessions.toE164, to.replace(/\D+/g, "")))
    .limit(1);
  const lastInboundAt = session?.lastInboundAt;
  let result: { ok: boolean; message: string; providerMessageId?: string };
  if (sessionWindowOpen(lastInboundAt)) {
    result = await sendWhatsAppSessionText({
      accessToken,
      phoneNumberId,
      to,
      text: body,
      lastInboundAt,
      graphBase,
      fetchImpl,
    });
  } else if (settings.templateName) {
    result = await sendWhatsAppTemplate({
      accessToken,
      phoneNumberId,
      to,
      templateName: settings.templateName,
      templateLanguage: settings.templateLanguage ?? "en_US",
      bodyText: body.slice(0, 1024),
      graphBase,
      fetchImpl,
    });
  } else {
    result = {
      ok: false,
      message: "WhatsApp session window is closed and no approved template is configured.",
    };
  }
  await finishDelivery(ctx, claimed.id, result.ok ? "sent" : "failed", {
    providerMessageId: result.providerMessageId,
    errorClass: result.ok ? undefined : "provider_error",
  });
}
