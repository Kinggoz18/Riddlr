import { createHash } from "node:crypto";
import {
  type ContentCompleteness,
  completenessFromDocument,
  contentHash,
  ENRICH_TIMEOUT_MS,
  EXTRACTOR_VERSION,
  extractMainHtml,
  extractOutboundUrls,
  MAX_ENRICH_BYTES,
  MAX_ENRICH_REDIRECTS,
} from "@riddlr/domain";
import { loadRobotsTxt, pathDisallowedByRobots } from "./robots.js";
import { isBlockedSsrfHost, type LookupFn, readBoundedBytes, safeFetchFollow } from "./types.js";
import { RIDDLR_HTTP_USER_AGENT } from "./user-agent.js";

const TEXT_TYPES = ["text/html", "application/xhtml+xml", "text/plain"];

export type EnrichmentDocument = {
  requestedUrl: string;
  finalUrl: string;
  httpStatus?: number;
  contentType?: string;
  byteCount: number;
  responseHash: string;
  cleanedContentHash: string;
  cleanedText: string;
  extractedTitle?: string;
  byline?: string;
  language?: string;
  etag?: string;
  lastModified?: string;
  extractorVersion: string;
  fetchedAt: Date;
  status: string;
  failureReason?: string;
  completeness: ContentCompleteness;
  outboundUrls: string[];
};

function publicLookup(hostname: string): Promise<Array<{ address: string; family: number }>> {
  if (isBlockedSsrfHost(hostname)) {
    return Promise.reject(new Error("URL host is not allowed."));
  }
  return Promise.resolve([{ address: "8.8.8.8", family: 4 }]);
}

export async function enrichPublicDocument(input: {
  url: string;
  fetchImpl?: typeof fetch;
  lookup?: LookupFn;
  maxBytes?: number;
  timeoutMs?: number;
  skipDns?: boolean;
  ifNoneMatch?: string;
  ifModifiedSince?: string;
  cachedRobotsTxt?: string;
  cachedRobotsStatus?: number;
  onRobotsTxt?: (loaded: {
    text: string;
    status: number;
    fromCache: boolean;
  }) => void | Promise<void>;
}): Promise<EnrichmentDocument> {
  const fetchedAt = new Date();
  const requestedUrl = input.url;
  const empty = (status: string, failureReason: string): EnrichmentDocument => ({
    requestedUrl,
    finalUrl: requestedUrl,
    byteCount: 0,
    responseHash: contentHash(""),
    cleanedContentHash: contentHash(""),
    cleanedText: "",
    extractorVersion: EXTRACTOR_VERSION,
    fetchedAt,
    status,
    failureReason,
    completeness: completenessFromDocument(status),
    outboundUrls: [],
  });
  let parsed: URL;
  try {
    parsed = new URL(requestedUrl);
  } catch {
    return empty("failed", "invalid_url");
  }
  const robots = await loadRobotsTxt({
    origin: parsed.origin,
    fetchImpl: input.fetchImpl,
    cachedText: input.cachedRobotsTxt,
    cachedStatus: input.cachedRobotsStatus,
  });
  await input.onRobotsTxt?.(robots);
  if (pathDisallowedByRobots(robots.text, parsed.pathname)) {
    return empty("robots_denied", "robots_denied");
  }
  try {
    const { response, finalUrl } = await safeFetchFollow(requestedUrl, {
      fetchImpl: input.fetchImpl,
      lookup: input.skipDns ? publicLookup : input.lookup,
      maxBytes: input.maxBytes ?? MAX_ENRICH_BYTES,
      maxRedirects: MAX_ENRICH_REDIRECTS,
      signal: AbortSignal.timeout(input.timeoutMs ?? ENRICH_TIMEOUT_MS),
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        "user-agent": RIDDLR_HTTP_USER_AGENT,
        ...(input.ifNoneMatch ? { "if-none-match": input.ifNoneMatch } : {}),
        ...(input.ifModifiedSince ? { "if-modified-since": input.ifModifiedSince } : {}),
      },
    });
    if (response.status === 304) {
      return {
        ...empty("not_modified", "not_modified"),
        finalUrl,
        httpStatus: 304,
        etag: input.ifNoneMatch,
        lastModified: input.ifModifiedSince,
        completeness: "full_document",
      };
    }
    const contentType = response.headers.get("content-type") ?? undefined;
    const mime = contentType?.split(";")[0]?.trim().toLowerCase();
    if (mime && !TEXT_TYPES.includes(mime) && !mime.startsWith("text/")) {
      return {
        ...empty("unsupported", "unsupported_media"),
        finalUrl,
        httpStatus: response.status,
        contentType,
      };
    }
    const buffer = await readBoundedBytes(response, input.maxBytes ?? MAX_ENRICH_BYTES);
    const html = buffer.toString("utf8");
    const extracted = extractMainHtml(html);
    if (extracted.failure) {
      const status =
        extracted.failure === "paywall"
          ? "paywalled"
          : extracted.failure === "challenge"
            ? "challenge"
            : "failed";
      return {
        requestedUrl,
        finalUrl,
        httpStatus: response.status,
        contentType,
        byteCount: buffer.byteLength,
        responseHash: createHash("sha256").update(buffer).digest("hex"),
        cleanedContentHash: contentHash(extracted.text),
        cleanedText: extracted.text,
        extractedTitle: extracted.title,
        byline: extracted.byline,
        language: extracted.language,
        etag: response.headers.get("etag") ?? undefined,
        lastModified: response.headers.get("last-modified") ?? undefined,
        extractorVersion: EXTRACTOR_VERSION,
        fetchedAt,
        status,
        failureReason: extracted.failure,
        completeness: completenessFromDocument(status),
        outboundUrls: extractOutboundUrls(html, finalUrl),
      };
    }
    return {
      requestedUrl,
      finalUrl,
      httpStatus: response.status,
      contentType,
      byteCount: buffer.byteLength,
      responseHash: createHash("sha256").update(buffer).digest("hex"),
      cleanedContentHash: contentHash(extracted.text),
      cleanedText: extracted.text,
      extractedTitle: extracted.title,
      byline: extracted.byline,
      language: extracted.language,
      etag: response.headers.get("etag") ?? undefined,
      lastModified: response.headers.get("last-modified") ?? undefined,
      extractorVersion: EXTRACTOR_VERSION,
      fetchedAt,
      status: "extracted",
      completeness: "full_document",
      outboundUrls: extractOutboundUrls(html, finalUrl),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "enrichment_failed";
    const status = message.includes("size bound") ? "too_large" : "failed";
    return empty(status, message);
  }
}
