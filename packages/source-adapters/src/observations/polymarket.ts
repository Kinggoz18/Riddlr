import {
  DEFAULT_PREDICTION_INTERVAL_MS,
  isFiniteNumber,
  MAX_POLYMARKET_CALLS_PER_MINUTE,
  MAX_PREDICTION_BODY_BYTES,
  MAX_PREDICTION_MARKETS,
  MAX_PRICES_HISTORY_POINTS,
  OBSERVE_CLOCK_SKEW_MS,
  type PredictionAssetHint,
  predictionMarketCatalystKind,
  resolvePredictionSubject,
  type SeriesObservation,
  takeBounded,
} from "@riddlr/domain";
import {
  assertSafeHttpUrl,
  classifyHttpStatus,
  readBoundedJson,
  redactRequestUrl,
  type SourceAdapter,
} from "../types.js";
import type { ObservationProvider, ObserveQuery, ObserveResult } from "./types.js";

export const POLYMARKET_PROVIDER_ID = "polymarket";
export const POLYMARKET_FAMILY = "observation";
export const POLYMARKET_GAMMA_BASE = "https://gamma-api.polymarket.com";
export const POLYMARKET_CLOB_BASE = "https://clob.polymarket.com";
export const POLYMARKET_USER_AGENT = "Riddlr/0.1 (https://github.com/Kinggoz18/Riddlr)";

const METRICS = ["odds_yes", "odds_change_1h", "odds_change_24h", "odds_liquidity_usd"] as const;
const SLUG_RE = /^[A-Za-z0-9._-]{2,128}$/;
const SUGGEST_RE =
  /\b(fed|fomc|cpi|unemployment|inflation|powell|etf|interest[- ]rates?|rate (?:cut|hike|decision)|sec|cftc)\b/i;
const MIN_CALL_GAP_MS = Math.ceil(60_000 / MAX_POLYMARKET_CALLS_PER_MINUTE);

type SourceError = ObserveResult["errors"][number];

type HttpCall =
  | { ok: true; payload: unknown; status: number; requestUrl: string }
  | { ok: false; errors: SourceError[]; status?: number; requestUrl: string };

export type ParsedPolymarketMarket = {
  slug: string;
  question: string;
  closed: boolean;
  yesTokenId?: string;
  liquidityUsd?: number;
  categoryText: string;
  endDate?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function looksLikeHtml(payload: unknown, contentType: string | null): boolean {
  if (contentType?.toLowerCase().includes("text/html")) {
    return true;
  }
  return typeof payload === "string" && /<html|<!doctype html/i.test(payload);
}

function clampObservedAt(observedAt: Date, fetchedAt: Date): Date {
  const skew = observedAt.getTime() - fetchedAt.getTime();
  if (skew > OBSERVE_CLOCK_SKEW_MS) {
    return fetchedAt;
  }
  return observedAt;
}

function parseFinite(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function jsonField(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
    return value;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function stringList(value: unknown): string[] {
  const parsed = jsonField(value);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((item): item is string => typeof item === "string");
}

export function parseMarketSlugs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const slugs: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const slug = item.trim();
    if (!SLUG_RE.test(slug)) {
      continue;
    }
    slugs.push(slug);
  }
  return takeBounded([...new Set(slugs)], MAX_PREDICTION_MARKETS);
}

export function parseClosedFlag(row: Record<string, unknown>): boolean {
  if (row.closed === true) {
    return true;
  }
  if (row.active === false) {
    return true;
  }
  return false;
}

function tagText(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      const row = asRecord(item);
      if (typeof row?.label === "string") {
        return row.label;
      }
      return typeof row?.slug === "string" ? row.slug : "";
    })
    .join(" ");
}

function yesTokenId(row: Record<string, unknown>): string | undefined {
  const outcomes = stringList(row.outcomes);
  const tokens = stringList(row.clobTokenIds);
  if (tokens.length === 0) {
    return undefined;
  }
  const yesIndex = outcomes.findIndex((item) => item.trim().toLowerCase() === "yes");
  const token = tokens[yesIndex >= 0 ? yesIndex : 0];
  return token && token.length > 0 ? token : undefined;
}

export function parsePolymarketMarket(payload: unknown): {
  market?: ParsedPolymarketMarket;
  errors: SourceError[];
} {
  const row = asRecord(Array.isArray(payload) ? payload[0] : payload);
  if (!row) {
    return {
      errors: [{ class: "malformed", message: "Polymarket market body is not an object." }],
    };
  }
  const slug = typeof row.slug === "string" ? row.slug.trim() : "";
  if (!SLUG_RE.test(slug)) {
    return { errors: [{ class: "malformed", message: "Polymarket market is missing slug." }] };
  }
  const question = typeof row.question === "string" ? row.question : slug;
  const liquidityUsd =
    parseFinite(row.liquidityNum) ?? parseFinite(row.liquidity) ?? parseFinite(row.liquidityClob);
  const closed = parseClosedFlag(row);
  const token = yesTokenId(row);
  if (!closed && !token) {
    return {
      market: {
        slug,
        question,
        closed,
        liquidityUsd,
        categoryText: `${question} ${tagText(row.tags)}`,
        endDate: typeof row.endDate === "string" ? row.endDate : undefined,
      },
      errors: [
        { class: "malformed", message: `Polymarket market ${slug} is missing clobTokenIds.` },
      ],
    };
  }
  return {
    market: {
      slug,
      question,
      closed,
      yesTokenId: token,
      liquidityUsd,
      categoryText: `${question} ${tagText(row.tags)}`,
      endDate: typeof row.endDate === "string" ? row.endDate : undefined,
    },
    errors: [],
  };
}

export function parsePolymarketEvents(payload: unknown): {
  events: Array<Record<string, unknown>>;
  errors: SourceError[];
} {
  if (typeof payload === "string" && looksLikeHtml(payload, null)) {
    return {
      events: [],
      errors: [{ class: "unavailable", message: "Polymarket returned HTML instead of JSON." }],
    };
  }
  if (Array.isArray(payload)) {
    return {
      events: payload.filter((item): item is Record<string, unknown> => Boolean(asRecord(item))),
      errors: [],
    };
  }
  const wrapped = asRecord(payload);
  const events = wrapped?.events;
  if (Array.isArray(events)) {
    return {
      events: events.filter((item): item is Record<string, unknown> => Boolean(asRecord(item))),
      errors: [],
    };
  }
  return {
    events: [],
    errors: [{ class: "malformed", message: "Polymarket events body is not a list." }],
  };
}

export function suggestPolymarketSlugs(
  events: readonly Record<string, unknown>[],
  input: { watched: ReadonlySet<string>; hints: readonly PredictionAssetHint[] },
): string[] {
  const slugs: string[] = [];
  for (const event of events) {
    const markets = Array.isArray(event.markets) ? event.markets : [];
    const eventTitle = typeof event.title === "string" ? event.title : "";
    const tags = tagText(event.tags);
    for (const raw of markets) {
      const row = asRecord(typeof raw === "string" ? jsonField(raw) : raw);
      if (!row) {
        continue;
      }
      if (parseClosedFlag(row) || parseClosedFlag(event)) {
        continue;
      }
      const slug = typeof row.slug === "string" ? row.slug.trim() : "";
      if (!SLUG_RE.test(slug)) {
        continue;
      }
      const question = typeof row.question === "string" ? row.question : eventTitle;
      const hay = `${eventTitle} ${question} ${tags}`;
      const native = `${POLYMARKET_PROVIDER_ID}:${slug}`;
      const subject = resolvePredictionSubject({
        text: hay,
        nativeCanonicalId: native,
        watched: input.watched,
        hints: input.hints,
      });
      const suggested =
        SUGGEST_RE.test(hay) ||
        (subject !== native && input.watched.has(subject)) ||
        input.watched.has(native);
      if (!suggested) {
        continue;
      }
      slugs.push(slug);
    }
  }
  return takeBounded([...new Set(slugs)], MAX_PREDICTION_MARKETS);
}

export function parseMidpoint(payload: unknown): { value?: number; errors: SourceError[] } {
  const row = asRecord(payload);
  if (!row) {
    return { errors: [{ class: "malformed", message: "Polymarket midpoint is not an object." }] };
  }
  const value = parseFinite(row.mid) ?? parseFinite(row.mid_price) ?? parseFinite(row.midpoint);
  if (!isFiniteNumber(value) || value < 0 || value > 1) {
    return { errors: [{ class: "malformed", message: "Polymarket midpoint is missing mid." }] };
  }
  return { value, errors: [] };
}

export function parsePricesHistory(
  payload: unknown,
  fetchedAt: Date,
): { points: Array<{ observedAt: Date; value: number }>; errors: SourceError[] } {
  const row = asRecord(payload);
  const history = Array.isArray(row?.history) ? row.history : Array.isArray(payload) ? payload : [];
  if (!Array.isArray(history)) {
    return {
      points: [],
      errors: [{ class: "malformed", message: "Polymarket prices-history is missing history." }],
    };
  }
  const points: Array<{ observedAt: Date; value: number }> = [];
  for (const item of takeBounded(history, MAX_PRICES_HISTORY_POINTS)) {
    const point = asRecord(item);
    if (!point) {
      continue;
    }
    const t = parseFinite(point.t);
    const p = parseFinite(point.p);
    if (!isFiniteNumber(t) || !isFiniteNumber(p) || p < 0 || p > 1) {
      continue;
    }
    const ms = t > 10_000_000_000 ? t : t * 1000;
    points.push({ observedAt: clampObservedAt(new Date(ms), fetchedAt), value: p });
  }
  points.sort((left, right) => left.observedAt.getTime() - right.observedAt.getTime());
  return { points, errors: [] };
}

function changeAtHorizon(
  points: ReadonlyArray<{ observedAt: Date; value: number }>,
  last: { observedAt: Date; value: number },
  lookbackMs: number,
  maxGapMs: number,
): number | undefined {
  const target = last.observedAt.getTime() - lookbackMs;
  let prior: { observedAt: Date; value: number } | undefined;
  let best = Number.POSITIVE_INFINITY;
  for (const point of points) {
    if (point === last) {
      continue;
    }
    const delta = Math.abs(point.observedAt.getTime() - target);
    if (delta <= maxGapMs && delta < best) {
      best = delta;
      prior = point;
    }
  }
  if (!prior) {
    return undefined;
  }
  return (last.value - prior.value) * 100;
}

function parseAssetHints(value: unknown): PredictionAssetHint[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const hints: PredictionAssetHint[] = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row || typeof row.canonicalId !== "string") {
      continue;
    }
    hints.push({
      canonicalId: row.canonicalId,
      symbol: typeof row.symbol === "string" ? row.symbol : undefined,
      name: typeof row.name === "string" ? row.name : undefined,
    });
  }
  return takeBounded(hints, 64);
}

function nativeSlugs(subjects: readonly string[]): string[] {
  const slugs: string[] = [];
  for (const subject of subjects) {
    if (!subject.startsWith(`${POLYMARKET_PROVIDER_ID}:`)) {
      continue;
    }
    const slug = subject.slice(POLYMARKET_PROVIDER_ID.length + 1);
    if (SLUG_RE.test(slug)) {
      slugs.push(slug);
    }
  }
  return slugs;
}

export function createPolymarketProvider(
  options: { fetchImpl?: typeof fetch; intervalMs?: number; minIntervalMs?: number } = {},
): ObservationProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const minIntervalMs = options.minIntervalMs ?? MIN_CALL_GAP_MS;
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

  async function gammaGet(path: string, search: Record<string, string>): Promise<HttpCall> {
    const url = new URL(path, `${POLYMARKET_GAMMA_BASE}/`);
    for (const [key, value] of Object.entries(search)) {
      url.searchParams.set(key, value);
    }
    return httpGet(url);
  }

  async function clobGet(path: string, search: Record<string, string>): Promise<HttpCall> {
    const url = new URL(path, `${POLYMARKET_CLOB_BASE}/`);
    for (const [key, value] of Object.entries(search)) {
      url.searchParams.set(key, value);
    }
    return httpGet(url);
  }

  async function httpGet(url: URL): Promise<HttpCall> {
    return enqueue(async () => {
      const requestUrl = redactRequestUrl(url.toString());
      try {
        assertSafeHttpUrl(url.toString());
        const wait = Math.max(0, minIntervalMs - (Date.now() - lastCallAt));
        if (wait > 0) {
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
        lastCallAt = Date.now();
        const response = await fetchImpl(url, {
          headers: {
            accept: "application/json",
            "user-agent": POLYMARKET_USER_AGENT,
          },
          signal: AbortSignal.timeout(20_000),
          redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400) {
          return {
            ok: false,
            errors: [
              {
                class: "unavailable",
                message: "Polymarket redirected; redirects are not followed.",
              },
            ],
            status: response.status,
            requestUrl,
          };
        }
        if (!response.ok) {
          const retryAfter = response.headers.get("retry-after");
          const classified = classifyHttpStatus(response.status);
          const message =
            response.status === 429 && retryAfter
              ? `Polymarket HTTP 429; Retry-After ${retryAfter}`
              : `Polymarket HTTP ${response.status}`;
          return {
            ok: false,
            errors: [{ class: classified, message }],
            status: response.status,
            requestUrl,
          };
        }
        const contentType = response.headers.get("content-type");
        let payload: unknown;
        try {
          payload = await readBoundedJson(response, MAX_PREDICTION_BODY_BYTES);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Polymarket body too large.";
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
            errors: [
              { class: "unavailable", message: "Polymarket returned HTML instead of JSON." },
            ],
            status: response.status,
            requestUrl,
          };
        }
        return { ok: true, payload, status: response.status, requestUrl };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Polymarket request failed.";
        const timedOut = /timeout|aborted/i.test(message);
        return {
          ok: false,
          errors: [{ class: timedOut ? "timeout" : "unavailable", message }],
          requestUrl,
        };
      }
    });
  }

  return {
    id: POLYMARKET_PROVIDER_ID,
    metrics: METRICS,
    defaultIntervalMs: options.intervalMs ?? DEFAULT_PREDICTION_INTERVAL_MS,
    optIn: true,
    async observe(config, query: ObserveQuery): Promise<ObserveResult> {
      const fetchedAt = clampObservedAt(query.observedAt, new Date());
      const watched = new Set(query.subjectCanonicalIds);
      const hints = parseAssetHints(config.assetHints);
      const closedSlugs = new Set(parseMarketSlugs(config.closedSlugs));
      const backfilled = asRecord(config.backfilled) ?? {};
      const pinned = [
        ...parseMarketSlugs(config.marketSlugs),
        ...nativeSlugs(query.subjectCanonicalIds),
      ];
      const observations: SeriesObservation[] = [];
      const errors: SourceError[] = [];
      const persistClosed: string[] = [...closedSlugs];
      const marketCategory: Record<string, string> = {
        ...(asRecord(config.marketCategory) as Record<string, string> | undefined),
      };
      let lastUrl: string | undefined;
      let lastStatus: number | undefined;

      const keyset = await gammaGet("events/keyset", {
        active: "true",
        closed: "false",
        limit: "100",
      });
      lastUrl = keyset.requestUrl;
      lastStatus = keyset.status;
      let suggested: string[] = [];
      if (!keyset.ok) {
        errors.push(...keyset.errors);
      } else {
        const parsed = parsePolymarketEvents(keyset.payload);
        errors.push(...parsed.errors);
        suggested = suggestPolymarketSlugs(parsed.events, { watched, hints });
      }

      const slugs = takeBounded(
        [...new Set([...pinned, ...suggested])].filter((slug) => !closedSlugs.has(slug)),
        MAX_PREDICTION_MARKETS,
      );
      const nextBackfilled: Record<string, unknown> = { ...backfilled };

      for (const slug of slugs) {
        const marketCall = await gammaGet("markets", { slug });
        lastUrl = marketCall.requestUrl;
        lastStatus = marketCall.status ?? lastStatus;
        if (!marketCall.ok) {
          errors.push(...marketCall.errors);
          continue;
        }
        if (Array.isArray(marketCall.payload) && marketCall.payload.length === 0) {
          errors.push({
            class: "capability_missing",
            message: `Polymarket market ${slug} was not found.`,
          });
          continue;
        }
        const parsed = parsePolymarketMarket(marketCall.payload);
        errors.push(...parsed.errors);
        const market = parsed.market;
        if (!market) {
          continue;
        }
        if (market.closed) {
          persistClosed.push(slug);
          continue;
        }
        if (!market.yesTokenId) {
          continue;
        }
        const native = `${POLYMARKET_PROVIDER_ID}:${slug}`;
        const subject = resolvePredictionSubject({
          text: market.categoryText,
          nativeCanonicalId: native,
          watched,
          hints,
        });
        if (
          !watched.has(subject) &&
          !watched.has(native) &&
          !pinned.includes(slug) &&
          !suggested.includes(slug)
        ) {
          continue;
        }
        const catalyst = predictionMarketCatalystKind(market.categoryText);
        marketCategory[subject] = catalyst;
        const midCall = await clobGet("midpoint", { token_id: market.yesTokenId });
        lastUrl = midCall.requestUrl;
        lastStatus = midCall.status ?? lastStatus;
        if (!midCall.ok) {
          errors.push(...midCall.errors);
          continue;
        }
        const mid = parseMidpoint(midCall.payload);
        errors.push(...mid.errors);
        if (!isFiniteNumber(mid.value)) {
          continue;
        }
        const historyNeeded = backfilled[slug] !== true;
        let historyPoints: Array<{ observedAt: Date; value: number }> = [];
        if (historyNeeded) {
          const histCall = await clobGet("prices-history", {
            market: market.yesTokenId,
            interval: "1d",
            fidelity: "5",
          });
          lastUrl = histCall.requestUrl;
          lastStatus = histCall.status ?? lastStatus;
          if (!histCall.ok) {
            errors.push(...histCall.errors);
          } else {
            const hist = parsePricesHistory(histCall.payload, fetchedAt);
            errors.push(...hist.errors);
            historyPoints = hist.points;
            nextBackfilled[slug] = true;
          }
        }
        for (const point of historyPoints) {
          observations.push({
            provider: POLYMARKET_PROVIDER_ID,
            metric: "odds_yes",
            subjectCanonicalId: subject,
            value: point.value,
            unit: "probability",
            observedAt: point.observedAt,
          });
        }
        const observedAt = fetchedAt;
        observations.push({
          provider: POLYMARKET_PROVIDER_ID,
          metric: "odds_yes",
          subjectCanonicalId: subject,
          value: mid.value,
          unit: "probability",
          observedAt,
        });
        if (isFiniteNumber(market.liquidityUsd)) {
          observations.push({
            provider: POLYMARKET_PROVIDER_ID,
            metric: "odds_liquidity_usd",
            subjectCanonicalId: subject,
            value: market.liquidityUsd,
            unit: "usd",
            observedAt,
          });
        }
        const series = [...historyPoints, { observedAt, value: mid.value }];
        const last = series[series.length - 1];
        if (last) {
          const change1h = changeAtHorizon(series, last, 60 * 60 * 1000, 20 * 60 * 1000);
          const change24h = changeAtHorizon(series, last, 24 * 60 * 60 * 1000, 2 * 60 * 60 * 1000);
          if (isFiniteNumber(change1h)) {
            observations.push({
              provider: POLYMARKET_PROVIDER_ID,
              metric: "odds_change_1h",
              subjectCanonicalId: subject,
              value: change1h,
              unit: "percent",
              observedAt,
            });
          }
          if (isFiniteNumber(change24h)) {
            observations.push({
              provider: POLYMARKET_PROVIDER_ID,
              metric: "odds_change_24h",
              subjectCanonicalId: subject,
              value: change24h,
              unit: "percent",
              observedAt,
            });
          }
        }
      }

      return {
        observations: takeBounded(observations, MAX_PREDICTION_MARKETS * 8),
        partial: errors.length > 0,
        errors,
        requestUrl: lastUrl,
        responseStatus: lastStatus,
        persistConfig: {
          closedSlugs: takeBounded([...new Set(persistClosed)], MAX_PREDICTION_MARKETS),
          backfilled: nextBackfilled,
          marketCategory,
        },
      };
    },
  };
}

export function createPolymarketAdapter(fetchImpl: typeof fetch = fetch): SourceAdapter {
  return {
    id: POLYMARKET_PROVIDER_ID,
    family: POLYMARKET_FAMILY,
    capabilities: {
      modes: ["poll"],
      supportsTimeRange: false,
      supportsPagination: true,
      supportsDomainFilter: false,
      lookbackNotes:
        "Opt-in. Free Gamma and CLOB reads, no API key. Pin market slugs. One events/keyset page suggests watched-asset and macro markets. Midpoint every 15 minutes; prices-history backfill once per slug (interval=1d fidelity=5, ~24h of 5-minute points). Cap 50 markets, 60 calls/min.",
      partialResults: true,
    },
    async validate(config) {
      parseMarketSlugs(config.marketSlugs);
      return { ok: true, message: "ok" };
    },
    async healthCheck() {
      try {
        assertSafeHttpUrl(`${POLYMARKET_GAMMA_BASE}/events/keyset`);
        const response = await fetchImpl(`${POLYMARKET_GAMMA_BASE}/events/keyset?limit=1`, {
          headers: {
            accept: "application/json",
            "user-agent": POLYMARKET_USER_AGENT,
          },
          signal: AbortSignal.timeout(15_000),
          redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400) {
          return { ok: false, message: "Polymarket redirected; redirects are not followed." };
        }
        if (!response.ok) {
          return { ok: false, message: `Polymarket HTTP ${response.status}` };
        }
        await readBoundedJson(response, MAX_PREDICTION_BODY_BYTES);
        return { ok: true, message: "Polymarket Gamma answered." };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "Polymarket health check failed.",
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
