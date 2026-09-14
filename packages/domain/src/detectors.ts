import {
  DEFAULT_DETECTOR_ABS_Z,
  DEFAULT_DETECTOR_WINDOW,
  DEFAULT_FUNDING_DIVERGENCE_APR_PCT,
  DEFAULT_LIQUIDATION_BURST_USD,
  DEFAULT_OI_CHANGE_PCT,
  DEFAULT_PEG_DEVIATION_PCT,
  DEFAULT_TVL_DRAWDOWN_FLOOR_USD,
  DEFAULT_TVL_DRAWDOWN_PCT,
  FUNDING_DIVERGENCE_MAX_GAP_MS,
  MARKET_STRESS_FUNDING_MAX_GAP_MS,
  MARKET_STRESS_FUNDING_MIN_SAMPLES,
  MARKET_STRESS_FUNDING_WINDOW,
  OI_CHANGE_LOOKBACK_MS,
  OI_CHANGE_MAX_GAP_MS,
  TVL_DRAWDOWN_LOOKBACK_MS,
} from "./limits.js";
import type { SeriesObservation } from "./observations.js";

export type DetectorSpec = {
  id: string;
  version: string;
  metric: string;
  claimKind: string;
  window: number;
  absZ: number;
  maxGapMs: number;
  provider?: string;
  floorUsd?: number;
  oiChangePct?: number;
  fundingWindow?: number;
  liquidationBurstUsd?: number;
};

export type SeriesPoint = {
  observedAt: Date;
  value: number;
};

export type DetectorFinding = {
  detectorId: string;
  version: string;
  metric: string;
  claimKind: string;
  subjectCanonicalId: string;
  zScore: number;
  value: number;
  unit: string;
  polarity: "up" | "down";
  thresholdAbsZ: number;
  sampleCount: number;
  windowStart: Date;
  windowEnd: Date;
  bodyText: string;
  claimTitle: string;
  series: SeriesPoint[];
};

export const RETURN_SHOCK_V1: DetectorSpec = {
  id: "return_shock",
  version: "v1",
  metric: "spot_price",
  claimKind: "generic:observed_spot_price_anomaly",
  window: DEFAULT_DETECTOR_WINDOW,
  absZ: DEFAULT_DETECTOR_ABS_Z,
  maxGapMs: 3 * 60 * 1000,
};

export const VOLUME_ANOMALY_V1: DetectorSpec = {
  id: "volume_anomaly",
  version: "v1",
  metric: "quoted_volume",
  claimKind: "generic:observed_quoted_volume_anomaly",
  window: DEFAULT_DETECTOR_WINDOW,
  absZ: DEFAULT_DETECTOR_ABS_Z,
  maxGapMs: 3 * 60 * 1000,
};

export const TVL_DRAWDOWN_V1: DetectorSpec = {
  id: "tvl_drawdown",
  version: "v1",
  metric: "tvl_usd",
  claimKind: "generic:observed_tvl_anomaly",
  window: 2,
  absZ: DEFAULT_TVL_DRAWDOWN_PCT,
  maxGapMs: 6 * 60 * 60 * 1000,
  provider: "defillama",
  floorUsd: DEFAULT_TVL_DRAWDOWN_FLOOR_USD,
};

export const PEG_DEVIATION_V1: DetectorSpec = {
  id: "peg_deviation",
  version: "v1",
  metric: "stablecoin_basis",
  claimKind: "generic:stablecoin_peg_change",
  window: 2,
  absZ: DEFAULT_PEG_DEVIATION_PCT,
  maxGapMs: 40 * 60 * 1000,
  provider: "defillama",
};

export const MARKET_STRESS_V1: DetectorSpec = {
  id: "market_stress",
  version: "v1",
  metric: "funding_rate_apr",
  claimKind: "generic:market_stress",
  window: MARKET_STRESS_FUNDING_MIN_SAMPLES,
  absZ: DEFAULT_DETECTOR_ABS_Z,
  maxGapMs: MARKET_STRESS_FUNDING_MAX_GAP_MS,
  fundingWindow: MARKET_STRESS_FUNDING_WINDOW,
  oiChangePct: DEFAULT_OI_CHANGE_PCT,
  liquidationBurstUsd: DEFAULT_LIQUIDATION_BURST_USD,
};

export const FUNDING_DIVERGENCE_V1: DetectorSpec = {
  id: "funding_divergence",
  version: "v1",
  metric: "funding_rate_apr",
  claimKind: "generic:market_stress",
  window: 1,
  absZ: DEFAULT_FUNDING_DIVERGENCE_APR_PCT,
  maxGapMs: FUNDING_DIVERGENCE_MAX_GAP_MS,
};

function sampleMean(values: readonly number[]): number {
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function sampleStdev(values: readonly number[]): number | undefined {
  if (values.length < 2) {
    return undefined;
  }
  const mean = sampleMean(values);
  const sumSq = values.reduce((sum, item) => sum + (item - mean) ** 2, 0);
  const variance = sumSq / (values.length - 1);
  if (variance === 0) {
    return undefined;
  }
  return Math.sqrt(variance);
}

function zScore(values: readonly number[]): number | undefined {
  if (values.length < 2) {
    return undefined;
  }
  const last = values[values.length - 1];
  if (last === undefined) {
    return undefined;
  }
  const sd = sampleStdev(values);
  if (sd === undefined) {
    return undefined;
  }
  return (last - sampleMean(values)) / sd;
}

function sortPoints(points: readonly SeriesPoint[]): SeriesPoint[] {
  return [...points].sort((left, right) => left.observedAt.getTime() - right.observedAt.getTime());
}

function logReturns(points: readonly SeriesPoint[], maxGapMs: number): number[] | undefined {
  const ordered = sortPoints(points);
  const returns: number[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const prev = ordered[index - 1];
    const next = ordered[index];
    if (!prev || !next || prev.value <= 0 || next.value <= 0) {
      return undefined;
    }
    const gap = next.observedAt.getTime() - prev.observedAt.getTime();
    if (gap <= 0 || gap > maxGapMs) {
      returns.length = 0;
      continue;
    }
    returns.push(Math.log(next.value / prev.value));
  }
  return returns;
}

function finding(input: {
  spec: DetectorSpec;
  subjectCanonicalId: string;
  z: number;
  series: SeriesPoint[];
  unit: string;
  lastValue: number;
  sampleCount: number;
}): DetectorFinding | undefined {
  if (!Number.isFinite(input.z) || Math.abs(input.z) < input.spec.absZ) {
    return undefined;
  }
  const polarity = input.z > 0 ? "up" : "down";
  const windowStart = input.series[0]?.observedAt;
  const windowEnd = input.series[input.series.length - 1]?.observedAt;
  if (!windowStart || !windowEnd) {
    return undefined;
  }
  const zText = input.z.toFixed(2);
  const subjectLocal =
    input.subjectCanonicalId.split(":")[1]?.replace(/-/g, " ") ?? input.subjectCanonicalId;
  const metricLabel = input.spec.metric.replaceAll("_", " ");
  const detectorLabel = input.spec.id.replaceAll("_", " ");
  return {
    detectorId: input.spec.id,
    version: input.spec.version,
    metric: input.spec.metric,
    claimKind: input.spec.claimKind,
    subjectCanonicalId: input.subjectCanonicalId,
    zScore: input.z,
    value: input.z,
    unit: "sigma",
    polarity,
    thresholdAbsZ: input.spec.absZ,
    sampleCount: input.sampleCount,
    windowStart,
    windowEnd,
    bodyText: `${input.spec.id}.${input.spec.version} on ${input.subjectCanonicalId}: z=${zText} over ${input.sampleCount} ${input.spec.metric} samples (threshold ${input.spec.absZ}). Last ${input.spec.metric} ${input.lastValue} ${input.unit}.`,
    claimTitle: `${subjectLocal} ${zText}σ ${metricLabel} ${detectorLabel} (${input.spec.version}, threshold ${input.spec.absZ}σ)`,
    series: input.series,
  };
}

export function detectReturnShock(
  points: readonly SeriesPoint[],
  spec: DetectorSpec = RETURN_SHOCK_V1,
  subjectCanonicalId = "",
): DetectorFinding | undefined {
  if (points.length < spec.window + 1) {
    return undefined;
  }
  const ordered = sortPoints(points).slice(-(spec.window + 1));
  const returns = logReturns(ordered, spec.maxGapMs);
  if (!returns || returns.length < spec.window) {
    return undefined;
  }
  const windowReturns = returns.slice(-spec.window);
  const z = zScore(windowReturns);
  if (z === undefined) {
    return undefined;
  }
  const last = ordered[ordered.length - 1];
  if (!last) {
    return undefined;
  }
  return finding({
    spec,
    subjectCanonicalId,
    z,
    series: ordered,
    unit: "usd",
    lastValue: last.value,
    sampleCount: windowReturns.length,
  });
}

export function detectReturnShockForSubject(
  subjectCanonicalId: string,
  points: readonly SeriesPoint[],
  spec: DetectorSpec = RETURN_SHOCK_V1,
): DetectorFinding | undefined {
  return detectReturnShock(points, spec, subjectCanonicalId);
}

export function detectVolumeAnomaly(
  points: readonly SeriesPoint[],
  spec: DetectorSpec = VOLUME_ANOMALY_V1,
  subjectCanonicalId = "",
): DetectorFinding | undefined {
  if (points.length < spec.window) {
    return undefined;
  }
  const ordered = sortPoints(points);
  const contiguous: SeriesPoint[] = [];
  for (const point of ordered) {
    const prev = contiguous[contiguous.length - 1];
    if (prev) {
      const gap = point.observedAt.getTime() - prev.observedAt.getTime();
      if (gap <= 0 || gap > spec.maxGapMs) {
        contiguous.length = 0;
      }
    }
    contiguous.push(point);
  }
  if (contiguous.length < spec.window) {
    return undefined;
  }
  const windowPoints = contiguous.slice(-spec.window);
  const values = windowPoints.map((item) => item.value);
  const z = zScore(values);
  if (z === undefined) {
    return undefined;
  }
  const last = windowPoints[windowPoints.length - 1];
  if (!last) {
    return undefined;
  }
  return finding({
    spec,
    subjectCanonicalId,
    z,
    series: windowPoints,
    unit: "usd",
    lastValue: last.value,
    sampleCount: values.length,
  });
}

export function detectVolumeAnomalyForSubject(
  subjectCanonicalId: string,
  points: readonly SeriesPoint[],
  spec: DetectorSpec = VOLUME_ANOMALY_V1,
): DetectorFinding | undefined {
  return detectVolumeAnomaly(points, spec, subjectCanonicalId);
}

function subjectLabel(subjectCanonicalId: string): string {
  return subjectCanonicalId.split(":")[1]?.replace(/-/g, " ") ?? subjectCanonicalId;
}

export function detectTvlDrawdown(
  points: readonly SeriesPoint[],
  spec: DetectorSpec = TVL_DRAWDOWN_V1,
  subjectCanonicalId = "",
): DetectorFinding | undefined {
  const ordered = sortPoints(points);
  const last = ordered[ordered.length - 1];
  if (!last) {
    return undefined;
  }
  const floor = spec.floorUsd ?? DEFAULT_TVL_DRAWDOWN_FLOOR_USD;
  const target = last.observedAt.getTime() - TVL_DRAWDOWN_LOOKBACK_MS;
  let prior: SeriesPoint | undefined;
  let best = Number.POSITIVE_INFINITY;
  for (const point of ordered.slice(0, -1)) {
    const delta = Math.abs(point.observedAt.getTime() - target);
    if (delta <= spec.maxGapMs && delta < best) {
      best = delta;
      prior = point;
    }
  }
  if (!prior || prior.value <= 0) {
    return undefined;
  }
  if (Math.max(last.value, prior.value) < floor) {
    return undefined;
  }
  const changePct = ((last.value - prior.value) / prior.value) * 100;
  if (!Number.isFinite(changePct) || changePct > -spec.absZ) {
    return undefined;
  }
  const drawdownText = Math.abs(changePct).toFixed(2);
  return {
    detectorId: spec.id,
    version: spec.version,
    metric: spec.metric,
    claimKind: spec.claimKind,
    subjectCanonicalId,
    zScore: changePct,
    value: last.value,
    unit: "percent",
    polarity: "down",
    thresholdAbsZ: spec.absZ,
    sampleCount: 2,
    windowStart: prior.observedAt,
    windowEnd: last.observedAt,
    bodyText: `${spec.id}.${spec.version} on ${subjectCanonicalId}: TVL ${prior.value} → ${last.value} usd (${changePct.toFixed(2)}% in 24h, threshold ${spec.absZ}%, floor ${floor} usd).`,
    claimTitle: `${subjectLabel(subjectCanonicalId)} ${drawdownText}% TVL drawdown in 24h (${spec.version}, threshold ${spec.absZ}%)`,
    series: [prior, last],
  };
}

export function detectTvlDrawdownForSubject(
  subjectCanonicalId: string,
  points: readonly SeriesPoint[],
  spec: DetectorSpec = TVL_DRAWDOWN_V1,
): DetectorFinding | undefined {
  return detectTvlDrawdown(points, spec, subjectCanonicalId);
}

export function detectPegDeviation(
  basisPoints: readonly SeriesPoint[],
  spotPoints: readonly SeriesPoint[] = [],
  spec: DetectorSpec = PEG_DEVIATION_V1,
  subjectCanonicalId = "",
): DetectorFinding | undefined {
  const ordered = sortPoints(basisPoints);
  const prev = ordered[ordered.length - 2];
  const last = ordered[ordered.length - 1];
  if (!prev || !last) {
    return undefined;
  }
  const gap = last.observedAt.getTime() - prev.observedAt.getTime();
  if (gap <= 0 || gap > spec.maxGapMs) {
    return undefined;
  }
  if (Math.abs(prev.value) <= spec.absZ || Math.abs(last.value) <= spec.absZ) {
    return undefined;
  }
  if (Math.sign(prev.value) !== Math.sign(last.value)) {
    return undefined;
  }
  const spot = sortPoints(spotPoints).at(-1);
  if (!spot || !Number.isFinite(spot.value)) {
    return undefined;
  }
  const spotBasis = (spot.value - 1) * 100;
  if (!Number.isFinite(spotBasis) || Math.abs(spotBasis) <= spec.absZ) {
    return undefined;
  }
  if (Math.sign(spotBasis) !== Math.sign(last.value)) {
    return undefined;
  }
  const polarity = last.value > 0 ? "up" : "down";
  const basisText = Math.abs(last.value).toFixed(2);
  return {
    detectorId: spec.id,
    version: spec.version,
    metric: spec.metric,
    claimKind: spec.claimKind,
    subjectCanonicalId,
    zScore: last.value,
    value: last.value,
    unit: "percent",
    polarity,
    thresholdAbsZ: spec.absZ,
    sampleCount: 2,
    windowStart: prev.observedAt,
    windowEnd: last.observedAt,
    bodyText: `${spec.id}.${spec.version} on ${subjectCanonicalId}: basis ${prev.value.toFixed(2)}% then ${last.value.toFixed(2)}% (threshold ${spec.absZ}%), corroborated by spot ${spot.value} usd (${spotBasis.toFixed(2)}%).`,
    claimTitle: `${subjectLabel(subjectCanonicalId)} ${basisText}% peg deviation (${spec.version}, threshold ${spec.absZ}%, corroborated)`,
    series: [prev, last],
  };
}

export function detectPegDeviationForSubject(
  subjectCanonicalId: string,
  basisPoints: readonly SeriesPoint[],
  spotPoints: readonly SeriesPoint[] = [],
  spec: DetectorSpec = PEG_DEVIATION_V1,
): DetectorFinding | undefined {
  return detectPegDeviation(basisPoints, spotPoints, spec, subjectCanonicalId);
}

export function seriesPointsFromObservations(
  rows: readonly SeriesObservation[],
  metric: string,
  subjectCanonicalId: string,
): SeriesPoint[] {
  return rows
    .filter(
      (row) =>
        row.metric === metric &&
        row.subjectCanonicalId === subjectCanonicalId &&
        Number.isFinite(row.value),
    )
    .map((row) => ({ observedAt: row.observedAt, value: row.value }));
}

function contiguousTail(points: readonly SeriesPoint[], maxGapMs: number): SeriesPoint[] {
  const ordered = sortPoints(points);
  const contiguous: SeriesPoint[] = [];
  for (const point of ordered) {
    const prev = contiguous[contiguous.length - 1];
    if (prev) {
      const gap = point.observedAt.getTime() - prev.observedAt.getTime();
      if (gap <= 0 || gap > maxGapMs) {
        contiguous.length = 0;
      }
    }
    contiguous.push(point);
  }
  return contiguous;
}

export function detectMarketStress(
  input: {
    fundingApr?: readonly SeriesPoint[];
    openInterestUsd?: readonly SeriesPoint[];
    liquidations1mUsd?: readonly SeriesPoint[];
  },
  spec: DetectorSpec = MARKET_STRESS_V1,
  subjectCanonicalId = "",
): DetectorFinding | undefined {
  const minSamples = spec.window;
  const fundingWindow = spec.fundingWindow ?? MARKET_STRESS_FUNDING_WINDOW;
  const funding = contiguousTail(input.fundingApr ?? [], spec.maxGapMs);
  if (funding.length >= minSamples) {
    const windowPoints = funding.slice(-Math.min(fundingWindow, funding.length));
    if (windowPoints.length >= minSamples) {
      const z = zScore(windowPoints.map((item) => item.value));
      const last = windowPoints[windowPoints.length - 1];
      if (z !== undefined && last) {
        const hit = finding({
          spec,
          subjectCanonicalId,
          z,
          series: windowPoints,
          unit: "percent",
          lastValue: last.value,
          sampleCount: windowPoints.length,
        });
        if (hit) {
          return hit;
        }
      }
    }
  }
  const oi = sortPoints(input.openInterestUsd ?? []);
  const lastOi = oi[oi.length - 1];
  const oiChangePct = spec.oiChangePct ?? DEFAULT_OI_CHANGE_PCT;
  if (lastOi && lastOi.value > 0) {
    const target = lastOi.observedAt.getTime() - OI_CHANGE_LOOKBACK_MS;
    let prior: SeriesPoint | undefined;
    let best = Number.POSITIVE_INFINITY;
    for (const point of oi.slice(0, -1)) {
      const delta = Math.abs(point.observedAt.getTime() - target);
      if (delta <= OI_CHANGE_MAX_GAP_MS && delta < best) {
        best = delta;
        prior = point;
      }
    }
    if (prior && prior.value > 0) {
      const changePct = ((lastOi.value - prior.value) / prior.value) * 100;
      if (Number.isFinite(changePct) && Math.abs(changePct) >= oiChangePct) {
        const polarity = changePct > 0 ? "up" : "down";
        const changeText = Math.abs(changePct).toFixed(2);
        return {
          detectorId: spec.id,
          version: spec.version,
          metric: "open_interest_usd",
          claimKind: spec.claimKind,
          subjectCanonicalId,
          zScore: changePct,
          value: lastOi.value,
          unit: "percent",
          polarity,
          thresholdAbsZ: oiChangePct,
          sampleCount: 2,
          windowStart: prior.observedAt,
          windowEnd: lastOi.observedAt,
          bodyText: `${spec.id}.${spec.version} on ${subjectCanonicalId}: open interest usd ${prior.value} → ${lastOi.value} (${changePct.toFixed(2)}% in 1h, threshold ${oiChangePct}%).`,
          claimTitle: `${subjectLabel(subjectCanonicalId)} ${changeText}% open interest ${polarity} in 1h (${spec.version}, threshold ${oiChangePct}%)`,
          series: [prior, lastOi],
        };
      }
    }
  }
  const burst = spec.liquidationBurstUsd ?? DEFAULT_LIQUIDATION_BURST_USD;
  const liquidations = sortPoints(input.liquidations1mUsd ?? []);
  const lastLiq = liquidations[liquidations.length - 1];
  if (lastLiq && lastLiq.value >= burst) {
    return {
      detectorId: spec.id,
      version: spec.version,
      metric: "liquidations_1m_usd",
      claimKind: spec.claimKind,
      subjectCanonicalId,
      zScore: lastLiq.value,
      value: lastLiq.value,
      unit: "usd",
      polarity: "up",
      thresholdAbsZ: burst,
      sampleCount: 1,
      windowStart: lastLiq.observedAt,
      windowEnd: lastLiq.observedAt,
      bodyText: `${spec.id}.${spec.version} on ${subjectCanonicalId}: liquidations ${lastLiq.value} usd in 1m (threshold ${burst} usd).`,
      claimTitle: `${subjectLabel(subjectCanonicalId)} ${lastLiq.value} usd 1m liquidations (${spec.version}, threshold ${burst} usd)`,
      series: [lastLiq],
    };
  }
  return undefined;
}

export function detectMarketStressForSubject(
  subjectCanonicalId: string,
  input: {
    fundingApr?: readonly SeriesPoint[];
    openInterestUsd?: readonly SeriesPoint[];
    liquidations1mUsd?: readonly SeriesPoint[];
  },
  spec: DetectorSpec = MARKET_STRESS_V1,
): DetectorFinding | undefined {
  return detectMarketStress(input, spec, subjectCanonicalId);
}

export function detectFundingDivergence(
  leftApr: readonly SeriesPoint[],
  rightApr: readonly SeriesPoint[],
  spec: DetectorSpec = FUNDING_DIVERGENCE_V1,
  subjectCanonicalId = "",
): DetectorFinding | undefined {
  const left = sortPoints(leftApr).at(-1);
  const right = sortPoints(rightApr).at(-1);
  if (!left || !right) {
    return undefined;
  }
  const gap = Math.abs(left.observedAt.getTime() - right.observedAt.getTime());
  if (gap > spec.maxGapMs) {
    return undefined;
  }
  const diff = left.value - right.value;
  if (!Number.isFinite(diff) || Math.abs(diff) <= spec.absZ) {
    return undefined;
  }
  const polarity = diff > 0 ? "up" : "down";
  const start = left.observedAt <= right.observedAt ? left.observedAt : right.observedAt;
  const end = left.observedAt >= right.observedAt ? left.observedAt : right.observedAt;
  const diffText = Math.abs(diff).toFixed(2);
  return {
    detectorId: spec.id,
    version: spec.version,
    metric: spec.metric,
    claimKind: spec.claimKind,
    subjectCanonicalId,
    zScore: diff,
    value: diff,
    unit: "percent",
    polarity,
    thresholdAbsZ: spec.absZ,
    sampleCount: 2,
    windowStart: start,
    windowEnd: end,
    bodyText: `${spec.id}.${spec.version} on ${subjectCanonicalId}: funding APR ${left.value.toFixed(2)}% vs ${right.value.toFixed(2)}% (diff ${diff.toFixed(2)} pp, threshold ${spec.absZ} pp).`,
    claimTitle: `${subjectLabel(subjectCanonicalId)} ${diffText} pp funding APR divergence (${spec.version}, threshold ${spec.absZ} pp)`,
    series: [left, right],
  };
}

export function detectFundingDivergenceForSubject(
  subjectCanonicalId: string,
  leftApr: readonly SeriesPoint[],
  rightApr: readonly SeriesPoint[],
  spec: DetectorSpec = FUNDING_DIVERGENCE_V1,
): DetectorFinding | undefined {
  return detectFundingDivergence(leftApr, rightApr, spec, subjectCanonicalId);
}

export function detectorEvidenceFingerprint(finding: DetectorFinding): string {
  return [
    "observation",
    finding.detectorId,
    finding.version,
    finding.subjectCanonicalId,
    finding.polarity,
  ].join("|");
}

export function isObservedAnomalyKind(kind: string): boolean {
  return /:observed_[a-z0-9_]+_anomaly$/.test(kind);
}

export const OBSERVATION_SERIES_ORIGIN_KEY = "observation:polled_series";
