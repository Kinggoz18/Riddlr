import {
  MAX_SEARXNG_BODY_BYTES,
  MAX_SEARXNG_ENGINES,
  MAX_UNRESPONSIVE_ENGINES,
  normalizeEvidence,
  type RawEvidence,
  takeBounded,
} from "@riddlr/domain";
import {
  assertSafeHttpUrl,
  classifyHttpStatus,
  type FetchQuery,
  type FetchResult,
  hostMatchesSuffix,
  readBoundedBytes,
  redactRequestUrl,
  type SourceAdapter,
  type SourceErrorClass,
} from "./types.js";

type SearxResult = {
  url?: unknown;
  title?: unknown;
  content?: unknown;
  publishedDate?: unknown;
  engine?: unknown;
};

type SearxPayload = {
  results?: unknown;
  unresponsive_engines?: unknown;
};

/** Compose DNS name plus the native overlay bind (`127.0.0.1:8888`). */
export const SEARXNG_SAFE_HOSTS = ["searxng", "localhost", "127.0.0.1"] as const;

const SEARXNG_ENGINE_RE = /^[a-z0-9][a-z0-9._ -]{0,63}$/;

export function parseSearxngEngines(value: unknown): string[] {
  if (value === undefined || value === null || value === "") {
    return [];
  }
  const raw = Array.isArray(value)
    ? value.map((item) => String(item))
    : typeof value === "string"
      ? value.split(",")
      : null;
  if (!raw) {
    throw new Error("SearXNG engines must be a comma-separated list.");
  }
  const engines: string[] = [];
  for (const item of raw) {
    const trimmed = item.trim().toLowerCase();
    if (!trimmed) {
      continue;
    }
    if (!SEARXNG_ENGINE_RE.test(trimmed)) {
      throw new Error(`Invalid SearXNG engine name '${trimmed}'.`);
    }
    engines.push(trimmed);
  }
  return takeBounded([...new Set(engines)], MAX_SEARXNG_ENGINES);
}

export function parseSearxngPayload(
  payload: SearxPayload,
  fetchedAt: Date,
  maxResults = 50,
): FetchResult {
  const errors: FetchResult["errors"] = [];
  const evidence: RawEvidence[] = [];
  const unresponsive = Array.isArray(payload.unresponsive_engines)
    ? takeBounded(
        payload.unresponsive_engines.map((item) => String(item)),
        MAX_UNRESPONSIVE_ENGINES,
      )
    : [];
  if (payload.results !== undefined && !Array.isArray(payload.results)) {
    return {
      evidence: [],
      partial: true,
      errors: [{ class: "malformed", message: "SearXNG results was not an array" }],
      unresponsiveEngines: unresponsive,
    };
  }
  const results = takeBounded(Array.isArray(payload.results) ? payload.results : [], maxResults);
  for (const item of results) {
    if (!item || typeof item !== "object") {
      errors.push({ class: "malformed", message: "Non-object result skipped" });
      continue;
    }
    const row = item as SearxResult;
    if (typeof row.url !== "string" && typeof row.title !== "string") {
      errors.push({ class: "malformed", message: "Result missing url and title" });
      continue;
    }
    let hostname: string | undefined;
    if (typeof row.url === "string") {
      try {
        hostname = new URL(row.url).hostname.toLowerCase();
      } catch {
        hostname = undefined;
      }
    }
    evidence.push({
      sourceFamily: "search",
      adapterId: "searxng",
      url: typeof row.url === "string" ? row.url : undefined,
      title: typeof row.title === "string" ? row.title : undefined,
      bodyText: typeof row.content === "string" ? row.content : undefined,
      publishedAt: typeof row.publishedDate === "string" ? new Date(row.publishedDate) : undefined,
      fetchedAt,
      adapterPayload: { engine: row.engine },
      contentCompleteness: "snippet",
      sourceIdentity: hostname
        ? {
            platform: "web",
            externalId: hostname,
            displayName: hostname,
            hostname,
          }
        : undefined,
    });
  }
  return {
    evidence,
    partial: errors.length > 0,
    errors,
    unresponsiveEngines: unresponsive,
  };
}

function hostAllowed(url: string | undefined, query: FetchQuery): boolean {
  if (!url) {
    return true;
  }
  try {
    const host = new URL(url).hostname;
    if (query.blockedHosts?.some((item) => hostMatchesSuffix(host, item))) {
      return false;
    }
    if (query.allowedHosts && query.allowedHosts.length > 0) {
      return query.allowedHosts.some((item) => hostMatchesSuffix(host, item));
    }
    return true;
  } catch {
    return false;
  }
}

function searxngFailure(
  className: SourceErrorClass,
  message: string,
  status?: number,
  requestUrl?: string,
): FetchResult {
  return {
    evidence: [],
    partial: true,
    errors: [{ class: className, message }],
    unresponsiveEngines: [],
    requestUrl,
    responseStatus: status,
  };
}

export function createSearxngAdapter(fetchImpl: typeof fetch = fetch): SourceAdapter {
  return {
    id: "searxng",
    family: "search",
    capabilities: {
      modes: ["search"],
      supportsTimeRange: true,
      supportsPagination: true,
      supportsDomainFilter: true,
      lookbackNotes:
        "categories=news, time_range=day, language=en; one query per watched asset plus one general query",
      partialResults: true,
    },
    async validate(config) {
      const endpoint = String(config.endpoint ?? "");
      try {
        assertSafeHttpUrl(endpoint, [...SEARXNG_SAFE_HOSTS]);
        parseSearxngEngines(config.engines);
        return { ok: true, message: "Endpoint looks valid." };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "Invalid endpoint" };
      }
    },
    async healthCheck(config) {
      const endpoint = String(config.endpoint ?? "");
      try {
        const url = new URL("/search", `${endpoint.replace(/\/$/, "")}/`);
        url.searchParams.set("q", "riddlr health");
        url.searchParams.set("format", "json");
        url.searchParams.set("number_of_results", "1");
        const response = await fetchImpl(url, {
          signal: AbortSignal.timeout(8000),
          redirect: "manual",
        });
        if (response.status === 403) {
          return { ok: false, message: "JSON format disabled on this SearXNG instance." };
        }
        if (!response.ok) {
          return { ok: false, message: `HTTP ${response.status}` };
        }
        return { ok: true, message: "SearXNG JSON search is reachable." };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "health check failed",
        };
      }
    },
    async fetch(config, query) {
      const endpoint = String(config.endpoint ?? "");
      assertSafeHttpUrl(endpoint, [...SEARXNG_SAFE_HOSTS]);
      const url = new URL("/search", `${endpoint.replace(/\/$/, "")}/`);
      url.searchParams.set("q", query.query);
      url.searchParams.set("format", "json");
      const limit = query.limit ?? 20;
      url.searchParams.set("number_of_results", String(limit));
      url.searchParams.set("language", query.language ?? "en");
      url.searchParams.set("time_range", query.timeRange ?? "day");
      url.searchParams.set(
        "categories",
        query.categories && query.categories.length > 0 ? query.categories.join(",") : "news",
      );
      if (query.page) {
        url.searchParams.set("pageno", String(query.page));
      }
      const engines = parseSearxngEngines(config.engines);
      if (engines.length > 0) {
        url.searchParams.set("engines", engines.join(","));
      }
      const requestUrl = redactRequestUrl(url.toString());
      const fetchedAt = new Date();
      try {
        const response = await fetchImpl(url, {
          signal: AbortSignal.timeout(15000),
          redirect: "manual",
        });
        const retryAfter = response.headers.get("retry-after");
        const length = Number(response.headers.get("content-length") ?? "0");
        if (Number.isFinite(length) && length > MAX_SEARXNG_BODY_BYTES) {
          return searxngFailure(
            "too_large",
            "SearXNG response exceeded the size bound.",
            response.status,
            requestUrl,
          );
        }
        if (response.status === 429) {
          return searxngFailure(
            "rate_limited",
            retryAfter ? `SearXNG HTTP 429; Retry-After ${retryAfter}` : "SearXNG HTTP 429",
            429,
            requestUrl,
          );
        }
        if (response.status === 451) {
          return searxngFailure("blocked", "SearXNG HTTP 451", 451, requestUrl);
        }
        if (!response.ok) {
          return searxngFailure(
            classifyHttpStatus(response.status),
            `SearXNG HTTP ${response.status}`,
            response.status,
            requestUrl,
          );
        }
        const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
        const buffer = await readBoundedBytes(response, MAX_SEARXNG_BODY_BYTES);
        const body = buffer.toString("utf8");
        if (contentType.includes("text/html") || /^\s*</.test(body)) {
          return searxngFailure(
            "malformed",
            "SearXNG returned HTML instead of JSON",
            response.status,
            requestUrl,
          );
        }
        let payload: SearxPayload;
        try {
          payload = JSON.parse(body) as SearxPayload;
        } catch {
          return searxngFailure(
            "malformed",
            "SearXNG body was not JSON",
            response.status,
            requestUrl,
          );
        }
        const parsed = parseSearxngPayload(payload, fetchedAt, limit);
        const filtered = parsed.evidence.filter((item) => hostAllowed(item.url, query));
        return {
          ...parsed,
          evidence: takeBounded(filtered, limit),
          requestUrl,
          responseStatus: response.status,
          adapterMetadata:
            parsed.unresponsiveEngines.length > 0
              ? { unresponsiveEngines: parsed.unresponsiveEngines }
              : undefined,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "SearXNG fetch failed";
        const className: SourceErrorClass = message.includes("size bound")
          ? "too_large"
          : /timeout|aborted/i.test(message)
            ? "timeout"
            : "unavailable";
        return searxngFailure(className, message, undefined, requestUrl);
      }
    },
  };
}

export function toNormalized(raw: RawEvidence[]) {
  return raw.map((item) => normalizeEvidence(item));
}
