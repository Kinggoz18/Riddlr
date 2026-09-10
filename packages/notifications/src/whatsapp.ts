export const WHATSAPP_GRAPH_BASE = "https://graph.facebook.com/v22.0";
export const WHATSAPP_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
export const WHATSAPP_TIMESTAMP_SKEW_MS = 15 * 60 * 1000;
export const WHATSAPP_MAX_MESSAGE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function sessionWindowOpen(lastInboundAt: Date | undefined, now = new Date()): boolean {
  if (!lastInboundAt) {
    return false;
  }
  return now.getTime() - lastInboundAt.getTime() < WHATSAPP_SESSION_WINDOW_MS;
}

function digits(value: string): string {
  return value.replace(/\D+/g, "");
}

export type WhatsAppInbound = {
  from: string;
  timestamp: Date;
  messageId?: string;
};

export function parseWhatsAppUnixTimestamp(value: unknown, now = new Date()): Date | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }
  const timestamp = new Date(seconds * 1000);
  if (Number.isNaN(timestamp.getTime())) {
    return undefined;
  }
  const delta = timestamp.getTime() - now.getTime();
  if (delta > WHATSAPP_TIMESTAMP_SKEW_MS) {
    return undefined;
  }
  if (now.getTime() - timestamp.getTime() > WHATSAPP_MAX_MESSAGE_AGE_MS) {
    return undefined;
  }
  return timestamp;
}

export function parseWhatsAppInbound(payload: unknown, now = new Date()): WhatsAppInbound[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const body = payload as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: Array<{ from?: unknown; timestamp?: unknown; id?: unknown }>;
        };
      }>;
    }>;
  };
  const out: WhatsAppInbound[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        const from = typeof message.from === "string" ? digits(message.from) : "";
        if (from.length < 8 || from.length > 15) {
          continue;
        }
        const timestamp = parseWhatsAppUnixTimestamp(message.timestamp, now);
        if (!timestamp) {
          continue;
        }
        const messageId = typeof message.id === "string" ? message.id.slice(0, 128) : undefined;
        out.push({ from, timestamp, messageId });
        if (out.length >= 20) {
          return out;
        }
      }
    }
  }
  return out;
}

export async function sendWhatsAppTemplate(input: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  templateName: string;
  templateLanguage: string;
  bodyText: string;
  graphBase?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; message: string; providerMessageId?: string; status?: number }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const to = digits(input.to);
  const phoneNumberId = digits(input.phoneNumberId);
  if (to.length < 8 || phoneNumberId.length < 6 || !input.templateName.trim()) {
    return { ok: false, message: "WhatsApp template send is missing required fields." };
  }
  const base = input.graphBase ?? WHATSAPP_GRAPH_BASE;
  const response = await fetchImpl(`${base}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: input.templateName,
        language: { code: input.templateLanguage || "en_US" },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: input.bodyText.slice(0, 1024) }],
          },
        ],
      },
    }),
  });
  if (!response.ok) {
    return { ok: false, message: `WhatsApp HTTP ${response.status}`, status: response.status };
  }
  const body = (await response.json().catch(() => ({}))) as { messages?: Array<{ id?: string }> };
  return {
    ok: true,
    message: "sent",
    providerMessageId: body.messages?.[0]?.id,
    status: response.status,
  };
}

export async function sendWhatsAppSessionText(input: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  text: string;
  lastInboundAt?: Date;
  now?: Date;
  graphBase?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; message: string; providerMessageId?: string; status?: number }> {
  if (!sessionWindowOpen(input.lastInboundAt, input.now ?? new Date())) {
    return {
      ok: false,
      message: "WhatsApp customer-service window is closed. Use an approved template.",
    };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const to = digits(input.to);
  const phoneNumberId = digits(input.phoneNumberId);
  const base = input.graphBase ?? WHATSAPP_GRAPH_BASE;
  const response = await fetchImpl(`${base}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: input.text.slice(0, 4096), preview_url: false },
    }),
  });
  if (!response.ok) {
    return { ok: false, message: `WhatsApp HTTP ${response.status}`, status: response.status };
  }
  const body = (await response.json().catch(() => ({}))) as { messages?: Array<{ id?: string }> };
  return {
    ok: true,
    message: "sent",
    providerMessageId: body.messages?.[0]?.id,
    status: response.status,
  };
}

export function formatSignalNotification(input: {
  headline: string;
  whyItMatters?: string;
  proofSummary?: string;
  risk?: string;
  invalidation?: string;
  publicUrl?: string;
}): string {
  const lines = [`SIGNAL: ${input.headline}`];
  if (input.whyItMatters) {
    lines.push(`WHY: ${input.whyItMatters}`);
  }
  if (input.proofSummary) {
    lines.push(`PROOF: ${input.proofSummary}`);
  }
  if (input.risk) {
    lines.push(`RISK: ${input.risk}`);
  }
  if (input.invalidation) {
    lines.push(`INVALIDATION: ${input.invalidation}`);
  }
  if (input.publicUrl) {
    lines.push(input.publicUrl);
  }
  return lines.join("\n").slice(0, 3500);
}
