import { DEFAULT_PCT_DROP_WINDOW_MINUTES, DEFAULT_PCT_MOVE_WINDOW_MINUTES } from "./limits.js";

export const OBSERVATION_ALERT_METRICS = [
  "spot_price",
  "funding_rate_apr",
  "tvl_usd",
  "odds_yes",
] as const;
export type ObservationAlertMetric = (typeof OBSERVATION_ALERT_METRICS)[number];

export const OBSERVATION_ALERT_OPS = ["gte", "lte", "pct_drop", "pct_move"] as const;
export type ObservationAlertOp = (typeof OBSERVATION_ALERT_OPS)[number];

export function isObservationAlertMetric(value: string): value is ObservationAlertMetric {
  return (OBSERVATION_ALERT_METRICS as readonly string[]).includes(value);
}

export function isObservationAlertOp(value: string): value is ObservationAlertOp {
  return (OBSERVATION_ALERT_OPS as readonly string[]).includes(value);
}

export function evaluateObservationAlert(input: {
  metric: string;
  op: ObservationAlertOp;
  threshold: number;
  current: number;
  baseline?: number;
}): { fired: boolean; reason: string } {
  if (!Number.isFinite(input.current) || !Number.isFinite(input.threshold)) {
    return { fired: false, reason: "non_finite" };
  }
  if (input.metric === "odds_yes" && (input.current < 0 || input.current > 1)) {
    return { fired: false, reason: "odds_out_of_range" };
  }
  if (input.op === "gte") {
    return input.current >= input.threshold
      ? { fired: true, reason: "gte" }
      : { fired: false, reason: "below_threshold" };
  }
  if (input.op === "lte") {
    return input.current <= input.threshold
      ? { fired: true, reason: "lte" }
      : { fired: false, reason: "above_threshold" };
  }
  const baseline = input.baseline;
  if (baseline === undefined || !Number.isFinite(baseline) || baseline === 0) {
    return { fired: false, reason: "missing_baseline" };
  }
  const pct = ((input.current - baseline) / baseline) * 100;
  if (!Number.isFinite(pct)) {
    return { fired: false, reason: "non_finite_pct" };
  }
  if (input.op === "pct_drop") {
    return -pct >= input.threshold
      ? { fired: true, reason: "pct_drop" }
      : { fired: false, reason: "drop_below_threshold" };
  }
  return Math.abs(pct) >= input.threshold
    ? { fired: true, reason: "pct_move" }
    : { fired: false, reason: "move_below_threshold" };
}

export function observationAlertHourBucket(observedAt: Date): string {
  return observedAt.toISOString().slice(0, 13);
}

export function observationAlertLookbackMs(op: ObservationAlertOp, windowMinutes?: number): number {
  if (op !== "pct_drop" && op !== "pct_move") {
    return 0;
  }
  const fallback =
    op === "pct_drop" ? DEFAULT_PCT_DROP_WINDOW_MINUTES : DEFAULT_PCT_MOVE_WINDOW_MINUTES;
  const minutes =
    typeof windowMinutes === "number" && Number.isFinite(windowMinutes) && windowMinutes > 0
      ? windowMinutes
      : fallback;
  return minutes * 60 * 1000;
}
