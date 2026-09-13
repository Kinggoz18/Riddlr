export const OBSERVATION_METRICS = [
  "spot_price",
  "quoted_volume",
  "quoted_market_cap",
  "price_change_24h",
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
