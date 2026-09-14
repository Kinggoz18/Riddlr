import { describe, expect, it } from "vitest";
import {
  detectorEvidenceFingerprint,
  detectPegDeviation,
  detectReturnShock,
  detectReturnShockForSubject,
  detectTvlDrawdown,
  detectTvlDrawdownForSubject,
  detectVolumeAnomaly,
  isObservedAnomalyKind,
  RETURN_SHOCK_V1,
  VOLUME_ANOMALY_V1,
} from "./detectors.js";

function prices(values: number[], start = "2026-09-13T12:00:00.000Z", stepMs = 60_000) {
  const origin = new Date(start).getTime();
  return values.map((value, index) => ({
    observedAt: new Date(origin + index * stepMs),
    value,
  }));
}

describe("return-shock detector", () => {
  it("emits when the last log return's sample z-score is at least 3", () => {
    const points = prices([...Array.from({ length: 20 }, () => 100), 110]);
    const hit = detectReturnShockForSubject("coingecko:bitcoin", points);
    expect(hit?.detectorId).toBe("return_shock");
    expect(hit?.version).toBe("v1");
    expect(hit?.claimKind).toBe("generic:observed_spot_price_anomaly");
    expect(hit?.polarity).toBe("up");
    expect(hit?.sampleCount).toBe(20);
    expect(hit?.zScore).toBeCloseTo(19 / Math.sqrt(20), 10);
    expect(hit?.unit).toBe("sigma");
    expect(hit?.bodyText).toContain("coingecko:bitcoin");
    expect(hit?.claimTitle).toBe("bitcoin 4.25σ spot price return shock (v1, threshold 3σ)");
    if (!hit) {
      throw new Error("expected a return-shock finding");
    }
    expect(detectorEvidenceFingerprint(hit)).toBe(
      "observation|return_shock|v1|coingecko:bitcoin|up",
    );
  });

  it("emits nothing when fewer than window+1 prices exist", () => {
    expect(detectReturnShock(prices([100, 110, 120]))).toBeUndefined();
  });

  it("emits nothing when log returns are constant", () => {
    expect(detectReturnShock(prices(Array.from({ length: 21 }, () => 100)))).toBeUndefined();
  });

  it("emits nothing across a gap wider than three poll intervals", () => {
    const first = prices(Array.from({ length: 21 }, () => 100));
    const last = first[first.length - 1];
    expect(last).toBeDefined();
    const late = {
      observedAt: new Date((last?.observedAt.getTime() ?? 0) + 10 * 60_000),
      value: 400,
    };
    expect(detectReturnShock([...first, late], RETURN_SHOCK_V1)).toBeUndefined();
  });

  it("does not divide when a non-positive price appears", () => {
    const points = prices([...Array.from({ length: 20 }, () => 100), 0]);
    expect(detectReturnShock(points)).toBeUndefined();
  });

  it("does not treat a reversed polarity as the same evidence fingerprint", () => {
    const up = detectReturnShockForSubject(
      "coingecko:bitcoin",
      prices([...Array.from({ length: 20 }, () => 100), 110]),
    );
    const down = detectReturnShockForSubject(
      "coingecko:bitcoin",
      prices([...Array.from({ length: 20 }, () => 100), 90]),
    );
    expect(up?.polarity).toBe("up");
    expect(down?.polarity).toBe("down");
    if (!up || !down) {
      throw new Error("expected both polarities");
    }
    expect(detectorEvidenceFingerprint(up)).not.toBe(detectorEvidenceFingerprint(down));
  });

  it("recognises observed-anomaly claim kinds", () => {
    expect(isObservedAnomalyKind("crypto:observed_spot_price_anomaly")).toBe(true);
    expect(isObservedAnomalyKind("generic:observed_quoted_volume_anomaly")).toBe(true);
    expect(isObservedAnomalyKind("crypto:observed_tvl_anomaly")).toBe(true);
    expect(isObservedAnomalyKind("crypto:market_move")).toBe(false);
  });
});

describe("tvl-drawdown detector", () => {
  it("emits when 24h TVL is down more than 15% and above the floor", () => {
    const start = new Date("2026-09-13T12:00:00.000Z");
    const points = [
      { observedAt: start, value: 100_000_000 },
      { observedAt: new Date(start.getTime() + 24 * 60 * 60 * 1000), value: 80_000_000 },
    ];
    const hit = detectTvlDrawdownForSubject("coingecko:aave", points);
    expect(hit?.detectorId).toBe("tvl_drawdown");
    expect(hit?.version).toBe("v1");
    expect(hit?.claimKind).toBe("generic:observed_tvl_anomaly");
    expect(hit?.polarity).toBe("down");
    expect(hit?.zScore).toBe(-20);
    expect(hit?.value).toBe(80_000_000);
    expect(hit?.unit).toBe("percent");
    expect(hit?.claimTitle).toBe("aave 20.00% TVL drawdown in 24h (v1, threshold 15%)");
  });

  it("emits nothing for a 10% drawdown", () => {
    const start = new Date("2026-09-13T12:00:00.000Z");
    expect(
      detectTvlDrawdown([
        { observedAt: start, value: 100_000_000 },
        { observedAt: new Date(start.getTime() + 24 * 60 * 60 * 1000), value: 90_000_000 },
      ]),
    ).toBeUndefined();
  });

  it("emits nothing when both points are below the 1M usd floor", () => {
    const start = new Date("2026-09-13T12:00:00.000Z");
    expect(
      detectTvlDrawdown([
        { observedAt: start, value: 500_000 },
        { observedAt: new Date(start.getTime() + 24 * 60 * 60 * 1000), value: 400_000 },
      ]),
    ).toBeUndefined();
  });

  it("emits nothing without a point near 24h ago", () => {
    const start = new Date("2026-09-13T12:00:00.000Z");
    expect(
      detectTvlDrawdown([
        { observedAt: start, value: 100_000_000 },
        { observedAt: new Date(start.getTime() + 60 * 60 * 1000), value: 80_000_000 },
      ]),
    ).toBeUndefined();
  });
});

describe("peg-deviation detector", () => {
  const start = new Date("2026-09-13T12:00:00.000Z");
  const later = new Date(start.getTime() + 15 * 60 * 1000);
  const basis = [
    { observedAt: start, value: -1.5 },
    { observedAt: later, value: -2.4 },
  ];

  it("emits when |basis| > 1% twice and CoinGecko spot corroborates", () => {
    const hit = detectPegDeviation(
      basis,
      [{ observedAt: later, value: 0.976 }],
      undefined,
      "coingecko:tether",
    );
    expect(hit?.detectorId).toBe("peg_deviation");
    expect(hit?.claimKind).toBe("generic:stablecoin_peg_change");
    expect(hit?.polarity).toBe("down");
    expect(hit?.zScore).toBe(-2.4);
    expect(hit?.claimTitle).toBe("tether 2.40% peg deviation (v1, threshold 1%, corroborated)");
  });

  it("emits nothing without a CoinGecko or CLOB corroborating price", () => {
    expect(detectPegDeviation(basis, [])).toBeUndefined();
  });

  it("emits nothing when spot is still within 1% of peg", () => {
    expect(detectPegDeviation(basis, [{ observedAt: later, value: 0.999 }])).toBeUndefined();
  });

  it("emits nothing when consecutive basis signs disagree", () => {
    expect(
      detectPegDeviation(
        [
          { observedAt: start, value: -1.5 },
          { observedAt: new Date(start.getTime() + 15 * 60 * 1000), value: 2.4 },
        ],
        [{ observedAt: new Date(start.getTime() + 15 * 60 * 1000), value: 0.976 }],
      ),
    ).toBeUndefined();
  });
});

describe("volume anomaly detector", () => {
  it("emits when the last volume's sample z-score is at least 3", () => {
    const points = prices([...Array.from({ length: 19 }, () => 10), 100]);
    const hit = detectVolumeAnomaly(points);
    expect(hit?.detectorId).toBe("volume_anomaly");
    expect(hit?.claimKind).toBe("generic:observed_quoted_volume_anomaly");
    expect(hit?.polarity).toBe("up");
    expect(hit?.zScore).toBeCloseTo(19 / Math.sqrt(20), 10);
  });

  it("emits nothing below the window", () => {
    expect(detectVolumeAnomaly(prices([10, 11, 12]), VOLUME_ANOMALY_V1)).toBeUndefined();
  });
});
