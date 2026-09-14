import { HOURS_PER_YEAR } from "./limits.js";

export const OBSERVATION_METRICS = [
  "spot_price",
  "quoted_volume",
  "quoted_market_cap",
  "price_change_24h",
  "tvl_usd",
  "chain_tvl_usd",
  "stablecoin_circulating",
  "stablecoin_price",
  "stablecoin_basis",
  "funding_rate_1h",
  "funding_rate_8h",
  "funding_rate_apr",
  "funding_predicted_apr",
  "funding_predicted_binance_apr",
  "open_interest",
  "open_interest_usd",
  "mark_price",
  "premium",
  "volume_24h_usd",
  "long_short_ratio",
  "liquidations_1m_usd",
  "odds_yes",
  "odds_change_1h",
  "odds_change_24h",
  "odds_liquidity_usd",
  "volume",
] as const;
export type ObservationMetric = (typeof OBSERVATION_METRICS)[number];

export const OBSERVATION_RESOLUTIONS = ["raw", "daily"] as const;
export type ObservationResolution = (typeof OBSERVATION_RESOLUTIONS)[number];

export type SeriesObservation = {
  provider: string;
  metric: ObservationMetric | (string & {});
  subjectCanonicalId: string;
  value: number;
  unit: string;
  observedAt: Date;
  providerLastUpdatedAt?: Date;
  stale?: boolean;
};

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function observationSubjectId(providerPrefix: string, nativeId: string): string {
  return `${providerPrefix}:${nativeId}`;
}

export function decimalRateToPercent(value: number): number {
  return value * 100;
}

export function annualizeFundingAprPercent(decimalRate: number, periodHours: number): number {
  if (!Number.isFinite(decimalRate) || !Number.isFinite(periodHours) || periodHours <= 0) {
    return Number.NaN;
  }
  return decimalRate * (HOURS_PER_YEAR / periodHours) * 100;
}

export function hourBucketUtc(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()),
  );
}

export type PredictionAssetHint = {
  canonicalId: string;
  symbol?: string;
  name?: string;
};

const PREDICTION_REGULATORY_RE =
  /\b(sec|cftc|doj|lawsuit|sanction|ofac|regulation|enforcement|legal action)\b/i;

export function predictionMarketCatalystKind(
  text: string,
): "macro_policy_decision" | "regulatory_or_legal_action" {
  if (PREDICTION_REGULATORY_RE.test(text)) {
    return "regulatory_or_legal_action";
  }
  return "macro_policy_decision";
}

function hintMatches(text: string, hint: PredictionAssetHint): boolean {
  const hay = text.toLowerCase();
  const name = hint.name?.trim().toLowerCase();
  if (name && name.length >= 3) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) {
      return true;
    }
  }
  const symbol = hint.symbol?.trim().toLowerCase();
  if (symbol && symbol.length >= 3 && hay.includes(symbol)) {
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(text);
  }
  return false;
}

export function resolvePredictionSubject(input: {
  text: string;
  nativeCanonicalId: string;
  watched: ReadonlySet<string>;
  hints: readonly PredictionAssetHint[];
}): string {
  const hits = input.hints.filter(
    (hint) => input.watched.has(hint.canonicalId) && hintMatches(input.text, hint),
  );
  const unique = [...new Set(hits.map((item) => item.canonicalId))];
  if (unique.length === 1 && unique[0]) {
    return unique[0];
  }
  return input.nativeCanonicalId;
}

export function oddsChangePercentagePoints(from: number, to: number): number {
  return (to - from) * 100;
}
