import { isCatalystKind } from "./catalyst-kinds.js";

export const DASHBOARD_CHART_METRICS = [
  "spot_price",
  "funding_rate_apr",
  "open_interest_usd",
  "tvl_usd",
] as const;
export type DashboardChartMetric = (typeof DASHBOARD_CHART_METRICS)[number];

export function isDashboardChartMetric(value: string): value is DashboardChartMetric {
  return (DASHBOARD_CHART_METRICS as readonly string[]).includes(value);
}

export function chartMetricLabel(metric: string): string {
  switch (metric) {
    case "spot_price":
      return "Spot price";
    case "funding_rate_apr":
      return "Funding APR";
    case "open_interest_usd":
      return "Open interest";
    case "tvl_usd":
      return "TVL";
    default:
      return isCatalystKind(metric) ? metric : metric.replaceAll("_", " ");
  }
}
