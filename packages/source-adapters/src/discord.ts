import {
  MAX_DISCORD_ATTACHMENTS,
  MAX_DISCORD_BODY_BYTES,
  MAX_DISCORD_CHANNELS,
  MAX_DISCORD_KEYWORDS,
  MAX_DISCORD_LOOKBACK_HOURS,
  MAX_DISCORD_MESSAGES_PER_CHANNEL,
  MAX_DISCORD_PAGES_PER_CHANNEL,
  MAX_DISCORD_REACTIONS,
  MAX_DISCORD_THREAD_PAGES,
  MAX_DISCORD_THREADS_PER_CHANNEL,
  takeBounded,
} from "@riddlr/domain";
import {
  classifyHttpStatus,
  type FetchQuery,
  type FetchResult,
  readBoundedJson,
  type SourceAdapter,
  type SourceErrorClass,
} from "./types.js";

export const DISCORD_API_BASE = "https://discord.com/api/v10";
export const DISCORD_EPOCH_MS = 1_420_070_400_000;
export const DISCORD_VIEW_CHANNEL = 1 << 10;
export const DISCORD_READ_MESSAGE_HISTORY = 1 << 16;
export const DISCORD_BOT_PERMISSIONS = DISCORD_VIEW_CHANNEL | DISCORD_READ_MESSAGE_HISTORY;
export {
  MAX_DISCORD_CHANNELS,
  MAX_DISCORD_KEYWORDS,
  MAX_DISCORD_LOOKBACK_HOURS,
  MAX_DISCORD_MESSAGES_PER_CHANNEL,
  MAX_DISCORD_PAGES_PER_CHANNEL,
  MAX_DISCORD_THREAD_PAGES,
};
export const SNOWFLAKE_RE = /^\d{17,20}$/;

const USER_AGENT = "DiscordBot (https://github.com/riddlr/riddlr, 0.5.0)";

type SourceError = FetchResult["errors"][number];
type DiscordAuthor = { id?: unknown; username?: unknown; bot?: unknown };
type DiscordEmbedField = { name?: unknown; value?: unknown };
type DiscordEmbed = {
  title?: unknown;
  description?: unknown;
  url?: unknown;
  timestamp?: unknown;
  footer?: { text?: unknown };
  fields?: unknown;
};
type DiscordAttachment = { filename?: unknown; content_type?: unknown };
type DiscordReaction = { count?: unknown; emoji?: { name?: unknown } };
type DiscordMessage = {
  id?: unknown;
  channel_id?: unknown;
  guild_id?: unknown;
  content?: unknown;
  timestamp?: unknown;
  edited_timestamp?: unknown;
  type?: unknown;
  webhook_id?: unknown;
  author?: DiscordAuthor;
  message_reference?: { message_id?: unknown; channel_id?: unknown; guild_id?: unknown };
  embeds?: unknown;
  attachments?: unknown;
  reactions?: unknown;
};

export function assertSnowflake(value: string, label: string): string {
  if (!SNOWFLAKE_RE.test(value)) {
    throw new Error(`${label} must be a Discord snowflake.`);
  }
  return value;
}

export function discordBotInviteUrl(
  clientId: string,
  permissions = DISCORD_BOT_PERMISSIONS,
): string {
  const id = assertSnowflake(clientId, "Application id");
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", id);
  url.searchParams.set("permissions", String(permissions));
  url.searchParams.set("scope", "bot");
  return url.toString();
}

export function applicationIdFromBotToken(token: string): string | undefined {
  const first = token.trim().split(".")[0];
  if (!first) {
    return undefined;
  }
  try {
    const padded =
      first.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (first.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    return SNOWFLAKE_RE.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

export function snowflakeFromDate(date: Date): string {
  const ms = BigInt(date.getTime() - DISCORD_EPOCH_MS);
  if (ms <= 0n) {
    return "0";
  }
  return (ms << 22n).toString();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesDiscordKeywords(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) {
    return true;
  }
  return keywords.some((keyword) => {
    const pattern = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(keyword)}([^A-Za-z0-9_]|$)`, "i");
    return pattern.test(text);
  });
}

function hostnameFromUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function joinDiscordEmbeds(value: unknown): { text: string; firstUrl?: string } {
  if (!Array.isArray(value)) {
    return { text: "" };
  }
  const parts: string[] = [];
  let firstUrl: string | undefined;
  for (const item of takeBounded(value, 10)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const embed = item as DiscordEmbed;
    if (typeof embed.title === "string" && embed.title.trim()) {
      parts.push(embed.title.trim());
    }
    if (typeof embed.description === "string" && embed.description.trim()) {
      parts.push(embed.description.trim());
    }
    if (typeof embed.url === "string" && !firstUrl) {
      firstUrl = embed.url;
    }
    const fields = Array.isArray(embed.fields) ? embed.fields : [];
    for (const field of takeBounded(fields, 25)) {
      if (!field || typeof field !== "object") {
        continue;
      }
      const row = field as DiscordEmbedField;
      const name = typeof row.name === "string" ? row.name.trim() : "";
      const fieldValue = typeof row.value === "string" ? row.value.trim() : "";
      if (name || fieldValue) {
        parts.push([name, fieldValue].filter(Boolean).join(": "));
      }
    }
    if (embed.footer && typeof embed.footer === "object" && typeof embed.footer.text === "string") {
      const footer = embed.footer.text.trim();
      if (footer) {
        parts.push(footer);
      }
    }
  }
  return { text: parts.join("\n"), firstUrl };
}

function attachmentMeta(value: unknown): Array<{ filename?: string; contentType?: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows: Array<{ filename?: string; contentType?: string }> = [];
  for (const item of takeBounded(value, MAX_DISCORD_ATTACHMENTS)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as DiscordAttachment;
    rows.push({
      filename: typeof row.filename === "string" ? row.filename : undefined,
      contentType: typeof row.content_type === "string" ? row.content_type : undefined,
    });
  }
  return rows;
}

function reactionMeta(value: unknown): Array<{ name?: string; count: number }> {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows: Array<{ name?: string; count: number }> = [];
  for (const item of takeBounded(value, MAX_DISCORD_REACTIONS)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as DiscordReaction;
    const count = typeof row.count === "number" && Number.isFinite(row.count) ? row.count : 0;
    rows.push({
      name: row.emoji && typeof row.emoji.name === "string" ? row.emoji.name : undefined,
      count,
    });
  }
  return rows;
}

function looksLikeHtml(payload: unknown, contentType: string | null): boolean {
  if (contentType?.toLowerCase().includes("text/html")) {
    return true;
  }
  return typeof payload === "string" && /<html[\s>]/i.test(payload);
}

export function parseDiscordMessages(
  payload: unknown,
  fetchedAt: Date,
  input: { guildId?: string; maxResults?: number },
): FetchResult {
  const errors: SourceError[] = [];
  const evidence: FetchResult["evidence"] = [];
  if (!Array.isArray(payload)) {
    return {
      evidence: [],
      partial: true,
      errors: [{ class: "malformed", message: "Discord messages payload was not an array." }],
      unresponsiveEngines: [],
    };
  }
  const rows = takeBounded(payload, input.maxResults ?? MAX_DISCORD_MESSAGES_PER_CHANNEL);
  let emptyContent = 0;
  for (const item of rows) {
    if (!item || typeof item !== "object") {
      errors.push({ class: "malformed", message: "Non-object Discord message skipped" });
      continue;
    }
    const row = item as DiscordMessage;
    const id = typeof row.id === "string" ? row.id : undefined;
    const channelId = typeof row.channel_id === "string" ? row.channel_id : undefined;
    if (!id || !channelId) {
      errors.push({ class: "malformed", message: "Message missing id or channel_id" });
      continue;
    }
    const content = typeof row.content === "string" ? row.content : "";
    const embeds = joinDiscordEmbeds(row.embeds);
    const bodyText = [content, embeds.text].filter((part) => part.trim()).join("\n\n");
    const guildId = typeof row.guild_id === "string" ? row.guild_id : (input.guildId ?? "@me");
    const authorId = row.author && typeof row.author.id === "string" ? row.author.id : undefined;
    const author =
      row.author && typeof row.author.username === "string" ? row.author.username : undefined;
    const referencedId =
      row.message_reference && typeof row.message_reference.message_id === "string"
        ? row.message_reference.message_id
        : undefined;
    const webhookId = typeof row.webhook_id === "string" ? row.webhook_id : undefined;
    const bot = Boolean(row.author?.bot);
    const embedHost = embeds.firstUrl ? hostnameFromUrl(embeds.firstUrl) : undefined;
    const referencedOriginKey = referencedId
      ? `discord:${referencedId}`
      : webhookId && embedHost
        ? `host:${embedHost}`
        : undefined;
    const originKey = referencedOriginKey
      ? referencedOriginKey
      : authorId
        ? `discord:${authorId}`
        : `discord:${id}`;
    if (!bodyText.trim()) {
      emptyContent += 1;
    }
    evidence.push({
      sourceFamily: "discord",
      adapterId: "discord",
      externalId: id,
      url: `https://discord.com/channels/${guildId}/${channelId}/${id}`,
      title: author ? `${author} in #${channelId}` : `Discord message ${id}`,
      bodyText,
      author,
      publishedAt: typeof row.timestamp === "string" ? new Date(row.timestamp) : undefined,
      fetchedAt,
      editedAt:
        typeof row.edited_timestamp === "string" ? new Date(row.edited_timestamp) : undefined,
      contentCompleteness: bodyText.trim() ? "native_complete" : "incomplete",
      sourceIdentity: authorId
        ? {
            platform: "discord",
            externalId: authorId,
            displayName: author,
            parentExternalId: channelId,
          }
        : undefined,
      originKey,
      referencedOriginKey,
      outboundUrls: embeds.firstUrl && hostnameFromUrl(embeds.firstUrl) ? [embeds.firstUrl] : [],
      adapterPayload: {
        channelId,
        guildId,
        messageId: id,
        webhookId,
        bot,
        messageType: row.type,
        attachments: attachmentMeta(row.attachments),
        reactions: reactionMeta(row.reactions),
        embedUrl: embeds.firstUrl,
      },
    });
  }
  if (rows.length > 0 && evidence.every((item) => !item.bodyText?.trim()) && emptyContent > 0) {
    errors.push({
      class: "capability_missing",
      message:
        "Message content was empty. Enable the MESSAGE_CONTENT privileged intent (1 << 15) for this application.",
    });
  }
  return {
    evidence,
    partial: errors.length > 0,
    errors,
    unresponsiveEngines: [],
  };
}

export function parseDiscordArchivedThreads(payload: unknown): {
  threadIds: string[];
  hasMore: boolean;
  before?: string;
  errors: SourceError[];
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      threadIds: [],
      hasMore: false,
      errors: [
        { class: "malformed", message: "Discord archived threads payload was not an object." },
      ],
    };
  }
  const body = payload as { threads?: unknown; has_more?: unknown };
  if (!Array.isArray(body.threads)) {
    return {
      threadIds: [],
      hasMore: false,
      errors: [{ class: "malformed", message: "Discord archived threads list is missing." }],
    };
  }
  const threadIds: string[] = [];
  let lastArchive: string | undefined;
  for (const item of takeBounded(body.threads, 100)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as {
      id?: unknown;
      thread_metadata?: { archive_timestamp?: unknown };
    };
    if (typeof row.id === "string" && SNOWFLAKE_RE.test(row.id)) {
      threadIds.push(row.id);
    }
    const stamp = row.thread_metadata?.archive_timestamp;
    if (typeof stamp === "string") {
      lastArchive = stamp;
    }
  }
  return {
    threadIds: takeBounded(threadIds, MAX_DISCORD_THREADS_PER_CHANNEL),
    hasMore: body.has_more === true,
    before: lastArchive,
    errors: [],
  };
}

function parseChannelList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return takeBounded(
    value.map((item) => String(item).trim()).filter((item) => SNOWFLAKE_RE.test(item)),
    MAX_DISCORD_CHANNELS,
  );
}

function parseKeywords(value: unknown, extra: string): string[] {
  const fromConfig = Array.isArray(value) ? value.map((item) => String(item)) : [];
  const fromQuery = extra.split(/\s+/);
  const unique = [
    ...new Set(
      [...fromConfig, ...fromQuery]
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length >= 2 && item.length <= 48),
    ),
  ];
  return takeBounded(unique, MAX_DISCORD_KEYWORDS);
}

function discordHeaders(token: string): HeadersInit {
  return {
    authorization: `Bot ${token}`,
    "user-agent": USER_AGENT,
  };
}

function discordHttpError(
  status: number,
  payload: unknown,
  channelId: string,
): { class: SourceErrorClass; message: string } {
  const row =
    payload && typeof payload === "object"
      ? (payload as { message?: unknown; code?: unknown })
      : {};
  const apiMessage = typeof row.message === "string" ? row.message : undefined;
  const code = typeof row.code === "number" ? row.code : undefined;
  if (status === 403) {
    if (code === 50001) {
      return {
        class: "blocked",
        message: `Missing Access (50001) on channel ${channelId}. Re-invite the bot with VIEW_CHANNEL and READ_MESSAGE_HISTORY.`,
      };
    }
    if (code === 50013) {
      return {
        class: "blocked",
        message: `Missing Permissions (50013) on channel ${channelId}. Need VIEW_CHANNEL or READ_MESSAGE_HISTORY.`,
      };
    }
    return {
      class: "blocked",
      message: `${apiMessage ?? "Forbidden"} on channel ${channelId}. Need VIEW_CHANNEL and READ_MESSAGE_HISTORY.`,
    };
  }
  if (status === 401) {
    return { class: "auth", message: `Discord HTTP 401 for channel ${channelId}` };
  }
  return {
    class: classifyHttpStatus(status),
    message: `Discord HTTP ${status} for channel ${channelId}`,
  };
}

async function readDiscordJson(
  response: Response,
): Promise<{ payload: unknown; error?: SourceError }> {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_DISCORD_BODY_BYTES) {
    return {
      payload: undefined,
      error: { class: "too_large", message: "Discord response exceeded the size bound." },
    };
  }
  const contentType = response.headers.get("content-type");
  try {
    const payload = await readBoundedJson(response, MAX_DISCORD_BODY_BYTES);
    if (looksLikeHtml(payload, contentType)) {
      return { payload, error: { class: "malformed", message: "Discord returned an HTML body." } };
    }
    return { payload };
  } catch (error) {
    if (!response.ok) {
      return { payload: undefined };
    }
    const message = error instanceof Error ? error.message : "Discord body could not be read.";
    return {
      payload: undefined,
      error: {
        class: message.includes("size bound") ? "too_large" : "malformed",
        message,
      },
    };
  }
}

function maxSnowflake(ids: string[]): string | undefined {
  if (ids.length === 0) {
    return undefined;
  }
  return ids.reduce((max, id) => (BigInt(id) > BigInt(max) ? id : max));
}

export function createDiscordAdapter(fetchImpl: typeof fetch = fetch): SourceAdapter {
  return {
    id: "discord",
    family: "discord",
    capabilities: {
      modes: ["poll"],
      supportsTimeRange: true,
      supportsPagination: true,
      supportsDomainFilter: false,
      lookbackNotes:
        "GET /channels/{channel.id}/messages returns at most 100 messages per request. after/before pagination is bounded to 5 pages per channel. Archived public threads are fetched for 2 pages. Lookback is 1–72 hours. This is not guild message-search archive access.",
      partialResults: true,
    },
    async validate(config) {
      const token = String(config.token ?? "");
      if (token.length < 8) {
        return { ok: false, message: "Bot token is required." };
      }
      try {
        const channels = parseChannelList(config.channelIds);
        if (channels.length === 0) {
          return { ok: false, message: "At least one channel snowflake is required." };
        }
        if (config.guildId) {
          assertSnowflake(String(config.guildId), "Server id");
        }
        const lookback = Number(config.lookbackHours ?? 6);
        if (!Number.isFinite(lookback) || lookback < 1 || lookback > MAX_DISCORD_LOOKBACK_HOURS) {
          return {
            ok: false,
            message: `Lookback must be 1–${MAX_DISCORD_LOOKBACK_HOURS} hours.`,
          };
        }
        if (config.liveValidate !== true) {
          return { ok: true, message: "Discord source looks valid." };
        }
        const me = await fetchImpl(`${DISCORD_API_BASE}/users/@me`, {
          headers: discordHeaders(token),
          signal: AbortSignal.timeout(8000),
        });
        if (me.status === 401 || me.status === 403) {
          return { ok: false, message: "Discord rejected the bot token." };
        }
        if (!me.ok) {
          return { ok: false, message: `Discord HTTP ${me.status}` };
        }
        const channelId = channels[0];
        if (channelId) {
          const channel = await fetchImpl(`${DISCORD_API_BASE}/channels/${channelId}`, {
            headers: discordHeaders(token),
            signal: AbortSignal.timeout(8000),
          });
          if (channel.status === 403) {
            return { ok: false, message: "Bot cannot view the configured channel." };
          }
        }
        return { ok: true, message: "Discord source looks valid." };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "Invalid Discord config",
        };
      }
    },
    async healthCheck(config) {
      const token = String(config.token ?? "");
      if (token.length < 8) {
        return { ok: false, message: "Bot token is required." };
      }
      try {
        const response = await fetchImpl(`${DISCORD_API_BASE}/users/@me`, {
          headers: discordHeaders(token),
          signal: AbortSignal.timeout(8000),
        });
        if (response.status === 401 || response.status === 403) {
          return { ok: false, message: "Discord rejected the bot token." };
        }
        if (!response.ok) {
          return { ok: false, message: `Discord HTTP ${response.status}` };
        }
        const channels = parseChannelList(config.channelIds);
        const channelId = channels[0];
        if (!channelId) {
          return { ok: true, message: "Bot token is valid. Add a channel id to poll messages." };
        }
        const messages = await fetchImpl(
          `${DISCORD_API_BASE}/channels/${channelId}/messages?limit=1`,
          { headers: discordHeaders(token), signal: AbortSignal.timeout(8000) },
        );
        if (messages.status === 403) {
          const { payload } = await readDiscordJson(messages);
          return { ok: false, message: discordHttpError(403, payload, channelId).message };
        }
        if (!messages.ok) {
          return { ok: false, message: `Discord channel HTTP ${messages.status}` };
        }
        const parsed = parseDiscordMessages(await messages.json(), new Date(), {
          guildId: typeof config.guildId === "string" ? config.guildId : undefined,
          maxResults: 1,
        });
        if (parsed.errors.some((item) => item.class === "capability_missing")) {
          return {
            ok: false,
            message: parsed.errors[0]?.message ?? "MESSAGE_CONTENT intent missing.",
          };
        }
        return { ok: true, message: "Discord bot can read recent channel messages." };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "Discord health check failed",
        };
      }
    },
    async fetch(config, query: FetchQuery) {
      const validated = await this.validate(config);
      if (!validated.ok) {
        return {
          evidence: [],
          partial: true,
          errors: [{ class: "malformed", message: validated.message }],
          unresponsiveEngines: [],
        };
      }
      const token = String(config.token ?? "");
      const excluded = new Set(parseChannelList(config.excludeChannelIds));
      const channels = parseChannelList(config.channelIds).filter((id) => !excluded.has(id));
      const keywords = parseKeywords(config.keywords, "");
      const lookbackHours = Math.min(
        MAX_DISCORD_LOOKBACK_HOURS,
        Math.max(1, Number(config.lookbackHours ?? 6)),
      );
      const after = snowflakeFromDate(new Date(Date.now() - lookbackHours * 60 * 60 * 1000));
      const fetchedAt = new Date();
      const errors: SourceError[] = [];
      const evidence: FetchResult["evidence"] = [];
      const limit = query.limit ?? 50;

      const readChannelMessages = async (channelId: string, pageBound: number) => {
        let cursor = after;
        for (let page = 0; page < pageBound && evidence.length < limit; page += 1) {
          const remaining = limit - evidence.length;
          const url = new URL(`${DISCORD_API_BASE}/channels/${channelId}/messages`);
          url.searchParams.set(
            "limit",
            String(Math.min(MAX_DISCORD_MESSAGES_PER_CHANNEL, remaining, 100)),
          );
          url.searchParams.set("after", cursor);
          const response = await fetchImpl(url, {
            headers: discordHeaders(token),
            signal: AbortSignal.timeout(15_000),
          });
          if (response.status === 429) {
            const retryAfter =
              response.headers.get("retry-after") ??
              response.headers.get("x-ratelimit-reset-after") ??
              "";
            errors.push({
              class: "rate_limited",
              message: retryAfter
                ? `Discord rate-limited channel ${channelId} retry_after=${retryAfter}`
                : `Discord rate-limited channel ${channelId}`,
            });
            return "stop";
          }
          const { payload, error } = await readDiscordJson(response);
          if (!response.ok) {
            errors.push(discordHttpError(response.status, payload, channelId));
            return "continue";
          }
          if (error) {
            errors.push(error);
            return "continue";
          }
          const parsed = parseDiscordMessages(payload, fetchedAt, {
            guildId: typeof config.guildId === "string" ? config.guildId : undefined,
            maxResults: Math.min(MAX_DISCORD_MESSAGES_PER_CHANNEL, remaining),
          });
          errors.push(...parsed.errors);
          const kept = parsed.evidence.filter((item) =>
            matchesDiscordKeywords(`${item.title ?? ""} ${item.bodyText ?? ""}`, keywords),
          );
          evidence.push(...kept);
          const ids = parsed.evidence
            .map((item) => item.externalId)
            .filter((item): item is string => Boolean(item));
          const newest = maxSnowflake(ids);
          if (!newest || parsed.evidence.length === 0) {
            break;
          }
          cursor = newest;
          const remainingHeader = response.headers.get("x-ratelimit-remaining");
          if (remainingHeader === "0") {
            break;
          }
          if (parsed.evidence.length < 100) {
            break;
          }
        }
        return "ok";
      };

      channelLoop: for (const channelId of channels) {
        if (evidence.length >= limit) {
          break;
        }
        try {
          const result = await readChannelMessages(channelId, MAX_DISCORD_PAGES_PER_CHANNEL);
          if (result === "stop") {
            break;
          }
          let before: string | undefined;
          const threadIds: string[] = [];
          for (let page = 0; page < MAX_DISCORD_THREAD_PAGES; page += 1) {
            const url = new URL(
              `${DISCORD_API_BASE}/channels/${channelId}/threads/archived/public`,
            );
            url.searchParams.set("limit", "100");
            if (before) {
              url.searchParams.set("before", before);
            }
            const response = await fetchImpl(url, {
              headers: discordHeaders(token),
              signal: AbortSignal.timeout(15_000),
            });
            if (response.status === 429) {
              const retryAfter =
                response.headers.get("retry-after") ??
                response.headers.get("x-ratelimit-reset-after") ??
                "";
              errors.push({
                class: "rate_limited",
                message: retryAfter
                  ? `Discord rate-limited channel ${channelId} retry_after=${retryAfter}`
                  : `Discord rate-limited channel ${channelId}`,
              });
              break channelLoop;
            }
            if (response.status === 403 || response.status === 404) {
              break;
            }
            const { payload, error } = await readDiscordJson(response);
            if (error) {
              errors.push(error);
              break;
            }
            if (!response.ok) {
              errors.push(discordHttpError(response.status, payload, channelId));
              break;
            }
            const parsed = parseDiscordArchivedThreads(payload);
            errors.push(...parsed.errors);
            threadIds.push(...parsed.threadIds);
            if (!parsed.hasMore || !parsed.before) {
              break;
            }
            before = parsed.before;
          }
          for (const threadId of takeBounded(threadIds, MAX_DISCORD_THREADS_PER_CHANNEL)) {
            if (evidence.length >= limit) {
              break;
            }
            const result = await readChannelMessages(threadId, 1);
            if (result === "stop") {
              break channelLoop;
            }
          }
        } catch (error) {
          errors.push({
            class: "timeout",
            message: error instanceof Error ? error.message : "Discord fetch failed",
          });
        }
      }
      return {
        evidence: takeBounded(evidence, limit),
        partial: errors.length > 0,
        errors,
        unresponsiveEngines: [],
        requestUrl: "https://discord.com/api/v10/channels/{channel.id}/messages",
        adapterMetadata: errors.length > 0 ? { channelErrors: errors.length } : undefined,
      };
    },
  };
}
