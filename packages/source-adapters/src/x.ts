import { takeBounded } from "@riddlr/domain";
import {
  classifyHttpStatus,
  type FetchQuery,
  type FetchResult,
  type SourceAdapter,
} from "./types.js";

export const X_API_BASE = "https://api.x.com/2";
export const X_RECENT_SEARCH_PATH = "/tweets/search/recent";
export const MAX_X_AUTHORS = 8;
export const MAX_X_MENTIONS = 8;
export const MAX_X_KEYWORDS = 16;
export const MAX_X_LOOKBACK_HOURS = 168;
export const MAX_X_RESULTS = 50;
export const MAX_X_QUERY_CHARS = 512;
export const X_USERNAME_RE = /^@?[A-Za-z0-9_]{1,15}$/;

const USER_AGENT = "Riddlr/0.5.0 (https://github.com/riddlr/riddlr)";

type XUser = { id?: unknown; username?: unknown };
type XTweet = {
  id?: unknown;
  text?: unknown;
  created_at?: unknown;
  author_id?: unknown;
  lang?: unknown;
  conversation_id?: unknown;
  public_metrics?: Record<string, unknown>;
  referenced_tweets?: Array<{ type?: unknown; id?: unknown }>;
};

function parseUsernames(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.map((item) => String(item)) : [];
  const unique = [
    ...new Set(
      raw.map((item) => item.trim().replace(/^@/, "")).filter((item) => X_USERNAME_RE.test(item)),
    ),
  ];
  return takeBounded(unique, MAX_X_AUTHORS);
}

function parseKeywords(value: unknown, extra: string): string[] {
  const fromConfig = Array.isArray(value) ? value.map((item) => String(item)) : [];
  const fromQuery = extra.split(/\s+/);
  const unique = [
    ...new Set(
      [...fromConfig, ...fromQuery]
        .map((item) => item.trim())
        .filter((item) => item.length >= 2 && item.length <= 48 && !item.includes(":")),
    ),
  ];
  return takeBounded(unique, MAX_X_KEYWORDS);
}

function quoteTerm(term: string): string {
  return /\s/.test(term) ? `"${term.replaceAll('"', "")}"` : term;
}

export function buildRecentSearchQuery(input: {
  authors?: unknown;
  mentions?: unknown;
  keywords?: unknown;
  query?: string;
}): string {
  const clauses: string[] = [];
  const authors = parseUsernames(input.authors);
  const mentions = parseUsernames(input.mentions);
  const keywords = parseKeywords(input.keywords, input.query ?? "");
  if (authors.length > 0) {
    clauses.push(`(${authors.map((name) => `from:${name}`).join(" OR ")})`);
  }
  if (mentions.length > 0) {
    clauses.push(`(${mentions.map((name) => `@${name}`).join(" OR ")})`);
  }
  if (keywords.length > 0) {
    clauses.push(`(${keywords.map(quoteTerm).join(" OR ")})`);
  }
  const joined = clauses.join(" ");
  return joined.slice(0, MAX_X_QUERY_CHARS);
}

function xHeaders(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    "user-agent": USER_AGENT,
  };
}

function errorClassForStatus(status: number): FetchResult["errors"][number]["class"] {
  if (status === 401) {
    return "auth";
  }
  if (status === 403 || status === 402) {
    return "capability_missing";
  }
  return classifyHttpStatus(status);
}

export function parseXSearchPayload(payload: unknown, fetchedAt: Date): FetchResult {
  const errors: FetchResult["errors"] = [];
  if (!payload || typeof payload !== "object") {
    return {
      evidence: [],
      partial: true,
      errors: [{ class: "malformed", message: "X recent search payload was not an object." }],
      unresponsiveEngines: [],
    };
  }
  const body = payload as {
    data?: unknown;
    includes?: { users?: unknown };
    title?: unknown;
    detail?: unknown;
    status?: unknown;
    errors?: unknown;
  };
  if (typeof body.title === "string" && !Array.isArray(body.data)) {
    const status = typeof body.status === "number" ? body.status : 403;
    return {
      evidence: [],
      partial: true,
      errors: [
        {
          class: errorClassForStatus(status),
          message: `${body.detail ?? body.title} Recent search is plan-gated. Archive search is not used.`,
        },
      ],
      unresponsiveEngines: [],
    };
  }
  if (Array.isArray(body.errors) && body.errors.length > 0 && !Array.isArray(body.data)) {
    const first = body.errors[0] as { message?: unknown; title?: unknown };
    errors.push({
      class: "capability_missing",
      message: String(first?.message ?? first?.title ?? "X API rejected recent search."),
    });
  }
  if (!Array.isArray(body.data)) {
    return {
      evidence: [],
      partial: errors.length > 0,
      errors:
        errors.length > 0
          ? errors
          : [{ class: "malformed", message: "X recent search returned no data array." }],
      unresponsiveEngines: [],
    };
  }
  const users = new Map<string, string>();
  const included = Array.isArray(body.includes?.users) ? body.includes.users : [];
  for (const item of takeBounded(included, 100)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const user = item as XUser;
    if (typeof user.id === "string" && typeof user.username === "string") {
      users.set(user.id, user.username);
    }
  }
  const evidence: FetchResult["evidence"] = [];
  for (const item of takeBounded(body.data, MAX_X_RESULTS)) {
    if (!item || typeof item !== "object") {
      errors.push({ class: "malformed", message: "Non-object X post skipped" });
      continue;
    }
    const tweet = item as XTweet;
    const id = typeof tweet.id === "string" ? tweet.id : undefined;
    const text = typeof tweet.text === "string" ? tweet.text : "";
    if (!id || !text.trim()) {
      errors.push({ class: "malformed", message: "X post missing id or text" });
      continue;
    }
    const authorId = typeof tweet.author_id === "string" ? tweet.author_id : undefined;
    const username = authorId ? users.get(authorId) : undefined;
    const referenced = Array.isArray(tweet.referenced_tweets) ? tweet.referenced_tweets : [];
    const originRef = referenced.find(
      (item) =>
        item && (item.type === "retweeted" || item.type === "quoted" || item.type === "replied_to"),
    );
    const referencedId = typeof originRef?.id === "string" ? originRef.id : undefined;
    const outbound = [...text.matchAll(/https?:\/\/[^\s]+/g)].map((item) => item[0]);
    evidence.push({
      sourceFamily: "x",
      adapterId: "x",
      externalId: id,
      url: username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/web/status/${id}`,
      title: username ? `@${username}` : `X post ${id}`,
      bodyText: text,
      author: username,
      publishedAt: typeof tweet.created_at === "string" ? new Date(tweet.created_at) : undefined,
      fetchedAt,
      language: typeof tweet.lang === "string" ? tweet.lang : undefined,
      contentCompleteness: "native_complete",
      sourceIdentity: authorId
        ? { platform: "x", externalId: authorId, displayName: username }
        : undefined,
      originKey: referencedId ? `x:${referencedId}` : authorId ? `x:${authorId}` : `x:${id}`,
      referencedOriginKey: referencedId ? `x:${referencedId}` : undefined,
      outboundUrls: outbound.slice(0, 8),
      adapterPayload: {
        tweetId: id,
        authorId,
        conversationId:
          typeof tweet.conversation_id === "string" ? tweet.conversation_id : undefined,
        referencedTweets: referenced,
        publicMetrics:
          tweet.public_metrics && typeof tweet.public_metrics === "object"
            ? tweet.public_metrics
            : undefined,
      },
    });
  }
  return {
    evidence,
    partial: errors.length > 0,
    errors,
    unresponsiveEngines: [],
  };
}

export function createXAdapter(fetchImpl: typeof fetch = fetch): SourceAdapter {
  return {
    id: "x",
    family: "x",
    capabilities: {
      modes: ["search"],
      supportsTimeRange: true,
      supportsPagination: true,
      supportsDomainFilter: false,
      lookbackNotes:
        "GET /2/tweets/search/recent covers at most the last 7 days. max_results is 10–100 (Riddlr uses ≤50). Bounded next_token pagination is used. Query length is capped at 512 characters. Archive search (/2/tweets/search/all) is not called. Access depends on the token's X API plan.",
      partialResults: true,
    },
    async validate(config) {
      const token = String(config.token ?? "");
      if (token.length < 8) {
        return { ok: false, message: "Bearer token is required." };
      }
      const lookback = Number(config.lookbackHours ?? 24);
      if (!Number.isFinite(lookback) || lookback < 1 || lookback > MAX_X_LOOKBACK_HOURS) {
        return {
          ok: false,
          message: `Lookback must be 1–${MAX_X_LOOKBACK_HOURS} hours (recent search, not archive).`,
        };
      }
      const authors = parseUsernames(config.authors);
      const mentions = parseUsernames(config.mentions);
      const keywords = parseKeywords(config.keywords, "");
      if (authors.length === 0 && mentions.length === 0 && keywords.length === 0) {
        return {
          ok: false,
          message: "Provide authors, mentions, or keywords for recent search.",
        };
      }
      return { ok: true, message: "X recent search source looks valid." };
    },
    async healthCheck(config) {
      const token = String(config.token ?? "");
      if (token.length < 8) {
        return { ok: false, message: "Bearer token is required." };
      }
      const query = buildRecentSearchQuery({
        authors: config.authors,
        mentions: config.mentions,
        keywords: config.keywords,
        query: "",
      });
      const url = new URL(`${X_API_BASE}${X_RECENT_SEARCH_PATH}`);
      url.searchParams.set("query", query);
      url.searchParams.set("max_results", "10");
      try {
        const response = await fetchImpl(url, {
          headers: xHeaders(token),
          signal: AbortSignal.timeout(8000),
        });
        if (response.status === 401) {
          return { ok: false, message: "X rejected the bearer token." };
        }
        if (response.status === 402 || response.status === 403) {
          return {
            ok: false,
            message:
              "Recent search is not available on this X API plan. Riddlr does not call archive search.",
          };
        }
        if (!response.ok) {
          return { ok: false, message: `X HTTP ${response.status}` };
        }
        return { ok: true, message: "X recent search accepted this token." };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "X health check failed",
        };
      }
    },
    async fetch(config, query: FetchQuery) {
      const validated = await this.validate({
        ...config,
        keywords:
          Array.isArray(config.keywords) && config.keywords.length > 0
            ? config.keywords
            : query.query.split(/\s+/).filter(Boolean),
      });
      if (!validated.ok) {
        return {
          evidence: [],
          partial: true,
          errors: [{ class: "malformed", message: validated.message }],
          unresponsiveEngines: [],
        };
      }
      const token = String(config.token ?? "");
      const lookbackHours = Math.min(
        MAX_X_LOOKBACK_HOURS,
        Math.max(1, Number(config.lookbackHours ?? 24)),
      );
      const startTime = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
      const oldest = new Date(Date.now() - MAX_X_LOOKBACK_HOURS * 60 * 60 * 1000 + 60_000);
      const clampedStart = startTime < oldest ? oldest : startTime;
      const searchQuery = buildRecentSearchQuery({
        authors: config.authors,
        mentions: config.mentions,
        keywords: config.keywords,
        query: query.query,
      });
      const url = new URL(`${X_API_BASE}${X_RECENT_SEARCH_PATH}`);
      url.searchParams.set("query", searchQuery);
      url.searchParams.set(
        "max_results",
        String(Math.max(10, Math.min(query.limit ?? MAX_X_RESULTS, MAX_X_RESULTS))),
      );
      url.searchParams.set("start_time", clampedStart.toISOString());
      url.searchParams.set(
        "tweet.fields",
        "created_at,author_id,lang,public_metrics,referenced_tweets,conversation_id",
      );
      url.searchParams.set("expansions", "author_id,referenced_tweets.id");
      url.searchParams.set("user.fields", "username");
      const limit = query.limit ?? MAX_X_RESULTS;
      const merged: FetchResult = {
        evidence: [],
        partial: false,
        errors: [],
        unresponsiveEngines: [],
      };
      let nextToken: string | undefined;
      try {
        for (let page = 0; page < 3 && merged.evidence.length < limit; page += 1) {
          const pageUrl = new URL(url);
          if (nextToken) {
            pageUrl.searchParams.set("next_token", nextToken);
          }
          const response = await fetchImpl(pageUrl, {
            headers: xHeaders(token),
            signal: AbortSignal.timeout(15_000),
          });
          if (response.status === 429) {
            const retryAfter = Number(response.headers.get("x-rate-limit-reset") ?? "0");
            merged.partial = true;
            merged.errors.push({
              class: "rate_limited",
              message: retryAfter
                ? `X rate-limited recent search until ${retryAfter}.`
                : "X rate-limited recent search.",
            });
            break;
          }
          const payload = (await response.json().catch(() => ({
            title: `HTTP ${response.status}`,
            status: response.status,
          }))) as { meta?: { next_token?: string } } & Record<string, unknown>;
          if (!response.ok) {
            const parsed = parseXSearchPayload({ ...payload, status: response.status }, new Date());
            merged.errors.push(...parsed.errors);
            merged.partial = true;
            break;
          }
          const parsed = parseXSearchPayload(payload, new Date());
          merged.evidence.push(...parsed.evidence);
          merged.errors.push(...parsed.errors);
          nextToken = payload.meta?.next_token;
          if (!nextToken) {
            break;
          }
        }
        return {
          ...merged,
          evidence: takeBounded(merged.evidence, limit),
          partial: merged.partial || merged.errors.length > 0,
          requestUrl: "https://api.x.com/2/tweets/search/recent",
          paginationCursor: nextToken,
          adapterMetadata: nextToken ? { nextToken } : undefined,
        };
      } catch (error) {
        return {
          evidence: takeBounded(merged.evidence, limit),
          partial: true,
          errors: [
            ...merged.errors,
            {
              class: "unavailable" as const,
              message: error instanceof Error ? error.message : "X fetch failed",
            },
          ],
          unresponsiveEngines: [],
        };
      }
    },
  };
}
