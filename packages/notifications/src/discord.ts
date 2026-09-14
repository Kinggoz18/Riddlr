export const DISCORD_WEBHOOK_URL_RE =
  /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d{17,20}\/[A-Za-z0-9_-]{60,}$/;

export const MAX_DISCORD_CONTENT_CHARS = 2_000;
export const MAX_DISCORD_EMBED_DESCRIPTION_CHARS = 1_000;
export const MAX_DISCORD_EMBED_TOTAL_CHARS = 6_000;
export const MAX_DISCORD_RETRY_AFTER_SEC = 5;
export const MAX_DISCORD_EXECUTE_RETRIES = 2;

export const RIDDLR_PRODUCT_VERSION = "0.1.0";

export type DiscordWebhookInfo = {
  channelId: string;
  guildId?: string;
  name?: string;
};

export type DiscordEmbed = {
  title: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
};

export type DiscordExecuteResult = {
  ok: boolean;
  message: string;
  providerMessageId?: string;
  errorClass?: string;
};

function webhookRetryAfter(payload: unknown, header: string | null): number {
  if (payload && typeof payload === "object") {
    const retryAfter = Number((payload as { retry_after?: unknown }).retry_after);
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      return retryAfter;
    }
  }
  const fromHeader = Number(header);
  return Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader : 0;
}

export function parseDiscordWebhookUrl(url: string): { origin: string; path: string } | undefined {
  if (!DISCORD_WEBHOOK_URL_RE.test(url)) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    return { origin: parsed.origin, path: parsed.pathname };
  } catch {
    return undefined;
  }
}

export function redactDiscordWebhookUrl(url: string): string {
  return url.replace(/\/[A-Za-z0-9_-]{60,}$/, "/[redacted]");
}

export function sanitizeNotificationText(value: string): string {
  return value
    .replaceAll(/@everyone/gi, "everyone")
    .replaceAll(/@here/gi, "here")
    .replaceAll(/<@!?&?\d+>/g, "")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function notifyKindPrefix(
  kind: "signal" | "early_warning" | "confirmation" | "dispute" | "retraction" | "observation",
): string {
  if (kind === "early_warning") {
    return "UNVERIFIED EARLY WARNING";
  }
  if (kind === "confirmation") {
    return "CONFIRMATION";
  }
  if (kind === "dispute") {
    return "DISPUTE";
  }
  if (kind === "retraction") {
    return "RETRACTION";
  }
  if (kind === "observation") {
    return "OBSERVATION";
  }
  return "SIGNAL";
}

function field(
  name: string,
  value: string,
  inline = true,
): { name: string; value: string; inline: boolean } {
  return { name, value: value.slice(0, 1024) || "—", inline };
}

function embedCharCount(embed: DiscordEmbed): number {
  const fields = (embed.fields ?? []).reduce(
    (sum, item) => sum + item.name.length + item.value.length,
    0,
  );
  return (
    embed.title.length +
    (embed.description?.length ?? 0) +
    (embed.footer?.text.length ?? 0) +
    (embed.url?.length ?? 0) +
    fields
  );
}

function clipEmbed(embed: DiscordEmbed): DiscordEmbed {
  if (embedCharCount(embed) <= MAX_DISCORD_EMBED_TOTAL_CHARS) {
    return embed;
  }
  const clipped = { ...embed, description: undefined };
  if (embedCharCount(clipped) <= MAX_DISCORD_EMBED_TOTAL_CHARS) {
    return clipped;
  }
  return { ...clipped, fields: clipped.fields?.slice(0, 2) };
}

export function buildDiscordSignalPayload(input: {
  headline: string;
  kind: "signal" | "early_warning" | "confirmation" | "dispute" | "retraction";
  reliability?: string;
  whyItMatters?: string;
  catalystKind?: string;
  impact?: string;
  independentOrigins?: number;
  ageLabel?: string;
  assets?: string[];
  proofUrl: string;
  agentName?: string;
}): { content: string; embeds: DiscordEmbed[] } {
  const prefix = notifyKindPrefix(input.kind);
  const title = sanitizeNotificationText(`${prefix} — ${input.headline}`).slice(0, 256);
  const description = input.whyItMatters
    ? sanitizeNotificationText(input.whyItMatters).slice(0, MAX_DISCORD_EMBED_DESCRIPTION_CHARS)
    : undefined;
  const embed = clipEmbed({
    title,
    description,
    url: input.proofUrl,
    color:
      input.kind === "early_warning"
        ? 0xf0b429
        : input.kind === "confirmation"
          ? 0x2f6f4e
          : input.kind === "dispute" || input.kind === "retraction"
            ? 0xb42318
            : 0x3d5a80,
    timestamp: new Date().toISOString(),
    fields: [
      field("Reliability", input.reliability ?? "—"),
      field("Catalyst", input.catalystKind ?? "—"),
      field("Impact", input.impact ?? "—"),
      field(
        "Independent origins",
        typeof input.independentOrigins === "number" ? String(input.independentOrigins) : "—",
      ),
      field("Source age", input.ageLabel ?? "—"),
      field("Assets", (input.assets ?? []).join(", ") || "—", false),
    ],
    footer: {
      text: sanitizeNotificationText(
        `${input.agentName ?? "Riddlr"} · Riddlr ${RIDDLR_PRODUCT_VERSION}`,
      ).slice(0, 2048),
    },
  });
  return {
    content: sanitizeNotificationText(`${prefix}: ${input.headline}`).slice(
      0,
      MAX_DISCORD_CONTENT_CHARS,
    ),
    embeds: [embed],
  };
}

export function buildDiscordObservationPayload(input: {
  metric: string;
  op: string;
  threshold: number;
  value: number;
  unit?: string;
  provider: string;
  subjectCanonicalId: string;
  observedAt: Date;
}): { content: string; embeds: DiscordEmbed[] } {
  const unit = input.unit ? ` ${input.unit}` : "";
  const title = "OBSERVATION — threshold crossed";
  return {
    content: "OBSERVATION: This is an observation, not a signal.",
    embeds: [
      clipEmbed({
        title,
        description: "This is an observation, not a signal.",
        color: 0x5c6b7a,
        timestamp: input.observedAt.toISOString(),
        fields: [
          field("Metric", input.metric),
          field("Value", `${input.value}${unit}`),
          field("Threshold", `${input.op} ${input.threshold}`),
          field("Provider", input.provider),
          field("Subject", input.subjectCanonicalId, false),
        ],
        footer: { text: `Riddlr ${RIDDLR_PRODUCT_VERSION}` },
      }),
    ],
  };
}

export async function validateDiscordWebhook(input: {
  url: string;
  fetchImpl?: typeof fetch;
}): Promise<
  { ok: true; info: DiscordWebhookInfo } | { ok: false; message: string; status?: number }
> {
  const parsed = parseDiscordWebhookUrl(input.url);
  if (!parsed) {
    return { ok: false, message: "Discord webhook URL shape is invalid." };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${parsed.origin}${parsed.path}`, {
    method: "GET",
    redirect: "manual",
  });
  if (response.status === 401 || response.status === 404) {
    return { ok: false, message: "Discord webhook was not found.", status: response.status };
  }
  if (!response.ok) {
    return {
      ok: false,
      message: `Discord webhook HTTP ${response.status}`,
      status: response.status,
    };
  }
  const body = (await response.json().catch(() => undefined)) as
    | { type?: unknown; channel_id?: unknown; guild_id?: unknown; name?: unknown }
    | undefined;
  if (!body || body.type !== 1 || typeof body.channel_id !== "string") {
    return { ok: false, message: "Discord webhook is not an incoming channel webhook." };
  }
  return {
    ok: true,
    info: {
      channelId: body.channel_id,
      guildId: typeof body.guild_id === "string" ? body.guild_id : undefined,
      name: typeof body.name === "string" ? body.name : undefined,
    },
  };
}

function sanitizeEmbed(embed: DiscordEmbed): DiscordEmbed {
  return {
    ...embed,
    title: sanitizeNotificationText(embed.title).slice(0, 256),
    description: embed.description
      ? sanitizeNotificationText(embed.description).slice(0, MAX_DISCORD_EMBED_DESCRIPTION_CHARS)
      : undefined,
    fields: embed.fields?.map((item) => ({
      ...item,
      name: sanitizeNotificationText(item.name).slice(0, 256),
      value: sanitizeNotificationText(item.value).slice(0, 1024),
    })),
    footer: embed.footer
      ? { text: sanitizeNotificationText(embed.footer.text).slice(0, 2048) }
      : undefined,
  };
}

export async function executeDiscordWebhook(input: {
  url: string;
  content?: string;
  embeds?: DiscordEmbed[];
  username?: string;
  avatarUrl?: string;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}): Promise<DiscordExecuteResult> {
  const parsed = parseDiscordWebhookUrl(input.url);
  if (!parsed) {
    return { ok: false, message: "Discord webhook URL shape is invalid.", errorClass: "malformed" };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const sleepImpl =
    input.sleepImpl ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const content = sanitizeNotificationText(
    (input.content ?? "").slice(0, MAX_DISCORD_CONTENT_CHARS),
  );
  const embeds = (input.embeds ?? []).slice(0, 1).map((embed) => sanitizeEmbed(clipEmbed(embed)));
  const post = async (body: Record<string, unknown>) =>
    fetchImpl(`${parsed.origin}${parsed.path}?wait=true`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      redirect: "manual",
      body: JSON.stringify({
        ...body,
        allowed_mentions: { parse: [] },
        ...(input.username ? { username: input.username.slice(0, 80) } : {}),
        ...(input.avatarUrl ? { avatar_url: input.avatarUrl } : {}),
      }),
    });
  let payload: Record<string, unknown> = {
    ...(content ? { content } : {}),
    ...(embeds.length > 0 ? { embeds } : {}),
  };
  let response = await post(payload);
  for (
    let attempt = 0;
    attempt < MAX_DISCORD_EXECUTE_RETRIES && response.status === 429;
    attempt += 1
  ) {
    const body = await response.json().catch(() => ({}));
    const retryAfter = webhookRetryAfter(
      body,
      response.headers.get("retry-after") ?? response.headers.get("x-ratelimit-reset-after"),
    );
    if (retryAfter <= 0 || retryAfter > MAX_DISCORD_RETRY_AFTER_SEC) {
      return { ok: false, message: "Discord HTTP 429", errorClass: "rate_limited" };
    }
    await sleepImpl(retryAfter * 1000);
    response = await post(payload);
  }
  if (response.status === 400 && embeds.length > 0) {
    payload = {
      content: (content || String(embeds[0]?.title ?? "Riddlr")).slice(
        0,
        MAX_DISCORD_CONTENT_CHARS,
      ),
    };
    response = await post(payload);
  }
  if (response.status === 401 || response.status === 404) {
    return { ok: false, message: "Discord webhook was deleted.", errorClass: "auth" };
  }
  if (response.status === 429) {
    return { ok: false, message: "Discord HTTP 429", errorClass: "rate_limited" };
  }
  if (!response.ok) {
    return { ok: false, message: `Discord HTTP ${response.status}`, errorClass: "provider_error" };
  }
  const sent = (await response.json().catch(() => undefined)) as { id?: unknown } | undefined;
  return {
    ok: true,
    message: "sent",
    providerMessageId: typeof sent?.id === "string" ? sent.id : undefined,
  };
}
