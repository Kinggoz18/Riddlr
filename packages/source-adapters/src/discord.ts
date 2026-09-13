import { takeBounded } from "@riddlr/domain";
import {
  classifyHttpStatus,
  type FetchQuery,
  type FetchResult,
  type SourceAdapter,
} from "./types.js";

export const DISCORD_API_BASE = "https://discord.com/api/v10";
export const DISCORD_EPOCH_MS = 1_420_070_400_000;
export const DISCORD_VIEW_CHANNEL = 1 << 10;
export const DISCORD_READ_MESSAGE_HISTORY = 1 << 16;
export const DISCORD_BOT_PERMISSIONS = DISCORD_VIEW_CHANNEL | DISCORD_READ_MESSAGE_HISTORY;
export const MAX_DISCORD_CHANNELS = 8;
export const MAX_DISCORD_KEYWORDS = 16;
export const MAX_DISCORD_MESSAGES_PER_CHANNEL = 50;
export const MAX_DISCORD_LOOKBACK_HOURS = 24;
export const SNOWFLAKE_RE = /^\d{17,20}$/;

const USER_AGENT = "DiscordBot (https://github.com/riddlr/riddlr, 0.4.0)";

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

type DiscordAuthor = { id?: unknown; username?: unknown };
type DiscordMessage = {
  id?: unknown;
  channel_id?: unknown;
  guild_id?: unknown;
  content?: unknown;
  timestamp?: unknown;
  edited_timestamp?: unknown;
  type?: unknown;
  webhook_id?: unknown;
  author?: DiscordAuthor & { bot?: unknown };
  message_reference?: { message_id?: unknown; channel_id?: unknown; guild_id?: unknown };
};

export function parseDiscordMessages(
  payload: unknown,
  fetchedAt: Date,
  input: { guildId?: string; maxResults?: number },
): FetchResult {
  const errors: FetchResult["errors"] = [];
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
    if (!content.trim()) {
      emptyContent += 1;
      evidence.push({
        sourceFamily: "discord",
        adapterId: "discord",
        externalId: id,
        url: `https://discord.com/channels/${guildId}/${channelId}/${id}`,
        title: author ? `${author} in #${channelId}` : `Discord message ${id}`,
        bodyText: "",
        author,
        publishedAt: typeof row.timestamp === "string" ? new Date(row.timestamp) : undefined,
        fetchedAt,
        editedAt:
          typeof row.edited_timestamp === "string" ? new Date(row.edited_timestamp) : undefined,
        contentCompleteness: "incomplete",
        sourceIdentity: authorId
          ? {
              platform: "discord",
              externalId: authorId,
              displayName: author,
              parentExternalId: channelId,
            }
          : undefined,
        originKey: referencedId
          ? `discord:${referencedId}`
          : authorId
            ? `discord:${authorId}`
            : `discord:${id}`,
        referencedOriginKey: referencedId ? `discord:${referencedId}` : undefined,
        adapterPayload: {
          channelId,
          guildId,
          messageId: id,
          webhookId,
          bot,
          messageType: row.type,
        },
      });
      continue;
    }
    evidence.push({
      sourceFamily: "discord",
      adapterId: "discord",
      externalId: id,
      url: `https://discord.com/channels/${guildId}/${channelId}/${id}`,
      title: author ? `${author} in #${channelId}` : `Discord message ${id}`,
      bodyText: content,
      author,
      publishedAt: typeof row.timestamp === "string" ? new Date(row.timestamp) : undefined,
      fetchedAt,
      editedAt:
        typeof row.edited_timestamp === "string" ? new Date(row.edited_timestamp) : undefined,
      contentCompleteness: "native_complete",
      sourceIdentity: authorId
        ? {
            platform: "discord",
            externalId: authorId,
            displayName: author,
            parentExternalId: channelId,
          }
        : undefined,
      originKey: referencedId
        ? `discord:${referencedId}`
        : authorId
          ? `discord:${authorId}`
          : `discord:${id}`,
      referencedOriginKey: referencedId ? `discord:${referencedId}` : undefined,
      adapterPayload: { channelId, guildId, messageId: id, webhookId, bot, messageType: row.type },
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

function matchesKeywords(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) {
    return true;
  }
  const haystack = text.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

function discordHeaders(token: string): HeadersInit {
  return {
    authorization: `Bot ${token}`,
    "user-agent": USER_AGENT,
  };
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
        "GET /channels/{channel.id}/messages returns at most 100 recent messages per request (default 50). after uses a snowflake lookback. This is not guild message-search archive access.",
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
          return {
            ok: false,
            message: "Missing VIEW_CHANNEL or READ_MESSAGE_HISTORY on this channel.",
          };
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
      const keywords = parseKeywords(config.keywords, query.query);
      const lookbackHours = Math.min(
        MAX_DISCORD_LOOKBACK_HOURS,
        Math.max(1, Number(config.lookbackHours ?? 6)),
      );
      const after = snowflakeFromDate(new Date(Date.now() - lookbackHours * 60 * 60 * 1000));
      const fetchedAt = new Date();
      const errors: FetchResult["errors"] = [];
      const evidence: FetchResult["evidence"] = [];
      const limit = Math.min(
        query.limit ?? MAX_DISCORD_MESSAGES_PER_CHANNEL,
        MAX_DISCORD_MESSAGES_PER_CHANNEL,
      );
      for (const channelId of channels) {
        const remaining = (query.limit ?? 50) - evidence.length;
        if (remaining <= 0) {
          break;
        }
        const url = new URL(`${DISCORD_API_BASE}/channels/${channelId}/messages`);
        url.searchParams.set("limit", String(Math.min(limit, remaining)));
        url.searchParams.set("after", after);
        try {
          const response = await fetchImpl(url, {
            headers: discordHeaders(token),
            signal: AbortSignal.timeout(15_000),
          });
          if (response.status === 429) {
            errors.push({
              class: "rate_limited",
              message: `Discord rate-limited channel ${channelId}`,
            });
            break;
          }
          if (!response.ok) {
            errors.push({
              class:
                classifyHttpStatus(response.status) === "capability_missing" &&
                response.status === 401
                  ? "auth"
                  : classifyHttpStatus(response.status),
              message: `Discord HTTP ${response.status} for channel ${channelId}`,
            });
            continue;
          }
          const parsed = parseDiscordMessages(await response.json(), fetchedAt, {
            guildId: typeof config.guildId === "string" ? config.guildId : undefined,
            maxResults: Math.min(limit, remaining),
          });
          errors.push(...parsed.errors);
          evidence.push(
            ...parsed.evidence.filter((item) =>
              matchesKeywords(`${item.title ?? ""} ${item.bodyText ?? ""}`, keywords),
            ),
          );
        } catch (error) {
          errors.push({
            class: "timeout",
            message: error instanceof Error ? error.message : "Discord fetch failed",
          });
        }
      }
      return {
        evidence: takeBounded(evidence, query.limit ?? 50),
        partial: errors.length > 0,
        errors,
        unresponsiveEngines: [],
        requestUrl: "https://discord.com/api/v10/channels/{channel.id}/messages",
        adapterMetadata: errors.length > 0 ? { channelErrors: errors.length } : undefined,
      };
    },
  };
}
