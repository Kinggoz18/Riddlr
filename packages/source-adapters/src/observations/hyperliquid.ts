import {
  annualizeFundingAprPercent,
  DEFAULT_FUTURES_INTERVAL_MS,
  decimalRateToPercent,
  HYPERLIQUID_FUNDING_PERIOD_HOURS,
  hourBucketUtc,
  isFiniteNumber,
  MAX_HYPERLIQUID_BODY_BYTES,
  MAX_HYPERLIQUID_UNIVERSE,
  OBSERVE_CLOCK_SKEW_MS,
  type SeriesObservation,
  takeBounded,
} from "@riddlr/domain";
import {
  assertSafeHttpUrl,
  classifyHttpStatus,
  readBoundedJson,
  type SourceAdapter,
} from "../types.js";
import type { ObservationProvider, ObserveQuery, ObserveResult } from "./types.js";

export const HYPERLIQUID_PROVIDER_ID = "hyperliquid";
export const HYPERLIQUID_FAMILY = "observation";
export const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";
export const HYPERLIQUID_USER_AGENT = "Riddlr/0.1 (https://github.com/Kinggoz18/Riddlr)";

const METRICS = [
  "funding_rate_1h",
  "funding_rate_apr",
  "funding_predicted_apr",
  "funding_predicted_binance_apr",
  "open_interest",
  "open_interest_usd",
  "mark_price",
  "premium",
  "volume_24h_usd",
] as const;

type SourceError = ObserveResult["errors"][number];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseDecimal(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function looksLikeHtml(payload: unknown, contentType: string | null): boolean {
  if (contentType?.includes("text/html")) {
    return true;
  }
  return typeof payload === "string" && /^\s*</.test(payload);
}

function clampObservedAt(observedAt: Date, fetchedAt: Date): Date {
  if (observedAt.getTime() - fetchedAt.getTime() > OBSERVE_CLOCK_SKEW_MS) {
    return fetchedAt;
  }
  return observedAt;
}

export function parseSymbolMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const map: Record<string, string> = {};
  for (const [symbol, canonical] of Object.entries(value as Record<string, unknown>)) {
    const key = symbol.trim().toUpperCase();
    if (!key || typeof canonical !== "string") {
      continue;
    }
    const id = canonical.trim().toLowerCase();
    if (!id.includes(":")) {
      continue;
    }
    map[key] = id;
  }
  return map;
}

export function resolveHyperliquidSubject(
  coin: string,
  symbolMap: Record<string, string>,
  watched: ReadonlySet<string>,
): string | undefined {
  const mapped = symbolMap[coin.toUpperCase()];
  if (mapped && watched.has(mapped)) {
    return mapped;
  }
  const native = `${HYPERLIQUID_PROVIDER_ID}:${coin.toUpperCase()}`;
  if (watched.has(native)) {
    return native;
  }
  return undefined;
}

function pushMetric(
  observations: SeriesObservation[],
  input: {
    metric: (typeof METRICS)[number];
    subjectCanonicalId: string;
    value: number | undefined;
    unit: string;
    observedAt: Date;
  },
) {
  if (!isFiniteNumber(input.value)) {
    return;
  }
  observations.push({
    provider: HYPERLIQUID_PROVIDER_ID,
    metric: input.metric,
    subjectCanonicalId: input.subjectCanonicalId,
    value: input.value,
    unit: input.unit,
    observedAt: input.observedAt,
  });
}

export function parseMetaAndAssetCtxs(
  payload: unknown,
  input: {
    symbolMap: Record<string, string>;
    watched: ReadonlySet<string>;
    fetchedAt: Date;
  },
): { observations: SeriesObservation[]; errors: SourceError[] } {
  if (typeof payload === "string" && looksLikeHtml(payload, null)) {
    return {
      observations: [],
      errors: [{ class: "unavailable", message: "Hyperliquid returned HTML instead of JSON." }],
    };
  }
  if (!Array.isArray(payload)) {
    return {
      observations: [],
      errors: [{ class: "malformed", message: "Hyperliquid metaAndAssetCtxs is not an array." }],
    };
  }
  if (payload.length === 0) {
    return { observations: [], errors: [] };
  }
  const meta = asRecord(payload[0]);
  const ctxs = payload[1];
  if (!meta || !Array.isArray(ctxs)) {
    return {
      observations: [],
      errors: [
        {
          class: "malformed",
          message: "Hyperliquid metaAndAssetCtxs is missing universe or assetCtxs.",
        },
      ],
    };
  }
  const universe = Array.isArray(meta.universe) ? meta.universe : [];
  if (universe.length !== ctxs.length) {
    return {
      observations: [],
      errors: [
        {
          class: "malformed",
          message: "Hyperliquid universe and assetCtxs length mismatch.",
        },
      ],
    };
  }
  const observations: SeriesObservation[] = [];
  const fetchedAt = input.fetchedAt;
  const fundingAt = hourBucketUtc(fetchedAt);
  for (const [index, raw] of takeBounded(universe, MAX_HYPERLIQUID_UNIVERSE).entries()) {
    const row = asRecord(raw);
    const ctx = asRecord(ctxs[index]);
    const coin = typeof row?.name === "string" ? row.name.trim().toUpperCase() : "";
    if (!row || !ctx || !coin) {
      continue;
    }
    if (row.isDelisted === true) {
      continue;
    }
    const subject = resolveHyperliquidSubject(coin, input.symbolMap, input.watched);
    if (!subject) {
      continue;
    }
    const funding = parseDecimal(ctx.funding);
    const openInterest = parseDecimal(ctx.openInterest);
    const markPx = parseDecimal(ctx.markPx);
    const premium = parseDecimal(ctx.premium);
    const volume = parseDecimal(ctx.dayNtlVlm);
    pushMetric(observations, {
      metric: "funding_rate_1h",
      subjectCanonicalId: subject,
      value: funding === undefined ? undefined : decimalRateToPercent(funding),
      unit: "percent",
      observedAt: fundingAt,
    });
    pushMetric(observations, {
      metric: "funding_rate_apr",
      subjectCanonicalId: subject,
      value:
        funding === undefined
          ? undefined
          : annualizeFundingAprPercent(funding, HYPERLIQUID_FUNDING_PERIOD_HOURS),
      unit: "percent",
      observedAt: fundingAt,
    });
    pushMetric(observations, {
      metric: "open_interest",
      subjectCanonicalId: subject,
      value: openInterest,
      unit: "contracts",
      observedAt: fetchedAt,
    });
    pushMetric(observations, {
      metric: "mark_price",
      subjectCanonicalId: subject,
      value: markPx,
      unit: "usd",
      observedAt: fetchedAt,
    });
    pushMetric(observations, {
      metric: "open_interest_usd",
      subjectCanonicalId: subject,
      value: openInterest !== undefined && markPx !== undefined ? openInterest * markPx : undefined,
      unit: "usd",
      observedAt: fetchedAt,
    });
    pushMetric(observations, {
      metric: "premium",
      subjectCanonicalId: subject,
      value: premium === undefined ? undefined : decimalRateToPercent(premium),
      unit: "percent",
      observedAt: fetchedAt,
    });
    pushMetric(observations, {
      metric: "volume_24h_usd",
      subjectCanonicalId: subject,
      value: volume,
      unit: "usd",
      observedAt: fetchedAt,
    });
  }
  return { observations, errors: [] };
}

export function parsePredictedFundings(
  payload: unknown,
  input: {
    symbolMap: Record<string, string>;
    watched: ReadonlySet<string>;
    fetchedAt: Date;
  },
): { observations: SeriesObservation[]; errors: SourceError[] } {
  if (typeof payload === "string" && looksLikeHtml(payload, null)) {
    return {
      observations: [],
      errors: [{ class: "unavailable", message: "Hyperliquid returned HTML instead of JSON." }],
    };
  }
  if (!Array.isArray(payload)) {
    return {
      observations: [],
      errors: [{ class: "malformed", message: "Hyperliquid predictedFundings is not an array." }],
    };
  }
  const observations: SeriesObservation[] = [];
  const fundingAt = hourBucketUtc(input.fetchedAt);
  for (const item of takeBounded(payload, MAX_HYPERLIQUID_UNIVERSE)) {
    if (!Array.isArray(item) || typeof item[0] !== "string") {
      continue;
    }
    const coin = item[0].trim().toUpperCase();
    const subject = resolveHyperliquidSubject(coin, input.symbolMap, input.watched);
    if (!subject) {
      continue;
    }
    const venues = Array.isArray(item[1]) ? item[1] : [];
    for (const venue of venues) {
      if (!Array.isArray(venue) || typeof venue[0] !== "string") {
        continue;
      }
      const body = asRecord(venue[1]);
      const rate = parseDecimal(body?.fundingRate);
      const period = parseDecimal(body?.fundingIntervalHours);
      if (rate === undefined || period === undefined || period <= 0) {
        continue;
      }
      const apr = annualizeFundingAprPercent(rate, period);
      if (venue[0] === "HlPerp") {
        pushMetric(observations, {
          metric: "funding_predicted_apr",
          subjectCanonicalId: subject,
          value: apr,
          unit: "percent",
          observedAt: fundingAt,
        });
      }
      if (venue[0] === "BinPerp") {
        pushMetric(observations, {
          metric: "funding_predicted_binance_apr",
          subjectCanonicalId: subject,
          value: apr,
          unit: "percent",
          observedAt: fundingAt,
        });
      }
    }
  }
  return { observations, errors: [] };
}

type CallResult =
  | { ok: true; payload: unknown; status: number; requestUrl: string }
  | { ok: false; errors: SourceError[]; status?: number; requestUrl: string };

export function createHyperliquidProvider(
  options: { fetchImpl?: typeof fetch; intervalMs?: number; minIntervalMs?: number } = {},
): ObservationProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const minIntervalMs = options.minIntervalMs ?? 200;
  let chain = Promise.resolve();
  let lastCallAt = 0;

  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function postInfo(type: string): Promise<CallResult> {
    const requestUrl = HYPERLIQUID_INFO_URL;
    try {
      assertSafeHttpUrl(requestUrl);
    } catch {
      return {
        ok: false,
        errors: [{ class: "blocked", message: "Hyperliquid URL failed SSRF checks." }],
        requestUrl,
      };
    }
    const wait = Math.max(0, minIntervalMs - (Date.now() - lastCallAt));
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastCallAt = Date.now();
    try {
      const response = await fetchImpl(requestUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": HYPERLIQUID_USER_AGENT,
        },
        body: JSON.stringify({ type }),
        signal: AbortSignal.timeout(20_000),
        redirect: "manual",
      });
      if (response.status >= 300 && response.status < 400) {
        return {
          ok: false,
          errors: [
            {
              class: "unavailable",
              message: "Hyperliquid redirected; redirects are not followed.",
            },
          ],
          status: response.status,
          requestUrl,
        };
      }
      if (!response.ok) {
        const classified = classifyHttpStatus(response.status);
        return {
          ok: false,
          errors: [
            {
              class: classified,
              message: `Hyperliquid HTTP ${response.status}`,
            },
          ],
          status: response.status,
          requestUrl,
        };
      }
      const contentType = response.headers.get("content-type");
      let payload: unknown;
      try {
        payload = await readBoundedJson(response, MAX_HYPERLIQUID_BODY_BYTES);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Hyperliquid body too large.";
        return {
          ok: false,
          errors: [
            {
              class: message.toLowerCase().includes("timeout") ? "timeout" : "too_large",
              message,
            },
          ],
          status: response.status,
          requestUrl,
        };
      }
      if (looksLikeHtml(payload, contentType)) {
        return {
          ok: false,
          errors: [{ class: "unavailable", message: "Hyperliquid returned HTML instead of JSON." }],
          status: response.status,
          requestUrl,
        };
      }
      return { ok: true, payload, status: response.status, requestUrl };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Hyperliquid request failed.";
      const timedOut = /timeout|aborted/i.test(message);
      return {
        ok: false,
        errors: [{ class: timedOut ? "timeout" : "unavailable", message }],
        requestUrl,
      };
    }
  }

  return {
    id: HYPERLIQUID_PROVIDER_ID,
    metrics: METRICS,
    defaultIntervalMs: options.intervalMs ?? DEFAULT_FUTURES_INTERVAL_MS,
    optIn: true,
    async observe(config, query: ObserveQuery): Promise<ObserveResult> {
      const fetchedAt = clampObservedAt(query.observedAt, new Date());
      const symbolMap = parseSymbolMap(config.symbolMap);
      const watched = new Set(query.subjectCanonicalIds);
      const observations: SeriesObservation[] = [];
      const errors: SourceError[] = [];
      let lastUrl: string | undefined;
      let lastStatus: number | undefined;
      const meta = await enqueue(() => postInfo("metaAndAssetCtxs"));
      lastUrl = meta.requestUrl;
      lastStatus = meta.status;
      if (!meta.ok) {
        errors.push(...meta.errors);
      } else {
        const parsed = parseMetaAndAssetCtxs(meta.payload, { symbolMap, watched, fetchedAt });
        observations.push(...parsed.observations);
        errors.push(...parsed.errors);
      }
      const predicted = await enqueue(() => postInfo("predictedFundings"));
      lastUrl = predicted.requestUrl;
      lastStatus = predicted.status ?? lastStatus;
      if (!predicted.ok) {
        errors.push(...predicted.errors);
      } else {
        const parsed = parsePredictedFundings(predicted.payload, { symbolMap, watched, fetchedAt });
        observations.push(...parsed.observations);
        errors.push(...parsed.errors);
      }
      return {
        observations: takeBounded(observations, MAX_HYPERLIQUID_UNIVERSE * METRICS.length),
        partial: errors.length > 0,
        errors,
        requestUrl: lastUrl,
        responseStatus: lastStatus,
      };
    },
  };
}

export function createHyperliquidAdapter(fetchImpl: typeof fetch = fetch): SourceAdapter {
  return {
    id: HYPERLIQUID_PROVIDER_ID,
    family: HYPERLIQUID_FAMILY,
    capabilities: {
      modes: ["poll"],
      supportsTimeRange: false,
      supportsPagination: false,
      supportsDomainFilter: false,
      lookbackNotes:
        "Opt-in. Free Hyperliquid info endpoint, no API key. One POST metaAndAssetCtxs plus one POST predictedFundings per minute. Watchlist symbols map to registry assets; unmapped coins persist only when pinned as hyperliquid:<COIN>.",
      partialResults: true,
    },
    async validate() {
      return { ok: true, message: "ok" };
    },
    async healthCheck() {
      try {
        assertSafeHttpUrl(HYPERLIQUID_INFO_URL);
        const response = await fetchImpl(HYPERLIQUID_INFO_URL, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "user-agent": HYPERLIQUID_USER_AGENT,
          },
          body: JSON.stringify({ type: "metaAndAssetCtxs" }),
          signal: AbortSignal.timeout(15_000),
          redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400) {
          return { ok: false, message: "Hyperliquid redirected; redirects are not followed." };
        }
        if (!response.ok) {
          return { ok: false, message: `Hyperliquid HTTP ${response.status}` };
        }
        await readBoundedJson(response, MAX_HYPERLIQUID_BODY_BYTES);
        return { ok: true, message: "Hyperliquid info endpoint answered." };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "Hyperliquid health check failed.",
        };
      }
    },
    async fetch() {
      return {
        evidence: [],
        partial: false,
        errors: [],
        unresponsiveEngines: [],
      };
    },
  };
}
