import {
  isFiniteNumber,
  MAX_OBSERVE_BODY_BYTES,
  OBSERVE_CLOCK_SKEW_MS,
  type SeriesObservation,
  takeBounded,
} from "@riddlr/domain";
import { COINGECKO_API_BASE } from "../coingecko.js";
import {
  assertSafeHttpUrl,
  classifyHttpStatus,
  type LookupFn,
  readBoundedJson,
  redactRequestUrl,
} from "../types.js";
import type { ObservationProvider, ObserveQuery, ObserveResult } from "./types.js";

export const COINGECKO_SPOT_PROVIDER_ID = "coingecko-spot";
export const COINGECKO_SIMPLE_PRICE_PATH = "/simple/price";

const METRICS = ["spot_price", "quoted_volume", "quoted_market_cap", "price_change_24h"] as const;

function coingeckoId(canonicalId: string): string | undefined {
  if (!canonicalId.startsWith("coingecko:")) {
    return undefined;
  }
  const id = canonicalId.slice("coingecko:".length).trim();
  return id.length > 0 ? id : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseCoinGeckoSimplePrice(
  payload: unknown,
  requestedIds: readonly string[],
  fetchedAt: Date,
): ObserveResult {
  const root = asRecord(payload);
  if (!root) {
    return {
      observations: [],
      partial: true,
      errors: [
        { class: "malformed", message: "CoinGecko simple/price payload was not an object." },
      ],
    };
  }
  if (typeof root.error === "string") {
    return {
      observations: [],
      partial: true,
      errors: [{ class: "malformed", message: root.error }],
    };
  }
  const observations: SeriesObservation[] = [];
  let skipped = 0;
  for (const id of requestedIds) {
    const row = asRecord(root[id]);
    if (!row) {
      skipped += 1;
      continue;
    }
    const canonicalId = `coingecko:${id}`;
    const lastUpdated =
      typeof row.last_updated_at === "number" && Number.isFinite(row.last_updated_at)
        ? new Date(row.last_updated_at * 1000)
        : undefined;
    let observedAt = lastUpdated ?? fetchedAt;
    if (lastUpdated && lastUpdated.getTime() - fetchedAt.getTime() > OBSERVE_CLOCK_SKEW_MS) {
      observedAt = fetchedAt;
    }
    const stale =
      lastUpdated !== undefined && fetchedAt.getTime() - lastUpdated.getTime() > 3 * 60_000;
    if (isFiniteNumber(row.usd)) {
      observations.push({
        provider: COINGECKO_SPOT_PROVIDER_ID,
        metric: "spot_price",
        subjectCanonicalId: canonicalId,
        value: row.usd,
        unit: "usd",
        observedAt,
        providerLastUpdatedAt: lastUpdated,
        stale,
      });
    } else {
      skipped += 1;
    }
    if (isFiniteNumber(row.usd_24h_vol)) {
      observations.push({
        provider: COINGECKO_SPOT_PROVIDER_ID,
        metric: "quoted_volume",
        subjectCanonicalId: canonicalId,
        value: row.usd_24h_vol,
        unit: "usd",
        observedAt,
        providerLastUpdatedAt: lastUpdated,
        stale,
      });
    }
    if (isFiniteNumber(row.usd_market_cap)) {
      observations.push({
        provider: COINGECKO_SPOT_PROVIDER_ID,
        metric: "quoted_market_cap",
        subjectCanonicalId: canonicalId,
        value: row.usd_market_cap,
        unit: "usd",
        observedAt,
        providerLastUpdatedAt: lastUpdated,
        stale,
      });
    }
    if (isFiniteNumber(row.usd_24h_change)) {
      observations.push({
        provider: COINGECKO_SPOT_PROVIDER_ID,
        metric: "price_change_24h",
        subjectCanonicalId: canonicalId,
        value: row.usd_24h_change,
        unit: "percent",
        observedAt,
        providerLastUpdatedAt: lastUpdated,
        stale,
      });
    }
  }
  return {
    observations,
    partial: skipped > 0,
    errors: [],
    stale: observations.some((item) => item.stale),
  };
}

export function createCoinGeckoSpotProvider(
  options: { fetchImpl?: typeof fetch; lookup?: LookupFn; intervalMs?: number } = {},
): ObservationProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    id: COINGECKO_SPOT_PROVIDER_ID,
    metrics: METRICS,
    defaultIntervalMs: options.intervalMs ?? 60_000,
    async observe(config, query: ObserveQuery): Promise<ObserveResult> {
      const ids = [
        ...new Set(
          query.subjectCanonicalIds
            .map(coingeckoId)
            .filter((item): item is string => Boolean(item)),
        ),
      ];
      if (ids.length === 0) {
        return { observations: [], partial: false, errors: [] };
      }
      const url = new URL(`${COINGECKO_API_BASE}${COINGECKO_SIMPLE_PRICE_PATH}`);
      url.searchParams.set("ids", takeBounded(ids, 100).join(","));
      url.searchParams.set("vs_currencies", "usd");
      url.searchParams.set("include_24hr_vol", "true");
      url.searchParams.set("include_24hr_change", "true");
      url.searchParams.set("include_market_cap", "true");
      url.searchParams.set("include_last_updated_at", "true");
      const requestUrl = redactRequestUrl(url.toString());
      try {
        assertSafeHttpUrl(url.toString());
        const response = await fetchImpl(url, {
          headers: config.token ? { "x-cg-demo-api-key": String(config.token) } : undefined,
          signal: AbortSignal.timeout(10_000),
          redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400) {
          return {
            observations: [],
            partial: true,
            errors: [
              {
                class: "unavailable",
                message: "CoinGecko redirected; redirects are not followed.",
              },
            ],
            requestUrl,
            responseStatus: response.status,
          };
        }
        if (!response.ok) {
          return {
            observations: [],
            partial: true,
            errors: [
              {
                class: classifyHttpStatus(response.status),
                message: `CoinGecko HTTP ${response.status}`,
              },
            ],
            requestUrl,
            responseStatus: response.status,
          };
        }
        let payload: unknown;
        try {
          payload = await readBoundedJson(response, MAX_OBSERVE_BODY_BYTES);
        } catch {
          return {
            observations: [],
            partial: true,
            errors: [
              {
                class: "malformed",
                message: "CoinGecko simple/price body exceeded the size bound.",
              },
            ],
            requestUrl,
            responseStatus: response.status,
          };
        }
        const parsed = parseCoinGeckoSimplePrice(payload, takeBounded(ids, 100), query.observedAt);
        return { ...parsed, requestUrl, responseStatus: response.status };
      } catch (error) {
        const message = error instanceof Error ? error.message : "CoinGecko spot observe failed";
        const timeout = /timeout|aborted/i.test(message);
        return {
          observations: [],
          partial: true,
          errors: [
            {
              class: timeout ? "unavailable" : "unavailable",
              message,
            },
          ],
          requestUrl,
        };
      }
    },
  };
}
