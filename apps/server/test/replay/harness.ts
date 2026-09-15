import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  absorbObservationClusters,
  aggregateScorecard,
  type CatalystKind,
  type ClusterableEvidence,
  type ClusterJoinDecision,
  clusterEvidence,
  clusterJoinsEvent,
  DEFAULT_DETECTOR_WINDOW,
  DEFAULT_OBSERVE_MAX_SUBJECTS,
  type DetectorFinding,
  detectMarketStressForSubject,
  detectOddsJumpForSubject,
  detectorEvidenceFingerprint,
  detectReturnShockForSubject,
  detectTvlDrawdownForSubject,
  detectVolumeAnomalyForSubject,
  eventJoinWindowForKind,
  isPrimaryLeadTier,
  type LifecycleState,
  leadTimeHours,
  MAX_RETENTION_DELETE_BATCH,
  MAX_RETENTION_LOOPS,
  MAX_SERIES_WINDOW,
  type ScorecardFacts,
  type ScorecardRow,
  type SeriesPoint,
  scorecardPrecision,
  type TrustTier,
  takeBounded,
  utcDayRange,
  utcDayStamp,
} from "@riddlr/domain";
import { snapshotProcessMemory } from "@riddlr/observability";
import {
  parseCoinGeckoSimplePrice,
  parseDefiLlamaProtocolDetail,
  parseMetaAndAssetCtxs,
  parseMidpoint,
  parsePremiumIndex,
  parseQuoteAssets,
} from "@riddlr/source-adapters";

const fixturesRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/source-adapters/test/fixtures",
);

export const REPLAY_LOAD_SUBJECTS = DEFAULT_OBSERVE_MAX_SUBJECTS;
export const REPLAY_LOAD_PROVIDERS = 5;
export const REPLAY_LOAD_WINDOW = DEFAULT_DETECTOR_WINDOW + 1;

function readJson(provider: string, name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesRoot, provider, name), "utf8")) as unknown;
}

export function minuteSeries(
  values: readonly number[],
  start = "2026-09-13T12:00:00.000Z",
  stepMs = 60_000,
): SeriesPoint[] {
  const origin = new Date(start).getTime();
  return values.map((value, index) => ({
    observedAt: new Date(origin + index * stepMs),
    value,
  }));
}

export type RawSeriesPoint = {
  observedAt: Date;
  value: number;
  unit: string;
};

export type DailySeriesPoint = {
  dayUtc: string;
  observedAt: Date;
  value: number;
  unit: string;
};

export function downsampleRawToDaily(points: readonly RawSeriesPoint[]): DailySeriesPoint[] {
  const bounded = takeBounded(points, MAX_SERIES_WINDOW);
  const latest = new Map<string, RawSeriesPoint>();
  for (const point of bounded) {
    const dayUtc = utcDayStamp(point.observedAt);
    const current = latest.get(dayUtc);
    if (!current || point.observedAt.getTime() >= current.observedAt.getTime()) {
      latest.set(dayUtc, point);
    }
  }
  return [...latest.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dayUtc, point]) => ({
      dayUtc,
      observedAt: utcDayRange(dayUtc).start,
      value: point.value,
      unit: point.unit,
    }));
}

export function retentionDeleteBatches(rawCount: number): number {
  if (rawCount <= 0) {
    return 0;
  }
  return Math.min(Math.ceil(rawCount / MAX_RETENTION_DELETE_BATCH), MAX_RETENTION_LOOPS);
}

export function replayClusters<T extends ClusterableEvidence>(items: readonly T[]): T[][] {
  const { clusters, remainder } = clusterEvidence(items);
  const absorbed = absorbObservationClusters(
    remainder.length > 0 ? [...clusters, remainder] : clusters,
  );
  return absorbed;
}

export function replayJoin(input: {
  clusterAt: Date;
  eventFirstObservedAt: Date;
  eventLifecycle: LifecycleState;
  catalystKind: CatalystKind;
  sharedClaimFingerprint: boolean;
  shingleMatch: boolean;
  scheduledAtChanged: boolean;
  scheduledAt?: Date;
}): ClusterJoinDecision {
  return clusterJoinsEvent({
    clusterAt: input.clusterAt,
    eventFirstObservedAt: input.eventFirstObservedAt,
    eventLifecycle: input.eventLifecycle,
    window: eventJoinWindowForKind(input.catalystKind),
    scheduledAt: input.scheduledAt,
    sharedClaimFingerprint: input.sharedClaimFingerprint,
    shingleMatch: input.shingleMatch,
    scheduledAtChanged: input.scheduledAtChanged,
    catalystKind: input.catalystKind,
  });
}

export type ReplayLeadItem = {
  publishedAt: Date;
  trustTier: TrustTier;
};

export function replayLeadTime(items: readonly ReplayLeadItem[]): {
  firstObservedAt: Date | undefined;
  firstPrimaryAt: Date | undefined;
  hours: number | undefined;
} {
  const ordered = [...items].sort(
    (left, right) => left.publishedAt.getTime() - right.publishedAt.getTime(),
  );
  const firstObservedAt = ordered[0]?.publishedAt;
  const firstPrimaryAt = ordered.find((item) => isPrimaryLeadTier(item.trustTier))?.publishedAt;
  return {
    firstObservedAt,
    firstPrimaryAt,
    hours: leadTimeHours(firstObservedAt, firstPrimaryAt),
  };
}

export function replayScorecard(facts: readonly ScorecardFacts[]): {
  precision: number | undefined;
  rows: ScorecardRow[];
} {
  const emitted = facts.filter((row) => row.emitted).length;
  const laterConfirmed = facts.filter((row) => row.emitted && row.laterConfirmed).length;
  return {
    precision: scorecardPrecision(emitted, laterConfirmed),
    rows: aggregateScorecard(facts),
  };
}

export function persistingFingerprints(findings: readonly DetectorFinding[]): string[] {
  return [...new Set(findings.map((hit) => detectorEvidenceFingerprint(hit)))];
}

export type ObserveLoadResult = {
  subjects: number;
  providers: number;
  windowPoints: number;
  parsed: {
    coinGeckoBtcSpot: number | undefined;
    hyperliquidBtcMark: number | undefined;
    defiLlamaAaveTvl: number | undefined;
    polymarketMid: number | undefined;
    binanceBtcMark: number | undefined;
  };
  returnShocks: number;
  volumeHits: number;
  tvlHits: number;
  oiHits: number;
  oddsHits: number;
  dailyPoints: number;
  retentionBatchesFor100k: number;
  before: ReturnType<typeof snapshotProcessMemory>;
  after: ReturnType<typeof snapshotProcessMemory>;
};

export function runObserveLoadBenchmark(): ObserveLoadResult {
  const before = snapshotProcessMemory();
  const fetchedAt = new Date("2026-09-14T16:00:00.000Z");
  const watched = new Set(["coingecko:bitcoin"]);
  const symbolMap = { BTC: "coingecko:bitcoin", ETH: "coingecko:ethereum" };
  const quotes = parseQuoteAssets(undefined);

  const coinGecko = parseCoinGeckoSimplePrice(
    readJson("coingecko", "simple-price.json"),
    ["bitcoin", "ethereum", "tether"],
    fetchedAt,
  );
  const hyperliquid = parseMetaAndAssetCtxs(readJson("hyperliquid", "meta-and-asset-ctxs.json"), {
    symbolMap,
    watched,
    fetchedAt,
  });
  const defiLlama = parseDefiLlamaProtocolDetail(
    readJson("defillama", "protocol-aave.json"),
    "aave",
    "coingecko:aave",
    fetchedAt,
  );
  const polymarketMid = parseMidpoint(readJson("polymarket", "midpoint.json"));
  const binance = parsePremiumIndex(readJson("binance-futures", "premium-index.json"), {
    symbolMap,
    watched,
    quotes,
    fetchedAt,
  });

  const shock = minuteSeries([...Array.from({ length: DEFAULT_DETECTOR_WINDOW }, () => 100), 110]);
  const volume = minuteSeries([
    ...Array.from({ length: DEFAULT_DETECTOR_WINDOW - 1 }, () => 10),
    100,
  ]);
  const tvlStart = new Date("2026-09-13T12:00:00.000Z");
  const tvl = [
    { observedAt: tvlStart, value: 100_000_000 },
    { observedAt: new Date(tvlStart.getTime() + 24 * 60 * 60 * 1000), value: 80_000_000 },
  ];
  const oiStart = new Date("2026-09-13T12:00:00.000Z");
  const openInterestUsd = [
    { observedAt: oiStart, value: 100 },
    { observedAt: new Date(oiStart.getTime() + 60 * 60 * 1000), value: 79 },
  ];
  const oddsStart = new Date("2026-09-14T15:00:00.000Z");
  const oddsYes = [
    { observedAt: oddsStart, value: 0.5 },
    { observedAt: new Date(oddsStart.getTime() + 60 * 60 * 1000), value: 0.66 },
  ];

  let returnShocks = 0;
  let volumeHits = 0;
  let tvlHits = 0;
  let oiHits = 0;
  let oddsHits = 0;
  let dailyPoints = 0;
  const hourMs = 60 * 60 * 1000;
  const downsampleOrigin = new Date("2026-09-01T00:00:00.000Z").getTime();

  for (let index = 0; index < REPLAY_LOAD_SUBJECTS; index += 1) {
    const subject = `coingecko:load-${index}`;
    if (detectReturnShockForSubject(subject, shock)) {
      returnShocks += 1;
    }
    if (detectVolumeAnomalyForSubject(subject, volume)) {
      volumeHits += 1;
    }
    if (detectTvlDrawdownForSubject(subject, tvl)) {
      tvlHits += 1;
    }
    if (detectMarketStressForSubject(subject, { openInterestUsd })) {
      oiHits += 1;
    }
    if (detectOddsJumpForSubject(`polymarket:load-${index}`, { oddsYes, liquidityUsd: 10_000 })) {
      oddsHits += 1;
    }
    const raw: RawSeriesPoint[] = [];
    for (let hour = 0; hour < 48; hour += 1) {
      raw.push({
        observedAt: new Date(downsampleOrigin + hour * hourMs),
        value: hour + 1,
        unit: "usd",
      });
    }
    dailyPoints += downsampleRawToDaily(raw).length;
  }

  const after = snapshotProcessMemory();
  return {
    subjects: REPLAY_LOAD_SUBJECTS,
    providers: REPLAY_LOAD_PROVIDERS,
    windowPoints: REPLAY_LOAD_WINDOW,
    parsed: {
      coinGeckoBtcSpot: coinGecko.observations.find(
        (item) => item.subjectCanonicalId === "coingecko:bitcoin" && item.metric === "spot_price",
      )?.value,
      hyperliquidBtcMark: hyperliquid.observations.find(
        (item) => item.subjectCanonicalId === "coingecko:bitcoin" && item.metric === "mark_price",
      )?.value,
      defiLlamaAaveTvl: defiLlama.observations.find((item) => item.metric === "tvl_usd")?.value,
      polymarketMid: polymarketMid.value,
      binanceBtcMark: binance.observations.find(
        (item) => item.subjectCanonicalId === "coingecko:bitcoin" && item.metric === "mark_price",
      )?.value,
    },
    returnShocks,
    volumeHits,
    tvlHits,
    oiHits,
    oddsHits,
    dailyPoints,
    retentionBatchesFor100k: retentionDeleteBatches(100_000),
    before,
    after,
  };
}
