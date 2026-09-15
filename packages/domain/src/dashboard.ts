import type { CatalystKind } from "./catalyst-kinds.js";
import { observationDelta } from "./lifecycle.js";
import {
  CHANGE_24H_TOLERANCE_MS,
  MAX_MORNING_SINCE_MS,
  MAX_SERIES_WINDOW,
  MORNING_LOOKBACK_MS,
  takeBounded,
} from "./limits.js";

export {
  chartMetricLabel,
  DASHBOARD_CHART_METRICS,
  type DashboardChartMetric,
  isDashboardChartMetric,
} from "./dashboard-charts.js";

export const UPCOMING_CATALYST_KINDS = [
  "token_unlock",
  "governance_proposal",
  "scheduled_release",
  "listing_or_delisting",
] as const satisfies readonly CatalystKind[];

export function isUpcomingCatalystKind(value: string | null | undefined): boolean {
  return Boolean(value && (UPCOMING_CATALYST_KINDS as readonly string[]).includes(value));
}

export function parseMorningSince(value: string | undefined, now: Date): Date {
  const fallback = new Date(now.getTime() - MORNING_LOOKBACK_MS);
  if (!value) {
    return fallback;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() > now.getTime()) {
    return fallback;
  }
  if (now.getTime() - parsed.getTime() > MAX_MORNING_SINCE_MS) {
    return new Date(now.getTime() - MAX_MORNING_SINCE_MS);
  }
  return parsed;
}

export function boundSeriesPoints<T>(points: readonly T[], limit = MAX_SERIES_WINDOW): T[] {
  if (points.length <= limit) {
    return takeBounded(points, limit);
  }
  return takeBounded(points.slice(points.length - limit), limit);
}

export function change24hPct(input: {
  latest?: { observedAt: Date; value: number };
  prior?: { observedAt: Date; value: number };
  recordedChange?: number;
}): number | undefined {
  if (typeof input.recordedChange === "number" && Number.isFinite(input.recordedChange)) {
    return input.recordedChange;
  }
  const latest = input.latest;
  const prior = input.prior;
  if (!latest || !prior) {
    return undefined;
  }
  const expected = latest.observedAt.getTime() - MORNING_LOOKBACK_MS;
  if (Math.abs(prior.observedAt.getTime() - expected) > CHANGE_24H_TOLERANCE_MS) {
    return undefined;
  }
  return observationDelta(prior.value, latest.value).pct;
}
