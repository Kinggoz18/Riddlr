import { describe, expect, it } from "vitest";
import {
  boundSeriesPoints,
  change24hPct,
  DASHBOARD_CHART_METRICS,
  isDashboardChartMetric,
  isUpcomingCatalystKind,
  parseMorningSince,
} from "./dashboard.js";
import { MAX_MORNING_SINCE_MS, MORNING_LOOKBACK_MS } from "./limits.js";

describe("morning since", () => {
  const now = new Date("2026-09-14T12:00:00.000Z");

  it("defaults missing, invalid, and future timestamps to the last 24 hours", () => {
    expect(parseMorningSince(undefined, now).toISOString()).toBe(
      new Date(now.getTime() - MORNING_LOOKBACK_MS).toISOString(),
    );
    expect(parseMorningSince("not-a-date", now).toISOString()).toBe(
      new Date(now.getTime() - MORNING_LOOKBACK_MS).toISOString(),
    );
    expect(parseMorningSince("2099-01-01T00:00:00.000Z", now).toISOString()).toBe(
      new Date(now.getTime() - MORNING_LOOKBACK_MS).toISOString(),
    );
  });

  it("clamps a last visit older than seven days", () => {
    expect(parseMorningSince("2026-01-01T00:00:00.000Z", now).toISOString()).toBe(
      new Date(now.getTime() - MAX_MORNING_SINCE_MS).toISOString(),
    );
  });

  it("keeps a last visit inside the seven-day window", () => {
    expect(parseMorningSince("2026-09-13T12:00:00.000Z", now).toISOString()).toBe(
      "2026-09-13T12:00:00.000Z",
    );
  });
});

describe("series bounds and 24h change", () => {
  it("keeps the newest points when the window overflows", () => {
    const points = [1, 2, 3, 4, 5];
    expect(boundSeriesPoints(points, 3)).toEqual([3, 4, 5]);
    expect(boundSeriesPoints(points, 8)).toEqual(points);
  });

  it("uses a recorded 24h change and otherwise requires a prior near 24h", () => {
    const latest = { observedAt: new Date("2026-09-14T12:00:00.000Z"), value: 110 };
    expect(change24hPct({ recordedChange: 2.5, latest })).toBe(2.5);
    expect(
      change24hPct({
        latest,
        prior: { observedAt: new Date("2026-09-13T12:00:00.000Z"), value: 100 },
      }),
    ).toBe(10);
    expect(
      change24hPct({
        latest,
        prior: { observedAt: new Date("2026-09-14T11:00:00.000Z"), value: 100 },
      }),
    ).toBeUndefined();
    expect(
      change24hPct({
        latest,
        prior: { observedAt: new Date("2026-09-13T12:00:00.000Z"), value: 0 },
      }),
    ).toBeUndefined();
    expect(change24hPct({ latest })).toBeUndefined();
  });

  it("names chart metrics and upcoming scheduled kinds", () => {
    expect([...DASHBOARD_CHART_METRICS]).toEqual([
      "spot_price",
      "funding_rate_apr",
      "open_interest_usd",
      "tvl_usd",
    ]);
    expect(isDashboardChartMetric("spot_price")).toBe(true);
    expect(isDashboardChartMetric("odds_yes")).toBe(false);
    expect(isUpcomingCatalystKind("token_unlock")).toBe(true);
    expect(isUpcomingCatalystKind("governance_proposal")).toBe(true);
    expect(isUpcomingCatalystKind("scheduled_release")).toBe(true);
    expect(isUpcomingCatalystKind("listing_or_delisting")).toBe(true);
    expect(isUpcomingCatalystKind("observed_anomaly")).toBe(false);
  });
});
