import { describe, expect, it } from "vitest";
import {
  evaluateObservationAlert,
  observationAlertHourBucket,
  observationAlertLookbackMs,
} from "./observation-alerts.js";

describe("observation alert thresholds", () => {
  it("fires funding above a threshold and withholds below", () => {
    expect(
      evaluateObservationAlert({
        metric: "funding_rate_apr",
        op: "gte",
        threshold: 20,
        current: 25,
      }).fired,
    ).toBe(true);
    expect(
      evaluateObservationAlert({
        metric: "funding_rate_apr",
        op: "gte",
        threshold: 20,
        current: 19,
      }).fired,
    ).toBe(false);
  });

  it("fires a 24h TVL drop of at least the threshold and refuses divide-by-zero", () => {
    expect(
      evaluateObservationAlert({
        metric: "tvl_usd",
        op: "pct_drop",
        threshold: 10,
        current: 80,
        baseline: 100,
      }),
    ).toEqual({ fired: true, reason: "pct_drop" });
    expect(
      evaluateObservationAlert({
        metric: "tvl_usd",
        op: "pct_drop",
        threshold: 10,
        current: 95,
        baseline: 100,
      }).fired,
    ).toBe(false);
    expect(
      evaluateObservationAlert({
        metric: "tvl_usd",
        op: "pct_drop",
        threshold: 10,
        current: 50,
        baseline: 0,
      }).reason,
    ).toBe("missing_baseline");
  });

  it("fires an odds cross and a windowed price move", () => {
    expect(
      evaluateObservationAlert({
        metric: "odds_yes",
        op: "gte",
        threshold: 0.6,
        current: 0.61,
      }).fired,
    ).toBe(true);
    expect(
      evaluateObservationAlert({
        metric: "spot_price",
        op: "pct_move",
        threshold: 5,
        current: 110,
        baseline: 100,
      }).fired,
    ).toBe(true);
  });

  it("buckets observation alerts by UTC hour so a rule does not fire every poll", () => {
    expect(observationAlertHourBucket(new Date("2026-09-14T15:42:00.000Z"))).toBe("2026-09-14T15");
  });

  it("looks back 24h for a TVL drop and the operator window for a price move", () => {
    expect(observationAlertLookbackMs("pct_drop")).toBe(1_440 * 60 * 1000);
    expect(observationAlertLookbackMs("pct_move", 15)).toBe(15 * 60 * 1000);
    expect(observationAlertLookbackMs("gte")).toBe(0);
  });
});
