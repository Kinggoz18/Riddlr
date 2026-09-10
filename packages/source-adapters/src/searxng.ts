import { normalizeEvidence, type RawEvidence, takeBounded } from "@riddlr/domain";
import {
  assertSafeHttpUrl,
  classifyHttpStatus,
  type FetchQuery,
  type FetchResult,
  hostMatchesSuffix,
  type SourceAdapter,
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

export function parseSearxngPayload(
  payload: SearxPayload,
  fetchedAt: Date,
  maxResults = 50,
): FetchResult {
  const errors: FetchResult["errors"] = [];
  const evidence: RawEvidence[] = [];
  const unresponsive = Array.isArray(payload.unresponsive_engines)
    ? payload.unresponsive_engines.slice(0, 16).map((item) => String(item))
    : [];
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
    evidence.push({
      sourceFamily: "search",
      adapterId: "searxng",
      url: typeof row.url === "string" ? row.url : undefined,
      title: typeof row.title === "string" ? row.title : undefined,
      bodyText: typeof row.content === "string" ? row.content : undefined,
      publishedAt: typeof row.publishedDate === "string" ? new Date(row.publishedDate) : undefined,
      fetchedAt,
      adapterPayload: { engine: row.engine },
    });
  }
  return {
    evidence,
    partial: unresponsive.length > 0 || errors.length > 0,
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

export function createSearxngAdapter(fetchImpl: typeof fetch = fetch): SourceAdapter {
  return {
    id: "searxng",
    family: "search",
    capabilities: {
      modes: ["search"],
      supportsTimeRange: true,
      supportsPagination: true,
      supportsDomainFilter: true,
      lookbackNotes: "time_range is engine-dependent",
      partialResults: true,
    },
    async validate(config) {
      const endpoint = String(config.endpoint ?? "");
      try {
        assertSafeHttpUrl(endpoint, ["searxng", "localhost", "127.0.0.1"]);
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
      assertSafeHttpUrl(endpoint, ["searxng", "localhost", "127.0.0.1"]);
      const url = new URL("/search", `${endpoint.replace(/\/$/, "")}/`);
      url.searchParams.set("q", query.query);
      url.searchParams.set("format", "json");
      const limit = query.limit ?? 20;
      url.searchParams.set("number_of_results", String(limit));
      if (query.language) {
        url.searchParams.set("language", query.language);
      }
      if (query.timeRange) {
        url.searchParams.set("time_range", query.timeRange);
      }
      if (query.page) {
        url.searchParams.set("pageno", String(query.page));
      }
      if (query.categories && query.categories.length > 0) {
        url.searchParams.set("categories", query.categories.join(","));
      }
      const fetchedAt = new Date();
      try {
        const response = await fetchImpl(url, {
          signal: AbortSignal.timeout(15000),
          redirect: "manual",
        });
        if (!response.ok) {
          return {
            evidence: [],
            partial: true,
            errors: [
              {
                class: classifyHttpStatus(response.status),
                message: `SearXNG HTTP ${response.status}`,
              },
            ],
            unresponsiveEngines: [],
          };
        }
        const payload = (await response.json()) as SearxPayload;
        const parsed = parseSearxngPayload(payload, fetchedAt, limit);
        const filtered = parsed.evidence.filter((item) => hostAllowed(item.url, query));
        return { ...parsed, evidence: takeBounded(filtered, limit) };
      } catch (error) {
        return {
          evidence: [],
          partial: true,
          errors: [
            {
              class: "timeout",
              message: error instanceof Error ? error.message : "SearXNG fetch failed",
            },
          ],
          unresponsiveEngines: [],
        };
      }
    },
  };
}

export function toNormalized(raw: RawEvidence[]) {
  return raw.map((item) => normalizeEvidence(item));
}
