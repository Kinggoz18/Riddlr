import {
  DEFAULT_PREDICTION_INTERVAL_MS,
  isFiniteNumber,
  MAX_KALSHI_CALLS_PER_MINUTE,
  MAX_KALSHI_MARKET_PAGES,
  MAX_PREDICTION_BODY_BYTES,
  MAX_PREDICTION_MARKETS,
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

export const KALSHI_PROVIDER_ID = "kalshi";
export const KALSHI_FAMILY = "observation";
export const KALSHI_API_BASE = "https://external-api.kalshi.com/trade-api/v2";
export const KALSHI_USER_AGENT = "Riddlr/0.1 (https://github.com/Kinggoz18/Riddlr)";

const METRICS = [
  "odds_yes",
  "odds_change_1h",
  "odds_change_24h",
  "odds_liquidity_usd",
  "volume",
] as const;
const SERIES_RE = /^[A-Za-z0-9]{2,32}$/;
const TICKER_RE = /^[A-Za-z0-9._-]{2,128}$/;
const MIN_CALL_GAP_MS = Math.ceil(60_000 / MAX_KALSHI_CALLS_PER_MINUTE);

type SourceError = ObserveResult["errors"][number];

type HttpCall =
  | { ok: true; payload: unknown; status: number; requestUrl: string }
  | { ok: false; errors: SourceError[]; status?: number; requestUrl: string };

export type ParsedKalshiMarket = {
  ticker: string;
  title: string;
  eventTicker?: string;
  status: string;
  oddsYes?: number;
  volume?: number;
  liquidityUsd?: number;
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

export function parseSeriesTickers(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const tickers: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const ticker = item.trim().toUpperCase();
    if (!SERIES_RE.test(ticker)) {
      continue;
    }
    tickers.push(ticker);
  }
  return takeBounded([...new Set(tickers)], MAX_PREDICTION_MARKETS);
}

export function parseMarketTickers(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const tickers: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const ticker = item.trim().toUpperCase();
    if (!TICKER_RE.test(ticker) || SERIES_RE.test(ticker)) {
      continue;
    }
    tickers.push(ticker);
  }
  return takeBounded([...new Set(tickers)], MAX_PREDICTION_MARKETS);
}

export function kalshiMarketOpen(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === "open" || normalized === "active";
}

export function parseKalshiSeries(payload: unknown): {
  ticker?: string;
  title?: string;
  category?: string;
  errors: SourceError[];
} {
  const wrapped = asRecord(payload);
  const row = asRecord(wrapped?.series) ?? wrapped;
  if (!row) {
    return { errors: [{ class: "malformed", message: "Kalshi series body is not an object." }] };
  }
  const ticker = typeof row.ticker === "string" ? row.ticker.trim().toUpperCase() : "";
  if (!SERIES_RE.test(ticker)) {
    return { errors: [{ class: "malformed", message: "Kalshi series is missing ticker." }] };
  }
  return {
    ticker,
    title: typeof row.title === "string" ? row.title : ticker,
    category: typeof row.category === "string" ? row.category : undefined,
    errors: [],
  };
}

function bestLevel(levels: unknown): number | undefined {
  if (!Array.isArray(levels) || levels.length === 0) {
    return undefined;
  }
  const last = levels[levels.length - 1];
  if (Array.isArray(last)) {
    return parseFinite(last[0]);
  }
  return undefined;
}

export function parseKalshiOrderbook(payload: unknown): {
  oddsYes?: number;
  errors: SourceError[];
} {
  const row = asRecord(payload);
  const book = asRecord(row?.orderbook_fp) ?? asRecord(row?.orderbook);
  if (!book) {
    return {
      errors: [{ class: "malformed", message: "Kalshi orderbook is missing orderbook_fp." }],
    };
  }
  const yesBid = bestLevel(book.yes_dollars);
  const noBid = bestLevel(book.no_dollars);
  const yesAsk = isFiniteNumber(noBid) ? 1 - noBid : undefined;
  if (!isFiniteNumber(yesBid) || !isFiniteNumber(yesAsk)) {
    return { errors: [{ class: "malformed", message: "Kalshi orderbook has no yes bid/ask." }] };
  }
  const mid = (yesBid + yesAsk) / 2;
  if (mid < 0 || mid > 1) {
    return { errors: [{ class: "malformed", message: "Kalshi orderbook mid is out of range." }] };
  }
  return { oddsYes: mid, errors: [] };
}

export function parseKalshiMarket(payload: unknown): {
  market?: ParsedKalshiMarket;
  errors: SourceError[];
} {
  const row = asRecord(payload);
  if (!row) {
    return { errors: [{ class: "malformed", message: "Kalshi market is not an object." }] };
  }
  const ticker = typeof row.ticker === "string" ? row.ticker.trim().toUpperCase() : "";
  if (!TICKER_RE.test(ticker)) {
    return { errors: [{ class: "malformed", message: "Kalshi market is missing ticker." }] };
  }
  const status = typeof row.status === "string" ? row.status : "";
  const bid = parseFinite(row.yes_bid_dollars);
  const ask = parseFinite(row.yes_ask_dollars);
  let oddsYes: number | undefined;
  if (isFiniteNumber(bid) && isFiniteNumber(ask)) {
    oddsYes = (bid + ask) / 2;
  } else if (isFiniteNumber(parseFinite(row.last_price_dollars))) {
    oddsYes = parseFinite(row.last_price_dollars);
  }
  if (isFiniteNumber(oddsYes) && (oddsYes < 0 || oddsYes > 1)) {
    oddsYes = undefined;
  }
  const missingBid = !isFiniteNumber(bid) && !isFiniteNumber(ask) && !isFiniteNumber(oddsYes);
  return {
    market: {
      ticker,
      title: typeof row.title === "string" ? row.title : ticker,
      eventTicker: typeof row.event_ticker === "string" ? row.event_ticker : undefined,
      status,
      oddsYes,
      volume: parseFinite(row.volume_fp) ?? parseFinite(row.volume),
      liquidityUsd: parseFinite(row.liquidity_dollars),
    },
    errors: missingBid
      ? [{ class: "malformed", message: `Kalshi market ${ticker} is missing yes bid/ask.` }]
      : [],
  };
}

export function parseKalshiMarketsPage(payload: unknown): {
  markets: ParsedKalshiMarket[];
  cursor?: string;
  errors: SourceError[];
} {
  if (typeof payload === "string" && looksLikeHtml(payload, null)) {
    return {
      markets: [],
      errors: [{ class: "unavailable", message: "Kalshi returned HTML instead of JSON." }],
    };
  }
  const wrapped = asRecord(payload);
  const rows = Array.isArray(wrapped?.markets)
    ? wrapped.markets
    : Array.isArray(payload)
      ? payload
      : undefined;
  if (!rows) {
    return {
      markets: [],
      errors: [{ class: "malformed", message: "Kalshi markets body is missing markets." }],
    };
  }
  const markets: ParsedKalshiMarket[] = [];
  const errors: SourceError[] = [];
  for (const item of takeBounded(rows, 100)) {
    const parsed = parseKalshiMarket(item);
    errors.push(...parsed.errors);
    if (parsed.market) {
      markets.push(parsed.market);
    }
  }
  const cursor = typeof wrapped?.cursor === "string" ? wrapped.cursor : undefined;
  return { markets, cursor, errors };
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

function nativeTickers(subjects: readonly string[]): { series: string[]; markets: string[] } {
  const series: string[] = [];
  const markets: string[] = [];
  for (const subject of subjects) {
    if (!subject.startsWith(`${KALSHI_PROVIDER_ID}:`)) {
      continue;
    }
    const ticker = subject.slice(KALSHI_PROVIDER_ID.length + 1).toUpperCase();
    if (SERIES_RE.test(ticker)) {
      series.push(ticker);
    } else if (TICKER_RE.test(ticker)) {
      markets.push(ticker);
      const prefix = ticker.split("-")[0];
      if (prefix && SERIES_RE.test(prefix)) {
        series.push(prefix);
      }
    }
  }
  return { series, markets };
}

export function createKalshiProvider(
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

  async function kalshiGet(path: string, search: Record<string, string> = {}): Promise<HttpCall> {
    return enqueue(async () => {
      const url = new URL(`${KALSHI_API_BASE}${path}`);
      for (const [key, value] of Object.entries(search)) {
        url.searchParams.set(key, value);
      }
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
            "user-agent": KALSHI_USER_AGENT,
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
                message: "Kalshi redirected; redirects are not followed.",
              },
            ],
            status: response.status,
            requestUrl,
          };
        }
        if (!response.ok) {
          const retryAfter = response.headers.get("retry-after");
          const classified =
            response.status === 404 ? "capability_missing" : classifyHttpStatus(response.status);
          const message =
            response.status === 429 && retryAfter
              ? `Kalshi HTTP 429; Retry-After ${retryAfter}`
              : `Kalshi HTTP ${response.status}`;
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
          const message = error instanceof Error ? error.message : "Kalshi body too large.";
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
            errors: [{ class: "unavailable", message: "Kalshi returned HTML instead of JSON." }],
            status: response.status,
            requestUrl,
          };
        }
        return { ok: true, payload, status: response.status, requestUrl };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Kalshi request failed.";
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
    id: KALSHI_PROVIDER_ID,
    metrics: METRICS,
    defaultIntervalMs: options.intervalMs ?? DEFAULT_PREDICTION_INTERVAL_MS,
    optIn: true,
    async observe(config, query: ObserveQuery): Promise<ObserveResult> {
      const fetchedAt = clampObservedAt(query.observedAt, new Date());
      const watched = new Set(query.subjectCanonicalIds);
      const hints = parseAssetHints(config.assetHints);
      const native = nativeTickers(query.subjectCanonicalIds);
      const seriesTickers = [...parseSeriesTickers(config.seriesTickers), ...native.series];
      const pinnedMarkets = new Set([
        ...parseMarketTickers(config.marketTickers),
        ...native.markets,
      ]);
      const observations: SeriesObservation[] = [];
      const errors: SourceError[] = [];
      const persistClosed: string[] = parseMarketTickers(config.closedTickers);
      const marketCategory: Record<string, string> = {
        ...(asRecord(config.marketCategory) as Record<string, string> | undefined),
      };
      let lastUrl: string | undefined;
      let lastStatus: number | undefined;
      const selected: ParsedKalshiMarket[] = [];
      const seriesTitles: Record<string, string> = {};

      for (const seriesTicker of takeBounded([...new Set(seriesTickers)], MAX_PREDICTION_MARKETS)) {
        const seriesCall = await kalshiGet(`/series/${seriesTicker}`);
        lastUrl = seriesCall.requestUrl;
        lastStatus = seriesCall.status;
        if (!seriesCall.ok) {
          errors.push(...seriesCall.errors);
          continue;
        }
        const series = parseKalshiSeries(seriesCall.payload);
        errors.push(...series.errors);
        if (series.ticker) {
          seriesTitles[series.ticker] = `${series.title ?? ""} ${series.category ?? ""}`;
        }
        let cursor: string | undefined;
        for (let page = 0; page < MAX_KALSHI_MARKET_PAGES; page += 1) {
          const search: Record<string, string> = {
            series_ticker: seriesTicker,
            status: "open",
            limit: "100",
          };
          if (cursor) {
            search.cursor = cursor;
          }
          const pageCall = await kalshiGet("/markets", search);
          lastUrl = pageCall.requestUrl;
          lastStatus = pageCall.status ?? lastStatus;
          if (!pageCall.ok) {
            errors.push(...pageCall.errors);
            break;
          }
          const parsed = parseKalshiMarketsPage(pageCall.payload);
          errors.push(...parsed.errors);
          selected.push(...parsed.markets);
          if (!parsed.cursor || parsed.markets.length === 0) {
            break;
          }
          cursor = parsed.cursor;
        }
      }

      const bounded = takeBounded(
        selected.filter((item) => {
          if (pinnedMarkets.size === 0) {
            return true;
          }
          return pinnedMarkets.has(item.ticker) || SERIES_RE.test(item.ticker);
        }),
        MAX_PREDICTION_MARKETS,
      );
      const toFetch =
        pinnedMarkets.size > 0
          ? bounded.filter(
              (item) =>
                pinnedMarkets.has(item.ticker) ||
                parseSeriesTickers(config.seriesTickers).length > 0,
            )
          : bounded;

      for (const market of takeBounded(toFetch, MAX_PREDICTION_MARKETS)) {
        if (!kalshiMarketOpen(market.status)) {
          persistClosed.push(market.ticker);
          continue;
        }
        let oddsYes = market.oddsYes;
        if (!isFiniteNumber(oddsYes)) {
          const bookCall = await kalshiGet(`/markets/${market.ticker}/orderbook`, { depth: "5" });
          lastUrl = bookCall.requestUrl;
          lastStatus = bookCall.status ?? lastStatus;
          if (!bookCall.ok) {
            errors.push(...bookCall.errors);
            continue;
          }
          const book = parseKalshiOrderbook(bookCall.payload);
          errors.push(...book.errors);
          oddsYes = book.oddsYes;
        }
        if (!isFiniteNumber(oddsYes)) {
          continue;
        }
        const prefix = market.ticker.split("-")[0] ?? "";
        const hay = `${market.title} ${seriesTitles[prefix] ?? ""}`;
        const nativeId = `${KALSHI_PROVIDER_ID}:${market.ticker}`;
        const subject = resolvePredictionSubject({
          text: hay,
          nativeCanonicalId: nativeId,
          watched,
          hints,
        });
        marketCategory[subject] = predictionMarketCatalystKind(hay);
        observations.push({
          provider: KALSHI_PROVIDER_ID,
          metric: "odds_yes",
          subjectCanonicalId: subject,
          value: oddsYes,
          unit: "probability",
          observedAt: fetchedAt,
        });
        if (isFiniteNumber(market.liquidityUsd)) {
          observations.push({
            provider: KALSHI_PROVIDER_ID,
            metric: "odds_liquidity_usd",
            subjectCanonicalId: subject,
            value: market.liquidityUsd,
            unit: "usd",
            observedAt: fetchedAt,
          });
        }
        if (isFiniteNumber(market.volume)) {
          observations.push({
            provider: KALSHI_PROVIDER_ID,
            metric: "volume",
            subjectCanonicalId: subject,
            value: market.volume,
            unit: "contracts",
            observedAt: fetchedAt,
          });
        }
      }

      return {
        observations: takeBounded(observations, MAX_PREDICTION_MARKETS * 6),
        partial: errors.length > 0,
        errors,
        requestUrl: lastUrl,
        responseStatus: lastStatus,
        persistConfig: {
          closedTickers: takeBounded([...new Set(persistClosed)], MAX_PREDICTION_MARKETS),
          marketCategory,
        },
      };
    },
  };
}

export function createKalshiAdapter(fetchImpl: typeof fetch = fetch): SourceAdapter {
  return {
    id: KALSHI_PROVIDER_ID,
    family: KALSHI_FAMILY,
    capabilities: {
      modes: ["poll"],
      supportsTimeRange: false,
      supportsPagination: true,
      supportsDomainFilter: false,
      lookbackNotes:
        "Opt-in. Public Trade API v2, no key. Pin series tickers such as KXCPI. Markets filtered status=open; listed objects use status=active. Cap 50 markets, 5 market pages, 30 calls/min. Orderbook is used only when yes bid/ask are missing.",
      partialResults: true,
    },
    async validate(config) {
      parseSeriesTickers(config.seriesTickers);
      parseMarketTickers(config.marketTickers);
      return { ok: true, message: "ok" };
    },
    async healthCheck() {
      try {
        assertSafeHttpUrl(`${KALSHI_API_BASE}/series/KXCPI`);
        const response = await fetchImpl(`${KALSHI_API_BASE}/series/KXCPI`, {
          headers: {
            accept: "application/json",
            "user-agent": KALSHI_USER_AGENT,
          },
          signal: AbortSignal.timeout(15_000),
          redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400) {
          return { ok: false, message: "Kalshi redirected; redirects are not followed." };
        }
        if (!response.ok) {
          return { ok: false, message: `Kalshi HTTP ${response.status}` };
        }
        await readBoundedJson(response, MAX_PREDICTION_BODY_BYTES);
        return { ok: true, message: "Kalshi Trade API answered." };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "Kalshi health check failed.",
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
