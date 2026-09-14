import {
  annualizeFundingAprPercent,
  BINANCE_FUNDING_PERIOD_HOURS,
  BINANCE_OI_INTERVAL_MS,
  BINANCE_USED_WEIGHT_SOFT_LIMIT,
  DEFAULT_FUTURES_INTERVAL_MS,
  decimalRateToPercent,
  hourBucketUtc,
  MAX_BINANCE_BODY_BYTES,
  MAX_BINANCE_OI_SYMBOLS,
  MAX_BINANCE_PREMIUM_ROWS,
  OBSERVE_CLOCK_SKEW_MS,
  type SeriesObservation,
  takeBounded,
} from "@riddlr/domain";
import {
  assertSafeHttpUrl,
  classifyHttpStatus,
  readBoundedJson,
  type SourceAdapter,
  type SourceErrorClass,
} from "../types.js";
import {
  BINANCE_FUTURES_PROVIDER_ID,
  sharedBinanceForceOrderAggregator,
} from "./binance-liquidations.js";
import type { ObservationProvider, ObserveQuery, ObserveResult } from "./types.js";

export { BINANCE_FUTURES_PROVIDER_ID } from "./binance-liquidations.js";

export const BINANCE_FUTURES_FAMILY = "observation";
export const BINANCE_FUTURES_API_BASE = "https://fapi.binance.com";
export const BINANCE_FUTURES_USER_AGENT = "Riddlr/0.1 (https://github.com/Kinggoz18/Riddlr)";
export const BINANCE_QUOTE_ASSETS = ["USDT", "USDC", "BUSD"] as const;

const METRICS = [
  "funding_rate_8h",
  "funding_rate_apr",
  "mark_price",
  "open_interest",
  "open_interest_usd",
  "long_short_ratio",
  "liquidations_1m_usd",
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

function classifyBinanceStatus(status: number): SourceErrorClass {
  if (status === 451) {
    return "blocked";
  }
  if (status === 418 || status === 429) {
    return "rate_limited";
  }
  return classifyHttpStatus(status);
}

export function parseQuoteAssets(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [...BINANCE_QUOTE_ASSETS];
  const quotes: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const quote = item.trim().toUpperCase();
    if (/^[A-Z0-9]{3,8}$/.test(quote)) {
      quotes.push(quote);
    }
  }
  const unique = [...new Set(quotes.length > 0 ? quotes : [...BINANCE_QUOTE_ASSETS])];
  return unique.sort((left, right) => right.length - left.length);
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

export function baseFromBinanceSymbol(
  symbol: string,
  quotes: readonly string[],
): string | undefined {
  const upper = symbol.trim().toUpperCase();
  for (const quote of quotes) {
    if (upper.endsWith(quote) && upper.length > quote.length) {
      return upper.slice(0, -quote.length);
    }
  }
  return undefined;
}

export function resolveBinanceSubject(
  symbol: string,
  symbolMap: Record<string, string>,
  watched: ReadonlySet<string>,
  quotes: readonly string[],
): string | undefined {
  const native = `${BINANCE_FUTURES_PROVIDER_ID}:${symbol.toUpperCase()}`;
  if (watched.has(native)) {
    return native;
  }
  const base = baseFromBinanceSymbol(symbol, quotes);
  if (!base) {
    return undefined;
  }
  const mapped = symbolMap[base];
  if (mapped && watched.has(mapped)) {
    return mapped;
  }
  return undefined;
}

function binanceErrorClass(payload: unknown): SourceErrorClass | undefined {
  const row = asRecord(payload);
  const code = parseDecimal(row?.code);
  if (code === -1121) {
    return "capability_missing";
  }
  return undefined;
}

export function parsePremiumIndex(
  payload: unknown,
  input: {
    symbolMap: Record<string, string>;
    watched: ReadonlySet<string>;
    quotes: readonly string[];
    fetchedAt: Date;
  },
): { observations: SeriesObservation[]; errors: SourceError[]; symbols: string[] } {
  if (typeof payload === "string" && looksLikeHtml(payload, null)) {
    return {
      observations: [],
      errors: [{ class: "unavailable", message: "Binance returned HTML instead of JSON." }],
      symbols: [],
    };
  }
  const rows = Array.isArray(payload) ? payload : payload ? [payload] : [];
  if (!Array.isArray(payload) && !asRecord(payload)) {
    return {
      observations: [],
      errors: [{ class: "malformed", message: "Binance premiumIndex is not an array." }],
      symbols: [],
    };
  }
  if (rows.length === 0) {
    return { observations: [], errors: [], symbols: [] };
  }
  const observations: SeriesObservation[] = [];
  const errors: SourceError[] = [];
  const symbols: string[] = [];
  const fundingAt = hourBucketUtc(input.fetchedAt);
  for (const item of takeBounded(rows, MAX_BINANCE_PREMIUM_ROWS)) {
    const row = asRecord(item);
    const symbol = typeof row?.symbol === "string" ? row.symbol.trim().toUpperCase() : "";
    if (!row || !symbol) {
      continue;
    }
    const subject = resolveBinanceSubject(symbol, input.symbolMap, input.watched, input.quotes);
    if (!subject) {
      continue;
    }
    const mark = parseDecimal(row.markPrice);
    const rate = parseDecimal(row.lastFundingRate);
    const providerTime = parseDecimal(row.time);
    const observedAt =
      providerTime !== undefined
        ? clampObservedAt(new Date(providerTime), input.fetchedAt)
        : input.fetchedAt;
    if (mark === undefined) {
      errors.push({
        class: "malformed",
        message: `Binance premiumIndex missing markPrice for ${symbol}.`,
      });
      continue;
    }
    symbols.push(symbol);
    observations.push({
      provider: BINANCE_FUTURES_PROVIDER_ID,
      metric: "mark_price",
      subjectCanonicalId: subject,
      value: mark,
      unit: "usd",
      observedAt,
      providerLastUpdatedAt: observedAt,
    });
    if (rate !== undefined) {
      observations.push({
        provider: BINANCE_FUTURES_PROVIDER_ID,
        metric: "funding_rate_8h",
        subjectCanonicalId: subject,
        value: decimalRateToPercent(rate),
        unit: "percent",
        observedAt: fundingAt,
      });
      observations.push({
        provider: BINANCE_FUTURES_PROVIDER_ID,
        metric: "funding_rate_apr",
        subjectCanonicalId: subject,
        value: annualizeFundingAprPercent(rate, BINANCE_FUNDING_PERIOD_HOURS),
        unit: "percent",
        observedAt: fundingAt,
      });
    }
  }
  return { observations, errors, symbols };
}

export function parseOpenInterest(
  payload: unknown,
  input: {
    symbol: string;
    subjectCanonicalId: string;
    markPrice?: number;
    fetchedAt: Date;
  },
): { observations: SeriesObservation[]; errors: SourceError[] } {
  const classified = binanceErrorClass(payload);
  if (classified) {
    return {
      observations: [],
      errors: [
        {
          class: classified,
          message: `Binance unknown symbol ${input.symbol}.`,
        },
      ],
    };
  }
  const row = asRecord(payload);
  if (!row) {
    return {
      observations: [],
      errors: [
        {
          class: "malformed",
          message: `Binance openInterest for ${input.symbol} is not an object.`,
        },
      ],
    };
  }
  const openInterest = parseDecimal(row.openInterest);
  if (openInterest === undefined) {
    return {
      observations: [],
      errors: [
        {
          class: "malformed",
          message: `Binance openInterest missing openInterest for ${input.symbol}.`,
        },
      ],
    };
  }
  const providerTime = parseDecimal(row.time);
  const observedAt =
    providerTime !== undefined
      ? clampObservedAt(new Date(providerTime), input.fetchedAt)
      : input.fetchedAt;
  const observations: SeriesObservation[] = [
    {
      provider: BINANCE_FUTURES_PROVIDER_ID,
      metric: "open_interest",
      subjectCanonicalId: input.subjectCanonicalId,
      value: openInterest,
      unit: "contracts",
      observedAt,
      providerLastUpdatedAt: observedAt,
    },
  ];
  if (input.markPrice !== undefined) {
    observations.push({
      provider: BINANCE_FUTURES_PROVIDER_ID,
      metric: "open_interest_usd",
      subjectCanonicalId: input.subjectCanonicalId,
      value: openInterest * input.markPrice,
      unit: "usd",
      observedAt,
    });
  }
  return { observations, errors: [] };
}

export function parseOpenInterestHist(
  payload: unknown,
  input: { subjectCanonicalId: string; fetchedAt: Date },
): { observations: SeriesObservation[]; errors: SourceError[] } {
  if (!Array.isArray(payload) || payload.length === 0) {
    return { observations: [], errors: [] };
  }
  const row = asRecord(payload[0]);
  const usd = parseDecimal(row?.sumOpenInterestValue);
  const contracts = parseDecimal(row?.sumOpenInterest);
  if (usd === undefined && contracts === undefined) {
    return {
      observations: [],
      errors: [
        { class: "malformed", message: "Binance openInterestHist missing sumOpenInterestValue." },
      ],
    };
  }
  const timestamp = parseDecimal(row?.timestamp);
  const observedAt =
    timestamp !== undefined
      ? clampObservedAt(new Date(timestamp), input.fetchedAt)
      : input.fetchedAt;
  const observations: SeriesObservation[] = [];
  if (contracts !== undefined) {
    observations.push({
      provider: BINANCE_FUTURES_PROVIDER_ID,
      metric: "open_interest",
      subjectCanonicalId: input.subjectCanonicalId,
      value: contracts,
      unit: "contracts",
      observedAt,
    });
  }
  if (usd !== undefined) {
    observations.push({
      provider: BINANCE_FUTURES_PROVIDER_ID,
      metric: "open_interest_usd",
      subjectCanonicalId: input.subjectCanonicalId,
      value: usd,
      unit: "usd",
      observedAt,
    });
  }
  return { observations, errors: [] };
}

export function parseLongShortRatio(
  payload: unknown,
  input: { subjectCanonicalId: string; fetchedAt: Date },
): { observations: SeriesObservation[]; errors: SourceError[] } {
  if (!Array.isArray(payload) || payload.length === 0) {
    return { observations: [], errors: [] };
  }
  const row = asRecord(payload[0]);
  const ratio = parseDecimal(row?.longShortRatio);
  if (ratio === undefined) {
    return {
      observations: [],
      errors: [{ class: "malformed", message: "Binance longShortRatio missing longShortRatio." }],
    };
  }
  const timestamp = parseDecimal(row?.timestamp);
  const observedAt =
    timestamp !== undefined
      ? clampObservedAt(new Date(timestamp), input.fetchedAt)
      : input.fetchedAt;
  return {
    observations: [
      {
        provider: BINANCE_FUTURES_PROVIDER_ID,
        metric: "long_short_ratio",
        subjectCanonicalId: input.subjectCanonicalId,
        value: ratio,
        unit: "ratio",
        observedAt,
      },
    ],
    errors: [],
  };
}

type CallResult =
  | { ok: true; payload: unknown; status: number; requestUrl: string; usedWeight?: number }
  | {
      ok: false;
      errors: SourceError[];
      status?: number;
      requestUrl: string;
      retryAfterMs?: number;
    };

export function createBinanceFuturesProvider(
  options: {
    fetchImpl?: typeof fetch;
    intervalMs?: number;
    minIntervalMs?: number;
    drainLiquidations?: (input: {
      now: Date;
      resolveSubject: (symbol: string) => string | undefined;
    }) => SeriesObservation[];
  } = {},
): ObservationProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const minIntervalMs = options.minIntervalMs ?? 50;
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

  async function getJson(path: string): Promise<CallResult> {
    const requestUrl = `${BINANCE_FUTURES_API_BASE}${path}`;
    try {
      assertSafeHttpUrl(requestUrl);
    } catch {
      return {
        ok: false,
        errors: [{ class: "blocked", message: "Binance URL failed SSRF checks." }],
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
        headers: {
          accept: "application/json",
          "user-agent": BINANCE_FUTURES_USER_AGENT,
        },
        signal: AbortSignal.timeout(20_000),
        redirect: "manual",
      });
      const usedWeight = Number(response.headers.get("x-mbx-used-weight-1m") ?? "");
      const retryAfter = Number(response.headers.get("retry-after") ?? "");
      if (response.status >= 300 && response.status < 400) {
        return {
          ok: false,
          errors: [
            {
              class: "unavailable",
              message: "Binance redirected; redirects are not followed.",
            },
          ],
          status: response.status,
          requestUrl,
        };
      }
      if (response.status === 451) {
        return {
          ok: false,
          errors: [
            {
              class: "blocked",
              message:
                "Binance USD-M Futures is unavailable from this region (HTTP 451). Disable the source if the venue is blocked.",
            },
          ],
          status: 451,
          requestUrl,
        };
      }
      if (!response.ok) {
        let payload: unknown;
        try {
          payload = await readBoundedJson(response, MAX_BINANCE_BODY_BYTES);
        } catch {
          payload = undefined;
        }
        const unknown = binanceErrorClass(payload);
        if (unknown) {
          return {
            ok: false,
            errors: [
              {
                class: unknown,
                message: `Binance ${asRecord(payload)?.msg ?? "unknown symbol"}`,
              },
            ],
            status: response.status,
            requestUrl,
          };
        }
        const classified = classifyBinanceStatus(response.status);
        return {
          ok: false,
          errors: [{ class: classified, message: `Binance HTTP ${response.status}` }],
          status: response.status,
          requestUrl,
          retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined,
        };
      }
      const contentType = response.headers.get("content-type");
      let payload: unknown;
      try {
        payload = await readBoundedJson(response, MAX_BINANCE_BODY_BYTES);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Binance body too large.";
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
          errors: [{ class: "unavailable", message: "Binance returned HTML instead of JSON." }],
          status: response.status,
          requestUrl,
        };
      }
      return {
        ok: true,
        payload,
        status: response.status,
        requestUrl,
        usedWeight: Number.isFinite(usedWeight) ? usedWeight : undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Binance request failed.";
      const timedOut = /timeout|aborted/i.test(message);
      const dns = /enotfound|getaddrinfo|nodename nor servname/i.test(message);
      return {
        ok: false,
        errors: [
          {
            class: timedOut ? "timeout" : dns ? "unavailable" : "unavailable",
            message: dns
              ? "Binance USD-M Futures is unreachable from this host (DNS or network). Disable the source if the venue is blocked in your region."
              : message,
          },
        ],
        requestUrl,
      };
    }
  }

  return {
    id: BINANCE_FUTURES_PROVIDER_ID,
    metrics: METRICS,
    defaultIntervalMs: options.intervalMs ?? DEFAULT_FUTURES_INTERVAL_MS,
    optIn: true,
    async observe(config, query: ObserveQuery): Promise<ObserveResult> {
      const fetchedAt = clampObservedAt(query.observedAt, new Date());
      const symbolMap = parseSymbolMap(config.symbolMap);
      const quotes = parseQuoteAssets(config.quoteAssets);
      const watched = new Set(query.subjectCanonicalIds);
      const rateLimitedUntil =
        typeof config.rateLimitedUntil === "string"
          ? Date.parse(config.rateLimitedUntil)
          : Number.NaN;
      if (Number.isFinite(rateLimitedUntil) && rateLimitedUntil > fetchedAt.getTime()) {
        return {
          observations: [],
          partial: true,
          errors: [{ class: "rate_limited", message: "Binance Retry-After has not elapsed." }],
        };
      }
      const observations: SeriesObservation[] = [];
      const errors: SourceError[] = [];
      let lastUrl: string | undefined;
      let lastStatus: number | undefined;
      const persistConfig: Record<string, unknown> = {};
      const premium = await enqueue(() => getJson("/fapi/v1/premiumIndex"));
      lastUrl = premium.requestUrl;
      lastStatus = premium.status;
      if (!premium.ok) {
        errors.push(...premium.errors);
        if (premium.retryAfterMs) {
          persistConfig.rateLimitedUntil = new Date(
            fetchedAt.getTime() + premium.retryAfterMs,
          ).toISOString();
        }
        return {
          observations: [],
          partial: true,
          errors,
          requestUrl: lastUrl,
          responseStatus: lastStatus,
          persistConfig: Object.keys(persistConfig).length > 0 ? persistConfig : undefined,
        };
      }
      const parsedPremium = parsePremiumIndex(premium.payload, {
        symbolMap,
        watched,
        quotes,
        fetchedAt,
      });
      observations.push(...parsedPremium.observations);
      errors.push(...parsedPremium.errors);
      const markBySubject = new Map<string, number>();
      for (const item of parsedPremium.observations) {
        if (item.metric === "mark_price") {
          markBySubject.set(item.subjectCanonicalId, item.value);
        }
      }
      const lastOiAt =
        typeof config.lastOiAt === "string" ? Date.parse(config.lastOiAt) : Number.NaN;
      const oiDue =
        !Number.isFinite(lastOiAt) || fetchedAt.getTime() - lastOiAt >= BINANCE_OI_INTERVAL_MS;
      const usedWeight = premium.ok ? premium.usedWeight : undefined;
      const weightOk = usedWeight === undefined || usedWeight < BINANCE_USED_WEIGHT_SOFT_LIMIT;
      if (oiDue && weightOk) {
        let oiOk = false;
        for (const symbol of takeBounded(parsedPremium.symbols, MAX_BINANCE_OI_SYMBOLS)) {
          const subject = resolveBinanceSubject(symbol, symbolMap, watched, quotes);
          if (!subject) {
            continue;
          }
          const hist = await enqueue(() =>
            getJson(
              `/futures/data/openInterestHist?symbol=${encodeURIComponent(symbol)}&period=5m&limit=1`,
            ),
          );
          lastUrl = hist.requestUrl;
          lastStatus = hist.status ?? lastStatus;
          if (hist.ok) {
            const parsedHist = parseOpenInterestHist(hist.payload, {
              subjectCanonicalId: subject,
              fetchedAt,
            });
            if (parsedHist.observations.length > 0) {
              observations.push(...parsedHist.observations);
              errors.push(...parsedHist.errors);
              oiOk = true;
            } else {
              errors.push(...parsedHist.errors);
            }
          } else if (hist.errors.some((item) => item.class === "capability_missing")) {
            errors.push(...hist.errors);
            continue;
          } else if (hist.errors.some((item) => item.class === "rate_limited")) {
            errors.push(...hist.errors);
            break;
          }
          if (
            !hist.ok ||
            !observations.some(
              (item) => item.metric === "open_interest" && item.subjectCanonicalId === subject,
            )
          ) {
            const oi = await enqueue(() =>
              getJson(`/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`),
            );
            lastUrl = oi.requestUrl;
            lastStatus = oi.status ?? lastStatus;
            if (!oi.ok) {
              errors.push(...oi.errors);
              if (oi.errors.some((item) => item.class === "rate_limited")) {
                break;
              }
              continue;
            }
            const parsedOi = parseOpenInterest(oi.payload, {
              symbol,
              subjectCanonicalId: subject,
              markPrice: markBySubject.get(subject),
              fetchedAt,
            });
            observations.push(...parsedOi.observations);
            errors.push(...parsedOi.errors);
            if (parsedOi.observations.length > 0) {
              oiOk = true;
            }
          }
          const ls = await enqueue(() =>
            getJson(
              `/futures/data/globalLongShortAccountRatio?symbol=${encodeURIComponent(symbol)}&period=5m&limit=1`,
            ),
          );
          lastUrl = ls.requestUrl;
          lastStatus = ls.status ?? lastStatus;
          if (ls.ok) {
            const parsedLs = parseLongShortRatio(ls.payload, {
              subjectCanonicalId: subject,
              fetchedAt,
            });
            observations.push(...parsedLs.observations);
            errors.push(...parsedLs.errors);
          } else if (!ls.errors.some((item) => item.class === "unavailable")) {
            errors.push(...ls.errors);
          }
        }
        if (oiOk) {
          persistConfig.lastOiAt = fetchedAt.toISOString();
        }
      }
      const drain =
        options.drainLiquidations ??
        ((input: { now: Date; resolveSubject: (symbol: string) => string | undefined }) =>
          sharedBinanceForceOrderAggregator().drain(input));
      observations.push(
        ...drain({
          now: fetchedAt,
          resolveSubject: (symbol) => resolveBinanceSubject(symbol, symbolMap, watched, quotes),
        }),
      );
      return {
        observations: takeBounded(observations, MAX_BINANCE_PREMIUM_ROWS * METRICS.length),
        persistConfig: Object.keys(persistConfig).length > 0 ? persistConfig : undefined,
        partial: errors.length > 0,
        errors,
        requestUrl: lastUrl,
        responseStatus: lastStatus,
      };
    },
  };
}

export function createBinanceFuturesAdapter(fetchImpl: typeof fetch = fetch): SourceAdapter {
  return {
    id: BINANCE_FUTURES_PROVIDER_ID,
    family: BINANCE_FUTURES_FAMILY,
    capabilities: {
      modes: ["poll"],
      supportsTimeRange: false,
      supportsPagination: false,
      supportsDomainFilter: false,
      lookbackNotes:
        "Opt-in. Public Binance USD-M Futures REST, no key. premiumIndex every minute; open interest every 5 minutes. Liquidations come from the bounded !forceOrder@arr stream. Funding is per 8h; compare venues on funding_rate_apr only. HTTP 451 means this region cannot reach the venue.",
      partialResults: true,
    },
    async validate(config) {
      parseQuoteAssets(config.quoteAssets);
      return { ok: true, message: "ok" };
    },
    async healthCheck() {
      const url = `${BINANCE_FUTURES_API_BASE}/fapi/v1/ping`;
      try {
        assertSafeHttpUrl(url);
        const response = await fetchImpl(url, {
          headers: { accept: "application/json", "user-agent": BINANCE_FUTURES_USER_AGENT },
          signal: AbortSignal.timeout(15_000),
          redirect: "manual",
        });
        if (response.status === 451) {
          return {
            ok: false,
            message:
              "Binance USD-M Futures is unavailable from this region (HTTP 451). Disable the source.",
          };
        }
        if (response.status >= 300 && response.status < 400) {
          return { ok: false, message: "Binance redirected; redirects are not followed." };
        }
        if (!response.ok) {
          return { ok: false, message: `Binance HTTP ${response.status}` };
        }
        return { ok: true, message: "Binance /fapi/v1/ping answered." };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Binance health check failed.";
        const dns = /enotfound|getaddrinfo|nodename nor servname/i.test(message);
        return {
          ok: false,
          message: dns
            ? "Binance USD-M Futures is unreachable from this host (DNS or network). Disable the source if the venue is blocked in your region."
            : message,
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
