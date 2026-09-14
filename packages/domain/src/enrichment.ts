import { canonicalizeUrl } from "./evidence.js";
import { takeBounded } from "./limits.js";
import { hostMatchesPublisherPolicy } from "./publisher-hosts.js";
import type { ContentCompleteness, PageClass, TrustTier } from "./reliability.js";

export const MAX_ENRICH_PER_SCAN = 12;
export const MAX_ENRICH_PER_HOST = 3;
export const MAX_ENRICH_BYTES = 500_000;
export const MAX_ENRICH_CHARS = 50_000;
export const MAX_ENRICH_REDIRECTS = 3;
export const ENRICH_TIMEOUT_MS = 10_000;
export const EXTRACTOR_VERSION = "html-main-1";

const NAV_PATH =
  /\/(tag|tags|search|login|signin|signup|account|privacy|terms|cookies|category|categories)(\/|$)/i;
const PRICE_PATH = /\/(price|markets?|quotes?|ticker)(\/|$)/i;
const GENERIC_TITLE = /^(home|latest|markets?|prices?|news)\b/i;

export type EnrichmentEligibility = {
  eligible: boolean;
  reason: string;
  host?: string;
};

export function classifyPageHeuristic(input: {
  url?: string;
  title?: string;
  bodyText?: string;
}): PageClass {
  const hay = `${input.title ?? ""} ${input.bodyText ?? ""} ${input.url ?? ""}`.toLowerCase();
  if (
    PRICE_PATH.test(input.url ?? "") ||
    /\b(quoted at usd|market cap usd|24h volume)\b/i.test(hay)
  ) {
    return "market_profile";
  }
  if (/\b(opinion|i think|in my view)\b/i.test(hay)) {
    return "opinion";
  }
  if (/\b(sponsored|promoted|advertisement)\b/i.test(hay)) {
    return "promotion";
  }
  if (/\b(official statement|press release|gazette)\b/i.test(hay)) {
    return "official_statement";
  }
  if (input.bodyText && input.bodyText.length >= 80 && input.title && input.title.length >= 12) {
    return "news_report";
  }
  return "unknown";
}

export function enrichmentEligibility(input: {
  url?: string;
  title?: string;
  publishedAt?: Date;
  fetchedAt: Date;
  windowStart?: Date;
  blockedHosts?: string[];
  allowedHosts?: string[];
}): EnrichmentEligibility {
  const canonical = canonicalizeUrl(input.url);
  if (!canonical) {
    return { eligible: false, reason: "missing_url" };
  }
  let parsed: URL;
  try {
    parsed = new URL(canonical);
  } catch {
    return { eligible: false, reason: "invalid_url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { eligible: false, reason: "unsupported_scheme" };
  }
  const host = parsed.hostname.toLowerCase();
  if (input.blockedHosts?.some((item) => hostMatchesPublisherPolicy(host, item))) {
    return { eligible: false, reason: "blocked_host", host };
  }
  if (input.allowedHosts && input.allowedHosts.length > 0) {
    const allowed = input.allowedHosts.some((item) => hostMatchesPublisherPolicy(host, item));
    if (!allowed) {
      return { eligible: false, reason: "host_not_allowlisted", host };
    }
  }
  if (NAV_PATH.test(parsed.pathname)) {
    return { eligible: false, reason: "navigation_page", host };
  }
  if (GENERIC_TITLE.test((input.title ?? "").trim()) && (input.title ?? "").length < 24) {
    return { eligible: false, reason: "generic_title", host };
  }
  if (input.publishedAt) {
    const published = input.publishedAt.getTime();
    if (Number.isNaN(published)) {
      return { eligible: false, reason: "invalid_date", host };
    }
    if (published > input.fetchedAt.getTime() + 24 * 60 * 60 * 1000) {
      return { eligible: false, reason: "future_date", host };
    }
    if (input.windowStart && published < input.windowStart.getTime() - 7 * 24 * 60 * 60 * 1000) {
      return { eligible: false, reason: "stale", host };
    }
  }
  return { eligible: true, reason: "ok", host };
}

export function prioritizeEnrichment<T extends { url?: string; title?: string; fetchedAt: Date }>(
  items: readonly T[],
  limit = MAX_ENRICH_PER_SCAN,
): T[] {
  const scored = items.map((item, index) => {
    const title = item.title ?? "";
    const score =
      (title.length >= 24 ? 2 : 0) +
      (PRICE_PATH.test(item.url ?? "") ? -4 : 0) +
      (NAV_PATH.test(item.url ?? "") ? -4 : 0);
    return { item, index, score };
  });
  scored.sort((left, right) => right.score - left.score || left.index - right.index);
  return takeBounded(
    scored.filter((row) => row.score >= 0).map((row) => row.item),
    limit,
  );
}

export function completenessFromDocument(status: string): ContentCompleteness {
  if (status === "extracted" || status === "not_modified") {
    return "full_document";
  }
  if (status === "native") {
    return "native_complete";
  }
  if (status === "unsupported" || status === "paywalled" || status === "challenge") {
    return "unsupported";
  }
  if (status === "failed" || status === "robots_denied" || status === "too_large") {
    return "incomplete";
  }
  return "snippet";
}

export function trustAllowsUse(
  tier: TrustTier,
  use: "discovery" | "analysis" | "early_warning" | "confirmation",
  allowedUses?: readonly string[],
) {
  if (tier === "blocked") {
    return false;
  }
  if (use === "discovery") {
    return true;
  }
  if (allowedUses && allowedUses.length > 0 && !allowedUses.includes(use)) {
    return false;
  }
  if (use === "analysis") {
    return true;
  }
  if (use === "early_warning") {
    return tier === "official_firsthand" || tier === "known_analyst";
  }
  if (use === "confirmation") {
    return tier === "official_firsthand";
  }
  return false;
}
