import {
  DEFAULT_DETECTOR_ABS_Z,
  DEFAULT_DETECTOR_WINDOW,
  DEFAULT_PEG_DEVIATION_PCT,
  DEFAULT_TVL_DRAWDOWN_FLOOR_USD,
  DEFAULT_TVL_DRAWDOWN_PCT,
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
