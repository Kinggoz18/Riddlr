import {
  clampPositiveInt,
  DEFAULT_X_MONTHLY_READ_BUDGET,
  MAX_X_AUTHORS,
  MAX_X_BODY_BYTES,
  MAX_X_KEYWORDS,
  MAX_X_LOOKBACK_HOURS,
  MAX_X_MONTHLY_READ_BUDGET,
  MAX_X_PAGES,
  MAX_X_QUERY_CHARS,
  MAX_X_RESULTS,
  MIN_X_MONTHLY_READ_BUDGET,
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

export const X_API_BASE = "https://api.x.com/2";
export const X_RECENT_SEARCH_PATH = "/tweets/search/recent";
export {
  DEFAULT_X_MONTHLY_READ_BUDGET,
  MAX_X_AUTHORS,
  MAX_X_KEYWORDS,
  MAX_X_LOOKBACK_HOURS,
  MAX_X_MONTHLY_READ_BUDGET,
  MAX_X_PAGES,
  MAX_X_QUERY_CHARS,
  MAX_X_RESULTS,
  MIN_X_MONTHLY_READ_BUDGET,
};
export const X_USERNAME_RE = /^@?[A-Za-z0-9_]{1,15}$/;
export const X_TWEET_FIELDS =
  "created_at,author_id,lang,public_metrics,referenced_tweets,conversation_id,entities";
export const X_EXPANSIONS = "author_id,referenced_tweets.id";
export const X_USER_FIELDS = "username,verified,public_metrics";

const USER_AGENT = "Riddlr/0.5.0 (https://github.com/riddlr/riddlr)";
const MIN_MAX_RESULTS = 10;

type XUser = {
  id?: unknown;
  username?: unknown;
  verified?: unknown;
  public_metrics?: Record<string, unknown>;
};
type XUrlEntity = { expanded_url?: unknown; url?: unknown };
type XCashtag = { tag?: unknown };
type XTweet = {
  id?: unknown;
  text?: unknown;
  created_at?: unknown;
  author_id?: unknown;
  lang?: unknown;
  conversation_id?: unknown;
  public_metrics?: Record<string, unknown>;
  referenced_tweets?: Array<{ type?: unknown; id?: unknown }>;
  entities?: { urls?: unknown; cashtags?: unknown };
};

type SourceError = FetchResult["errors"][number];

function parseUsernames(value: unknown, limit = MAX_X_AUTHORS): string[] {
  const raw = Array.isArray(value) ? value.map((item) => String(item)) : [];
  const unique = [
    ...new Set(
      raw.map((item) => item.trim().replace(/^@/, "")).filter((item) => X_USERNAME_RE.test(item)),
    ),
  ];
  return takeBounded(unique, limit);
}

function parseKeywords(value: unknown): string[] {
  const fromConfig = Array.isArray(value) ? value.map((item) => String(item)) : [];
  const unique = [
    ...new Set(
      fromConfig
        .map((item) => item.trim())
        .filter((item) => item.length >= 2 && item.length <= 48 && !item.includes(":")),
    ),
  ];
  return takeBounded(unique, MAX_X_KEYWORDS);
}

function quoteTerm(term: string): string {
  return /\s/.test(term) ? `"${term.replaceAll('"', "")}"` : term;
}

export function clampXMonthlyReadBudget(value: unknown): number {
  const parsed = clampPositiveInt(value, DEFAULT_X_MONTHLY_READ_BUDGET, MAX_X_MONTHLY_READ_BUDGET);
  return Math.max(MIN_X_MONTHLY_READ_BUDGET, parsed);
}

export function buildRecentSearchQuery(input: { authors?: unknown; keywords?: unknown }): {
  query: string;
  error?: string;
} {
  const authors = parseUsernames(input.authors);
  if (authors.length === 0) {
    return { query: "", error: "Named-principal authors are required for recent search." };
  }
  const keywords = parseKeywords(input.keywords);
  const authorClause = `(${authors.map((name) => `from:${name}`).join(" OR ")})`;
  const parts = [authorClause, "-is:retweet", "-is:reply", "lang:en"];
  if (keywords.length > 0) {
    parts.push(keywords.map(quoteTerm).join(" "));
  }
  const query = parts.join(" ");
  if (query.length > MAX_X_QUERY_CHARS) {
    return {
      query: "",
      error: `Recent search query exceeds ${MAX_X_QUERY_CHARS} characters. Reduce authors or keywords.`,
    };
  }
  return { query };
}

function xHeaders(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    "user-agent": USER_AGENT,
  };
}

function errorClassForStatus(status: number): SourceErrorClass {
  if (status === 401) {
    return "auth";
  }
  if (status === 403 || status === 402) {
    return "capability_missing";
  }
  return classifyHttpStatus(status);
}

function planErrorMessage(status: number, title: string, detail?: string): string {
  const body = detail?.trim() || title;
  if (status === 402) {
    return `${body} Credits are depleted. Recent search is plan-gated. Archive search is not used.`;
  }
  if (status === 403) {
    return `${body} Recent search is not available on this plan or the app is not enrolled. Archive search is not used.`;
  }
  return `${body} Recent search is plan-gated. Archive search is not used.`;
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

function outboundUrlsFromEntities(entities: XTweet["entities"]): string[] {
  const urls = Array.isArray(entities?.urls) ? entities.urls : [];
  const expanded: string[] = [];
  for (const item of takeBounded(urls, 8)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as XUrlEntity;
    const candidate =
      typeof row.expanded_url === "string"
        ? row.expanded_url
        : typeof row.url === "string"
          ? row.url
          : undefined;
    if (!candidate || !hostnameFromUrl(candidate)) {
      continue;
    }
    expanded.push(candidate);
  }
  return expanded;
}

function cashtagsFromEntities(entities: XTweet["entities"]): string[] {
  const tags = Array.isArray(entities?.cashtags) ? entities.cashtags : [];
  const values: string[] = [];
  for (const item of takeBounded(tags, 8)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const tag = (item as XCashtag).tag;
    if (typeof tag === "string" && /^[A-Za-z]{1,10}$/.test(tag)) {
      values.push(tag.toUpperCase());
    }
  }
  return values;
}

function looksLikeHtml(payload: unknown, contentType: string | null): boolean {
  if (contentType?.toLowerCase().includes("text/html")) {
    return true;
  }
  return typeof payload === "string" && /<html[\s>]/i.test(payload);
}

function startTimeFromConfig(config: Record<string, unknown>, now: Date): Date {
  const oldest = new Date(now.getTime() - MAX_X_LOOKBACK_HOURS * 60 * 60 * 1000 + 60_000);
  const lastRaw = config.lastSuccessAt;
  if (typeof lastRaw === "string" || lastRaw instanceof Date) {
    const last = lastRaw instanceof Date ? lastRaw : new Date(lastRaw);
    if (Number.isFinite(last.getTime())) {
      const clamped = last > now ? now : last;
      return clamped < oldest ? oldest : clamped;
    }
  }
  const lookbackHours = Math.min(
    MAX_X_LOOKBACK_HOURS,
    Math.max(1, Number(config.lookbackHours ?? 24)),
  );
  const startTime = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
  return startTime < oldest ? oldest : startTime;
}

export function parseXSearchPayload(payload: unknown, fetchedAt: Date): FetchResult {
  const errors: SourceError[] = [];
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
    meta?: { result_count?: unknown; next_token?: unknown };
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
          message: planErrorMessage(
            status,
            body.title,
            typeof body.detail === "string" ? body.detail : undefined,
          ),
        },
      ],
      unresponsiveEngines: [],
    };
  }
  if (Array.isArray(body.errors) && body.errors.length > 0 && !Array.isArray(body.data)) {
    const first = body.errors[0] as { message?: unknown; title?: unknown };
    const title = String(first?.title ?? "X API rejected recent search.");
    const message = typeof first?.message === "string" ? first.message : title;
    const unauthorized = /unauthorized/i.test(title) || /unauthorized/i.test(message);
    errors.push({
      class: unauthorized ? "auth" : "capability_missing",
      message,
    });
  }
  if (!Array.isArray(body.data)) {
    const resultCount = body.meta?.result_count;
    if (resultCount === 0) {
      return { evidence: [], partial: errors.length > 0, errors, unresponsiveEngines: [] };
    }
    return {
      evidence: [],
      partial: true,
      errors:
        errors.length > 0
          ? errors
          : [{ class: "malformed", message: "X recent search returned no data array." }],
      unresponsiveEngines: [],
    };
  }
  const users = new Map<string, XUser>();
  const included = Array.isArray(body.includes?.users) ? body.includes.users : [];
  for (const item of takeBounded(included, 100)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const user = item as XUser;
    if (typeof user.id === "string") {
      users.set(user.id, user);
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
    const user = authorId ? users.get(authorId) : undefined;
    const username = typeof user?.username === "string" ? user.username : undefined;
    const referenced = Array.isArray(tweet.referenced_tweets) ? tweet.referenced_tweets : [];
    const originRef = referenced.find(
      (row) =>
        row && (row.type === "retweeted" || row.type === "quoted" || row.type === "replied_to"),
    );
    const referencedId = typeof originRef?.id === "string" ? originRef.id : undefined;
    const outbound = outboundUrlsFromEntities(tweet.entities);
    const cashtags = cashtagsFromEntities(tweet.entities);
    const extraTags = cashtags
      .filter((tag) => !text.toLowerCase().includes(`$${tag.toLowerCase()}`))
      .map((tag) => `$${tag}`)
      .join(" ");
    const bodyText = extraTags ? `${text} ${extraTags}` : text;
    evidence.push({
      sourceFamily: "x",
      adapterId: "x",
      externalId: id,
      url: username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/web/status/${id}`,
      title: username ? `@${username}` : `X post ${id}`,
      bodyText,
      author: username,
      publishedAt: typeof tweet.created_at === "string" ? new Date(tweet.created_at) : undefined,
      fetchedAt,
      language: typeof tweet.lang === "string" ? tweet.lang : undefined,
      contentCompleteness: "native_complete",
      sourceIdentity: authorId
        ? {
            platform: "x",
            externalId: authorId,
            displayName: username,
            verifiedBadge: user?.verified === true,
          }
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
        cashtags,
        claimKind: "principal_statement",
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

function emptyResult(errors: SourceError[], extra?: Partial<FetchResult>): FetchResult {
  return {
    evidence: [],
    partial: errors.length > 0,
    errors,
    unresponsiveEngines: [],
    ...extra,
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
        "GET /2/tweets/search/recent covers at most the last 7 days. Query is a from: watchlist of at most 30 authors, plus -is:retweet -is:reply lang:en. Keywords are ANDed. max_results is 100. next_token is bounded to 3 pages. start_time is the last successful fetch, never earlier than 7 days. Archive search (/2/tweets/search/all) is not called. Monthly read budget defaults to 5,000.",
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
      if (authors.length === 0) {
        return {
          ok: false,
          message:
            "Named-principal authors are required. Mentions-only and keyword-only sources are rejected.",
        };
      }
      const built = buildRecentSearchQuery({ authors: config.authors, keywords: config.keywords });
      if (built.error) {
        return { ok: false, message: built.error };
      }
      const budget = Number(config.monthlyReadBudget ?? DEFAULT_X_MONTHLY_READ_BUDGET);
      if (
        !Number.isFinite(budget) ||
        budget < MIN_X_MONTHLY_READ_BUDGET ||
        budget > MAX_X_MONTHLY_READ_BUDGET
      ) {
        return {
          ok: false,
          message: `Monthly read budget must be ${MIN_X_MONTHLY_READ_BUDGET}–${MAX_X_MONTHLY_READ_BUDGET}.`,
        };
      }
      return { ok: true, message: "X recent search source looks valid." };
    },
    async healthCheck(config) {
      const validated = await this.validate(config);
      if (!validated.ok) {
        return validated;
      }
      const used = Number(config.monthlyReadsUsed ?? 0);
      const budget = clampXMonthlyReadBudget(config.monthlyReadBudget);
      if (used >= budget) {
        return { ok: false, message: "Monthly read budget exhausted." };
      }
      const token = String(config.token ?? "");
      const built = buildRecentSearchQuery({ authors: config.authors, keywords: config.keywords });
      const url = new URL(`${X_API_BASE}${X_RECENT_SEARCH_PATH}`);
      url.searchParams.set("query", built.query);
      url.searchParams.set("max_results", String(MIN_MAX_RESULTS));
      try {
        const response = await fetchImpl(url, {
          headers: xHeaders(token),
          signal: AbortSignal.timeout(8000),
        });
        if (response.status === 401) {
          return { ok: false, message: "X rejected the bearer token." };
        }
        if (response.status === 402) {
          return {
            ok: false,
            message:
              "Your enrolled account does not have any credits to fulfill this request. Credits are depleted.",
          };
        }
        if (response.status === 403) {
          return {
            ok: false,
            message:
              "Recent search is not available on this X API plan or the app is not enrolled. Riddlr does not call archive search.",
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
      const validated = await this.validate(config);
      if (!validated.ok) {
        return emptyResult([{ class: "malformed", message: validated.message }]);
      }
      const budget = clampXMonthlyReadBudget(config.monthlyReadBudget);
      const used = Math.max(0, Number(config.monthlyReadsUsed ?? 0) || 0);
      const remaining = budget - used;
      if (remaining < MIN_MAX_RESULTS) {
        return emptyResult(
          [
            {
              class: "capability_missing",
              message: "capability_missing: monthly read budget exhausted",
            },
          ],
          { responseStatus: 402 },
        );
      }
      const token = String(config.token ?? "");
      const now = new Date();
      const startTime = startTimeFromConfig(config, now);
      const built = buildRecentSearchQuery({ authors: config.authors, keywords: config.keywords });
      const url = new URL(`${X_API_BASE}${X_RECENT_SEARCH_PATH}`);
      url.searchParams.set("query", built.query);
      url.searchParams.set(
        "max_results",
        String(
          Math.max(
            MIN_MAX_RESULTS,
            Math.min(query.limit ?? MAX_X_RESULTS, MAX_X_RESULTS, remaining),
          ),
        ),
      );
      url.searchParams.set("start_time", startTime.toISOString());
      url.searchParams.set("tweet.fields", X_TWEET_FIELDS);
      url.searchParams.set("expansions", X_EXPANSIONS);
      url.searchParams.set("user.fields", X_USER_FIELDS);
      const merged: FetchResult = {
        evidence: [],
        partial: false,
        errors: [],
        unresponsiveEngines: [],
      };
      let nextToken: string | undefined;
      let readsCharged = 0;
      let lastOk = false;
      try {
        for (
          let page = 0;
          page < MAX_X_PAGES && merged.evidence.length < (query.limit ?? MAX_X_RESULTS);
          page += 1
        ) {
          if (used + readsCharged + MIN_MAX_RESULTS > budget) {
            merged.partial = true;
            merged.errors.push({
              class: "capability_missing",
              message: "capability_missing: monthly read budget exhausted",
            });
            break;
          }
          const pageUrl = new URL(url);
          if (nextToken) {
            pageUrl.searchParams.set("next_token", nextToken);
          }
          const response = await fetchImpl(pageUrl, {
            headers: xHeaders(token),
            signal: AbortSignal.timeout(15_000),
          });
          merged.responseStatus = response.status;
          if (response.status === 429) {
            const retryAfter = response.headers.get("x-rate-limit-reset") ?? "";
            merged.partial = true;
            merged.errors.push({
              class: "rate_limited",
              message: retryAfter
                ? `X rate-limited recent search until ${retryAfter}.`
                : "X rate-limited recent search.",
            });
            break;
          }
          const length = Number(response.headers.get("content-length") ?? "0");
          if (Number.isFinite(length) && length > MAX_X_BODY_BYTES) {
            merged.partial = true;
            merged.errors.push({
              class: "too_large",
              message: "X response exceeded the size bound.",
            });
            break;
          }
          const contentType = response.headers.get("content-type");
          let payload: unknown;
          try {
            payload = await readBoundedJson(response, MAX_X_BODY_BYTES);
          } catch (error) {
            const message = error instanceof Error ? error.message : "X body could not be read.";
            merged.partial = true;
            if (!response.ok) {
              merged.errors.push({
                class: errorClassForStatus(response.status),
                message: planErrorMessage(response.status, `HTTP ${response.status}`),
              });
            } else {
              merged.errors.push({
                class: message.includes("size bound") ? "too_large" : "malformed",
                message,
              });
            }
            break;
          }
          if (looksLikeHtml(payload, contentType)) {
            merged.partial = true;
            merged.errors.push({ class: "malformed", message: "X returned an HTML body." });
            break;
          }
          if (!response.ok) {
            const parsed = parseXSearchPayload(
              payload && typeof payload === "object"
                ? { ...(payload as Record<string, unknown>), status: response.status }
                : { title: `HTTP ${response.status}`, status: response.status },
              now,
            );
            merged.errors.push(...parsed.errors);
            merged.partial = true;
            break;
          }
          lastOk = true;
          const parsed = parseXSearchPayload(payload, now);
          const meta =
            payload && typeof payload === "object"
              ? (payload as { meta?: { result_count?: unknown; next_token?: unknown } }).meta
              : undefined;
          const pageCount =
            typeof meta?.result_count === "number" && Number.isFinite(meta.result_count)
              ? Math.max(0, Math.floor(meta.result_count))
              : parsed.evidence.length;
          readsCharged += pageCount;
          merged.evidence.push(...parsed.evidence);
          merged.errors.push(...parsed.errors);
          nextToken = typeof meta?.next_token === "string" ? meta.next_token : undefined;
          if (!nextToken) {
            break;
          }
        }
        return {
          ...merged,
          evidence: takeBounded(merged.evidence, query.limit ?? MAX_X_RESULTS),
          partial: merged.partial || merged.errors.length > 0,
          requestUrl: "https://api.x.com/2/tweets/search/recent",
          paginationCursor: nextToken,
          adapterMetadata: {
            ...(nextToken ? { nextToken } : {}),
            readsCharged,
            persistConfig: lastOk ? { lastSuccessAt: now.toISOString() } : undefined,
          },
        };
      } catch (error) {
        return {
          evidence: takeBounded(merged.evidence, query.limit ?? MAX_X_RESULTS),
          partial: true,
          errors: [
            ...merged.errors,
            {
              class: "unavailable" as const,
              message: error instanceof Error ? error.message : "X fetch failed",
            },
          ],
          unresponsiveEngines: [],
          adapterMetadata: { readsCharged },
        };
      }
    },
  };
}
