import {
  canonicalizeUrl,
  clampPositiveInt,
  DEFAULT_FEED_POLL_INTERVAL_SECONDS,
  MAX_FEED_BACKOFF_SECONDS,
  MAX_FEED_BODY_BYTES,
  MAX_FEED_ITEM_CHARS,
  MAX_FEED_ITEMS,
  MAX_FEED_POLL_INTERVAL_SECONDS,
  MAX_FEED_REDIRECTS,
  MIN_FEED_POLL_INTERVAL_SECONDS,
  OBSERVE_CLOCK_SKEW_MS,
  TRUST_TIERS,
  type TrustTier,
  takeBounded,
} from "@riddlr/domain";
import {
  assertSafeHttpUrl,
  classifyHttpStatus,
  type FetchQuery,
  type FetchResult,
  type LookupFn,
  readBoundedBytes,
  redactRequestUrl,
  type SourceAdapter,
  type SourceErrorClass,
  safeFetchFollow,
} from "./types.js";

export const FEEDS_ADAPTER_ID = "feeds";
export const FEEDS_FAMILY = "feed";
export const FEEDS_USER_AGENT = "Riddlr/0.1 (https://github.com/Kinggoz18/Riddlr)";

export type SuggestedFeed = {
  name: string;
  url: string;
  trustTier: TrustTier;
};

export const SUGGESTED_FEEDS: readonly SuggestedFeed[] = [
  {
    name: "Federal Reserve press releases",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    trustTier: "official_firsthand",
  },
  {
    name: "ECB press, speeches, and interviews",
    url: "https://www.ecb.europa.eu/rss/press.html",
    trustTier: "official_firsthand",
  },
];

export function isTrustTier(value: unknown): value is TrustTier {
  return typeof value === "string" && (TRUST_TIERS as readonly string[]).includes(value);
}

export function defaultTrustForFeedUrl(url: string): TrustTier {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const match = SUGGESTED_FEEDS.find((item) => {
      try {
        return new URL(item.url).hostname.toLowerCase() === host;
      } catch {
        return false;
      }
    });
    return match?.trustTier ?? "community";
  } catch {
    return "community";
  }
}

export function clampFeedPollIntervalSeconds(value: unknown): number {
  const parsed = clampPositiveInt(
    value,
    DEFAULT_FEED_POLL_INTERVAL_SECONDS,
    MAX_FEED_POLL_INTERVAL_SECONDS,
  );
  return Math.max(MIN_FEED_POLL_INTERVAL_SECONDS, parsed);
}

function decodeXmlText(value: string): string {
  const withoutCdata = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const numeric = withoutCdata
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_, digits: string) => {
      const code = Number(digits);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    });
  return numeric
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBlocks(xml: string, tag: string): string[] {
  const blocks: string[] = [];
  const openRe = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>`, "gi");
  let match = openRe.exec(xml);
  while (match) {
    const start = match.index + match[0].length;
    const closeRe = new RegExp(`</(?:[\\w.-]+:)?${tag}\\s*>`, "gi");
    closeRe.lastIndex = start;
    const close = closeRe.exec(xml);
    if (!close) {
      break;
    }
    blocks.push(xml.slice(start, close.index));
    openRe.lastIndex = close.index + close[0].length;
    match = openRe.exec(xml);
  }
  return blocks;
}

function innerText(block: string, localName: string): string | undefined {
  const re = new RegExp(
    `<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${localName}\\s*>`,
    "i",
  );
  const match = re.exec(block);
  if (!match?.[1]) {
    return undefined;
  }
  const text = decodeXmlText(match[1]);
  return text.length > 0 ? text : undefined;
}

function atomLink(block: string): string | undefined {
  const re = /<(?:[\w.-]+:)?link\b([^>]*)\/?>/gi;
  let fallback: string | undefined;
  let match = re.exec(block);
  while (match) {
    const attrs = match[1] ?? "";
    const href = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    const rel = /rel\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    const url = href?.[2] ?? href?.[3];
    if (url) {
      const decoded = decodeXmlText(url);
      const relValue = (rel?.[2] ?? rel?.[3] ?? "alternate").toLowerCase();
      if (relValue === "alternate") {
        return decoded;
      }
      fallback ??= decoded;
    }
    match = re.exec(block);
  }
  return fallback;
}

function parseTimestamp(value: string | undefined, fetchedAt: Date): Date | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  if (parsed.getTime() - fetchedAt.getTime() > OBSERVE_CLOCK_SKEW_MS) {
    return fetchedAt;
  }
  return parsed;
}

function boundChars(value: string | undefined, max = MAX_FEED_ITEM_CHARS): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length <= max ? value : value.slice(0, max);
}

function feedHostname(feedUrl: string): string | undefined {
  try {
    return new URL(feedUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function parseFeedXml(
  xml: string,
  fetchedAt: Date,
  input: { feedUrl: string; maxItems?: number },
): FetchResult {
  const errors: FetchResult["errors"] = [];
  const stripped = xml.replace(/^\uFEFF/, "").trim();
  if (/<!DOCTYPE/i.test(stripped) || /<!ENTITY/i.test(stripped)) {
    return {
      evidence: [],
      partial: true,
      errors: [
        {
          class: "malformed",
          message: "XML DTD and external entities are not allowed.",
        },
      ],
      unresponsiveEngines: [],
    };
  }
  const isRss = /<rss\b/i.test(stripped);
  const isAtom = /<feed\b/i.test(stripped);
  if (!isRss && !isAtom) {
    return {
      evidence: [],
      partial: true,
      errors: [{ class: "malformed", message: "Body is not RSS 2.0 or Atom 1.0." }],
      unresponsiveEngines: [],
    };
  }
  const hostname = feedHostname(input.feedUrl);
  const channelTitle = isRss
    ? innerText(stripped, "title")
    : innerText(stripped.split(/<(?:[\w.-]+:)?entry\b/i)[0] ?? stripped, "title");
  const rawItems = isRss ? extractBlocks(stripped, "item") : extractBlocks(stripped, "entry");
  const maxItems = input.maxItems ?? MAX_FEED_ITEMS;
  const seen = new Set<string>();
  const evidence: FetchResult["evidence"] = [];
  for (const block of takeBounded(rawItems, maxItems)) {
    const rssLink = innerText(block, "link");
    const link = rssLink ?? atomLink(block);
    const guid = innerText(block, "guid") ?? innerText(block, "id");
    const title = innerText(block, "title") ?? innerText(block, "description");
    const summary =
      innerText(block, "description") ??
      innerText(block, "summary") ??
      innerText(block, "content") ??
      innerText(block, "media:description");
    const author = innerText(block, "name") ?? innerText(block, "creator");
    const published = parseTimestamp(
      innerText(block, "pubDate") ?? innerText(block, "published") ?? innerText(block, "updated"),
      fetchedAt,
    );
    const url = canonicalizeUrl(link) ?? canonicalizeUrl(guid);
    if (!url && !guid) {
      errors.push({ class: "malformed", message: "Feed item missing link and guid." });
      continue;
    }
    const externalId = guid ?? url ?? title;
    if (!externalId) {
      errors.push({ class: "malformed", message: "Feed item missing identity." });
      continue;
    }
    if (seen.has(externalId)) {
      continue;
    }
    seen.add(externalId);
    evidence.push({
      sourceFamily: FEEDS_FAMILY,
      adapterId: FEEDS_ADAPTER_ID,
      externalId,
      url,
      canonicalUrl: url,
      title: boundChars(title),
      bodyText: boundChars(summary),
      author: boundChars(author, 200),
      publishedAt: published,
      fetchedAt,
      contentCompleteness: "snippet",
      originKey: hostname ? `feed:${hostname}` : undefined,
      sourceIdentity: hostname
        ? {
            platform: "feed",
            externalId: hostname,
            displayName: channelTitle ?? hostname,
            hostname,
          }
        : undefined,
      adapterPayload: {
        guid,
        feedUrl: input.feedUrl,
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

function classifyFeedStatus(status: number): SourceErrorClass {
  if (status === 401 || status === 403 || status === 451) {
    return "blocked";
  }
  return classifyHttpStatus(status);
}

function feedErrorMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "Feed returned 401/403. Paywalled feeds are not supported.";
  }
  if (status === 451) {
    return "Feed returned 451. This URL is unavailable from this region.";
  }
  if (status === 429) {
    return "Feed HTTP 429";
  }
  return `Feed HTTP ${status}`;
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === "TimeoutError" || error.name === "AbortError" || /timeout/i.test(error.message)
  );
}

function persistConfigFrom(
  config: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return {
    lastEtag: config.lastEtag,
    lastModified: config.lastModified,
    lastPolledAt: new Date().toISOString(),
    backoffSeconds: config.backoffSeconds,
    unchangedStreak: config.unchangedStreak,
    ...patch,
  };
}

export function createFeedsAdapter(
  fetchImpl: typeof fetch = fetch,
  lookup?: LookupFn,
): SourceAdapter {
  return {
    id: FEEDS_ADAPTER_ID,
    family: FEEDS_FAMILY,
    capabilities: {
      modes: ["poll"],
      supportsTimeRange: false,
      supportsPagination: false,
      supportsDomainFilter: false,
      lookbackNotes:
        "Polls the operator URL with If-None-Match / If-Modified-Since. Default 5 minutes, minimum 1 minute. Items are snippets until the linked page is enriched.",
      partialResults: true,
    },
    async validate(config) {
      const feedUrl = String(config.feedUrl ?? "").trim();
      if (!feedUrl) {
        return { ok: false, message: "Feed URL is required." };
      }
      try {
        assertSafeHttpUrl(feedUrl);
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "Invalid feed URL." };
      }
      if (config.trustTier !== undefined && !isTrustTier(config.trustTier)) {
        return { ok: false, message: "Unknown trust tier." };
      }
      return { ok: true, message: "Feed URL looks valid." };
    },
    async healthCheck(config) {
      const feedUrl = String(config.feedUrl ?? "").trim();
      try {
        assertSafeHttpUrl(feedUrl);
        const { response } = await safeFetchFollow(feedUrl, {
          fetchImpl,
          lookup,
          maxBytes: MAX_FEED_BODY_BYTES,
          maxRedirects: MAX_FEED_REDIRECTS,
          headers: {
            "user-agent": FEEDS_USER_AGENT,
            accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
          },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          return { ok: false, message: feedErrorMessage(response.status) };
        }
        const buffer = await readBoundedBytes(response, MAX_FEED_BODY_BYTES);
        const parsed = parseFeedXml(buffer.toString("utf8"), new Date(), { feedUrl, maxItems: 1 });
        if (
          parsed.errors.some((item) => item.class === "malformed") &&
          parsed.evidence.length === 0
        ) {
          return {
            ok: false,
            message: parsed.errors[0]?.message ?? "Feed body is not RSS or Atom.",
          };
        }
        return { ok: true, message: "Feed is reachable and parseable." };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "health check failed",
        };
      }
    },
    async fetch(config, query: FetchQuery) {
      const feedUrl = String(config.feedUrl ?? "").trim();
      assertSafeHttpUrl(feedUrl);
      const intervalSeconds = clampFeedPollIntervalSeconds(config.pollIntervalSeconds);
      const backoffSeconds = clampPositiveInt(
        config.backoffSeconds,
        intervalSeconds,
        MAX_FEED_BACKOFF_SECONDS,
      );
      const lastPolledAt =
        typeof config.lastPolledAt === "string" ? new Date(config.lastPolledAt) : undefined;
      if (lastPolledAt && !Number.isNaN(lastPolledAt.getTime())) {
        const elapsed = Date.now() - lastPolledAt.getTime();
        if (elapsed >= 0 && elapsed < backoffSeconds * 1000) {
          return {
            evidence: [],
            partial: false,
            errors: [],
            unresponsiveEngines: [],
            requestUrl: redactRequestUrl(feedUrl),
            adapterMetadata: { skipped: "interval" },
          };
        }
      }
      const etag = typeof config.lastEtag === "string" ? config.lastEtag : undefined;
      const lastModified =
        typeof config.lastModified === "string" ? config.lastModified : undefined;
      const headers: Record<string, string> = {
        "user-agent": FEEDS_USER_AGENT,
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      };
      if (etag) {
        headers["if-none-match"] = etag;
      }
      if (lastModified) {
        headers["if-modified-since"] = lastModified;
      }
      const fetchedAt = new Date();
      try {
        const { response, finalUrl } = await safeFetchFollow(feedUrl, {
          fetchImpl,
          lookup,
          maxBytes: MAX_FEED_BODY_BYTES,
          maxRedirects: MAX_FEED_REDIRECTS,
          headers,
          signal: AbortSignal.timeout(15_000),
        });
        const retryAfter = response.headers.get("retry-after");
        if (response.status === 304) {
          const nextBackoff = Math.min(
            Math.max(backoffSeconds * 2, intervalSeconds),
            MAX_FEED_BACKOFF_SECONDS,
          );
          const streak = Number(config.unchangedStreak ?? 0) + 1;
          return {
            evidence: [],
            partial: false,
            errors: [],
            unresponsiveEngines: [],
            requestUrl: redactRequestUrl(finalUrl),
            responseStatus: 304,
            adapterMetadata: {
              persistConfig: persistConfigFrom(config, {
                lastEtag: etag,
                lastModified: lastModified ?? response.headers.get("last-modified") ?? undefined,
                backoffSeconds: nextBackoff,
                unchangedStreak: streak,
              }),
            },
          };
        }
        if (!response.ok) {
          const className = classifyFeedStatus(response.status);
          const message =
            className === "rate_limited" && retryAfter
              ? `Feed HTTP 429; Retry-After ${retryAfter}`
              : feedErrorMessage(response.status);
          return {
            evidence: [],
            partial: true,
            errors: [{ class: className, message }],
            unresponsiveEngines: [],
            requestUrl: redactRequestUrl(finalUrl),
            responseStatus: response.status,
            adapterMetadata: retryAfter ? { retryAfter } : undefined,
          };
        }
        const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
        const buffer = await readBoundedBytes(response, MAX_FEED_BODY_BYTES);
        const body = buffer.toString("utf8");
        if (contentType.includes("text/html") || /^\s*</.test(body) === false) {
          if (
            contentType.includes("text/html") ||
            /<html\b/i.test(body) ||
            /<!doctype html/i.test(body)
          ) {
            return {
              evidence: [],
              partial: true,
              errors: [
                { class: "malformed", message: "Feed returned HTML instead of RSS or Atom." },
              ],
              unresponsiveEngines: [],
              requestUrl: redactRequestUrl(finalUrl),
              responseStatus: response.status,
            };
          }
        }
        const parsed = parseFeedXml(body, fetchedAt, {
          feedUrl,
          maxItems: query.limit ?? MAX_FEED_ITEMS,
        });
        return {
          ...parsed,
          requestUrl: redactRequestUrl(finalUrl),
          responseStatus: response.status,
          adapterMetadata: {
            persistConfig: persistConfigFrom(config, {
              lastEtag: response.headers.get("etag") ?? etag,
              lastModified: response.headers.get("last-modified") ?? lastModified,
              backoffSeconds: intervalSeconds,
              unchangedStreak: 0,
            }),
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Feed fetch failed";
        let className: SourceErrorClass = "unavailable";
        if (isTimeoutError(error)) {
          className = "timeout";
        } else if (/size bound/i.test(message)) {
          className = "too_large";
        } else if (/not allowed|blocked address|Too many redirects/i.test(message)) {
          className = "blocked";
        }
        return {
          evidence: [],
          partial: true,
          errors: [{ class: className, message }],
          unresponsiveEngines: [],
          requestUrl: redactRequestUrl(feedUrl),
        };
      }
    },
  };
}
