export type NotificationChannel = "telegram" | "whatsapp";

export type NotificationDecision = {
  send: boolean;
  reason: string;
};

export type NotificationPolicy = {
  minRisk: "low" | "moderate" | "high" | "critical";
  cooldownMs: number;
  quietHours?: { startHour: number; endHour: number };
};

export const DEFAULT_NOTIFICATION_POLICY: NotificationPolicy = {
  minRisk: "moderate",
  cooldownMs: 30 * 60 * 1000,
};

const RISK_RANK = { low: 0, moderate: 1, high: 2, critical: 3 };

export function decideNotification(input: {
  policy: NotificationPolicy;
  risk: keyof typeof RISK_RANK;
  lastSentAt?: Date;
  now?: Date;
}): NotificationDecision {
  const now = input.now ?? new Date();
  if (RISK_RANK[input.risk] < RISK_RANK[input.policy.minRisk]) {
    return { send: false, reason: "below_threshold" };
  }
  if (input.lastSentAt && now.getTime() - input.lastSentAt.getTime() < input.policy.cooldownMs) {
    return { send: false, reason: "cooldown" };
  }
  if (input.policy.quietHours) {
    const hour = now.getUTCHours();
    const { startHour, endHour } = input.policy.quietHours;
    const quiet =
      startHour <= endHour
        ? hour >= startHour && hour < endHour
        : hour >= startHour || hour < endHour;
    if (quiet) {
      return { send: false, reason: "quiet_hours" };
    }
  }
  return { send: true, reason: "ok" };
}

export function splitTelegramText(text: string, limit = 4096): string[] {
  if (text.length <= limit) {
    return [text];
  }
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += limit) {
    chunks.push(text.slice(i, i + limit));
  }
  return chunks;
}

export const MAX_TELEGRAM_RETRY_AFTER_SEC = 5;

function telegramRetryAfter(payload: unknown, header: string | null): number {
  if (payload && typeof payload === "object") {
    const parameters = (payload as { parameters?: { retry_after?: unknown } }).parameters;
    const fromBody = Number(parameters?.retry_after);
    if (Number.isFinite(fromBody) && fromBody > 0) {
      return fromBody;
    }
  }
  const fromHeader = Number(header);
  return Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader : 0;
}

export async function sendTelegramMessage(input: {
  token: string;
  chatId: string;
  text: string;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}): Promise<{ ok: boolean; message: string }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const sleepImpl =
    input.sleepImpl ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const chunks = splitTelegramText(input.text);
  for (const chunk of chunks) {
    const sendOnce = async () =>
      fetchImpl(`https://api.telegram.org/bot${input.token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: input.chatId,
          text: chunk,
          link_preview_options: { is_disabled: true },
        }),
      });
    let response = await sendOnce();
    if (response.status === 429) {
      const payload = await response.json().catch(() => ({}));
      const retryAfter = telegramRetryAfter(payload, response.headers.get("retry-after"));
      if (retryAfter > 0 && retryAfter <= MAX_TELEGRAM_RETRY_AFTER_SEC) {
        await sleepImpl(retryAfter * 1000);
        response = await sendOnce();
      } else {
        return { ok: false, message: `Telegram HTTP 429` };
      }
    }
    if (!response.ok) {
      return { ok: false, message: `Telegram HTTP ${response.status}` };
    }
  }
  return { ok: true, message: "sent" };
}

export {
  formatSignalNotification,
  parseWhatsAppInbound,
  parseWhatsAppUnixTimestamp,
  sendWhatsAppSessionText,
  sendWhatsAppTemplate,
  sessionWindowOpen,
  WHATSAPP_GRAPH_BASE,
  WHATSAPP_MAX_MESSAGE_AGE_MS,
  WHATSAPP_SESSION_WINDOW_MS,
  WHATSAPP_TIMESTAMP_SKEW_MS,
} from "./whatsapp.js";
