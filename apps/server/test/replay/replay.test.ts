import {
  DEFAULT_DETECTOR_WINDOW,
  detectorEvidenceFingerprint,
  detectReturnShock,
  detectReturnShockForSubject,
  detectVolumeAnomalyForSubject,
} from "@riddlr/domain";
import { describe, expect, it } from "vitest";
import {
  downsampleRawToDaily,
  minuteSeries,
  persistingFingerprints,
  REPLAY_LOAD_PROVIDERS,
  REPLAY_LOAD_SUBJECTS,
  REPLAY_LOAD_WINDOW,
  replayClusters,
  replayJoin,
  replayLeadTime,
  replayScorecard,
  retentionDeleteBatches,
  runObserveLoadBenchmark,
} from "./harness.js";

const FIRST = new Date("2026-09-14T08:00:00.000Z");
const THIRTY_MIN = new Date("2026-09-14T08:30:00.000Z");
const FOUR_HOURS = new Date("2026-09-14T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

describe("detector replay", () => {
  it("replays a 10% last return as a versioned return-shock finding", () => {
    const points = minuteSeries([
      ...Array.from({ length: DEFAULT_DETECTOR_WINDOW }, () => 100),
      110,
    ]);
    const hit = detectReturnShockForSubject("coingecko:bitcoin", points);
    expect(hit?.version).toBe("v1");
    expect(hit?.polarity).toBe("up");
    expect(hit?.sampleCount).toBe(20);
    expect(hit?.zScore).toBeCloseTo(19 / Math.sqrt(20), 10);
    expect(hit?.claimTitle).toBe("bitcoin 4.25σ spot price return shock (v1, threshold 3σ)");
    if (!hit) {
      throw new Error("expected a return-shock finding");
    }
    expect(detectorEvidenceFingerprint(hit)).toBe(
      "observation|return_shock|v1|coingecko:bitcoin|up",
    );
  });

  it("emits nothing with an insufficient window", () => {
    expect(detectReturnShock(minuteSeries([100, 110, 120]))).toBeUndefined();
  });

  it("emits nothing on a constant series", () => {
    expect(
      detectReturnShock(
        minuteSeries(Array.from({ length: DEFAULT_DETECTOR_WINDOW + 1 }, () => 100)),
      ),
    ).toBeUndefined();
  });

  it("dedupes a persisting anomaly to one detector-subject-polarity fingerprint", () => {
    const points = minuteSeries([
      ...Array.from({ length: DEFAULT_DETECTOR_WINDOW }, () => 100),
      110,
    ]);
    const first = detectReturnShockForSubject("coingecko:bitcoin", points);
    const second = detectReturnShockForSubject("coingecko:bitcoin", points);
    expect(first && second).toBeTruthy();
    if (!first || !second) {
      throw new Error("expected two findings");
    }
    expect(persistingFingerprints([first, second])).toEqual([
      "observation|return_shock|v1|coingecko:bitcoin|up",
    ]);
  });

  it("treats a reversed polarity as a second fingerprint", () => {
    const up = detectReturnShockForSubject(
      "coingecko:bitcoin",
      minuteSeries([...Array.from({ length: DEFAULT_DETECTOR_WINDOW }, () => 100), 110]),
    );
    const down = detectReturnShockForSubject(
      "coingecko:bitcoin",
      minuteSeries([...Array.from({ length: DEFAULT_DETECTOR_WINDOW }, () => 100), 90]),
    );
    expect(up?.polarity).toBe("up");
    expect(down?.polarity).toBe("down");
    if (!up || !down) {
      throw new Error("expected both polarities");
    }
    expect(detectorEvidenceFingerprint(up)).not.toBe(detectorEvidenceFingerprint(down));
  });

  it("clusters two detector findings on one asset into one event", () => {
    const shock = detectReturnShockForSubject(
      "coingecko:bitcoin",
      minuteSeries([...Array.from({ length: DEFAULT_DETECTOR_WINDOW }, () => 100), 110]),
    );
    const volume = detectVolumeAnomalyForSubject(
      "coingecko:bitcoin",
      minuteSeries([...Array.from({ length: DEFAULT_DETECTOR_WINDOW - 1 }, () => 10), 100]),
    );
    if (!shock || !volume) {
      throw new Error("expected shock and volume findings");
    }
    const clusters = replayClusters([
      {
        id: "shock",
        assetCanonicalIds: ["coingecko:bitcoin"],
        text: shock.bodyText,
        sourceFamily: "observation",
        publishedAt: shock.windowEnd,
      },
      {
        id: "volume",
        assetCanonicalIds: ["coingecko:bitcoin"],
        text: volume.bodyText,
        sourceFamily: "observation",
        publishedAt: volume.windowEnd,
      },
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.map((item) => item.id).sort()).toEqual(["shock", "volume"]);
  });
});

describe("evidence timeline replay", () => {
  it("clusters a transfer, independent write-up, and official status on one claim", () => {
    const clusters = replayClusters([
      {
        id: "tx",
        assetCanonicalIds: ["coingecko:bitcoin"],
        text: "Large transfer of 40 million to a labeled exchange wallet.",
        sourceFamily: "observation",
        publishedAt: FIRST,
        claimFingerprints: ["bridge-drain"],
        marketDomainId: "crypto",
      },
      {
        id: "writeup",
        assetCanonicalIds: ["coingecko:bitcoin"],
        text: "Independent write-up of the bridge drain after the transfer.",
        sourceFamily: "search",
        publishedAt: THIRTY_MIN,
        claimFingerprints: ["bridge-drain"],
        marketDomainId: "crypto",
      },
      {
        id: "status",
        assetCanonicalIds: ["coingecko:bitcoin"],
        text: "Issuer status page confirmed the bridge drain.",
        sourceFamily: "feed",
        publishedAt: FOUR_HOURS,
        claimFingerprints: ["bridge-drain"],
        marketDomainId: "crypto",
      },
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.map((item) => item.id)).toEqual(["tx", "writeup", "status"]);
  });

  it("joins an open security_incident inside 72h and opens a new event after the window", () => {
    expect(
      replayJoin({
        clusterAt: new Date(FIRST.getTime() + 71 * HOUR_MS),
        eventFirstObservedAt: FIRST,
        eventLifecycle: "open",
        catalystKind: "security_incident",
        sharedClaimFingerprint: true,
        shingleMatch: false,
        scheduledAtChanged: false,
      }),
    ).toBe("join");
    expect(
      replayJoin({
        clusterAt: new Date(FIRST.getTime() + 73 * HOUR_MS),
        eventFirstObservedAt: FIRST,
        eventLifecycle: "open",
        catalystKind: "security_incident",
        sharedClaimFingerprint: true,
        shingleMatch: false,
        scheduledAtChanged: false,
      }),
    ).toBe("new");
  });

  it("does not reopen a resolved duration event", () => {
    expect(
      replayJoin({
        clusterAt: FOUR_HOURS,
        eventFirstObservedAt: FIRST,
        eventLifecycle: "resolved",
        catalystKind: "security_incident",
        sharedClaimFingerprint: true,
        shingleMatch: false,
        scheduledAtChanged: false,
      }),
    ).toBe("new");
  });

  it("reopens a scheduled token_unlock when the date changes", () => {
    expect(
      replayJoin({
        clusterAt: new Date("2026-10-02T00:00:00.000Z"),
        eventFirstObservedAt: FIRST,
        eventLifecycle: "resolved",
        catalystKind: "token_unlock",
        scheduledAt: new Date("2026-09-20T00:00:00.000Z"),
        sharedClaimFingerprint: true,
        shingleMatch: false,
        scheduledAtChanged: true,
      }),
    ).toBe("reopen");
  });

  it("measures lead time as firstPrimaryAt minus firstObservedAt", () => {
    const lead = replayLeadTime([
      { publishedAt: FIRST, trustTier: "community" },
      { publishedAt: THIRTY_MIN, trustTier: "known_analyst" },
      { publishedAt: FOUR_HOURS, trustTier: "official_firsthand" },
    ]);
    expect(lead.hours).toBe(4);
  });

  it("reports scorecard precision as later confirmed over signals emitted", () => {
    const facts = [
      {
        agentId: "agent-1",
        catalystKind: "security_incident",
        sourceIdentityId: "id-1",
        emitted: true,
        laterConfirmed: true,
        laterRetracted: false,
        leadTimeHours: 4,
      },
      {
        agentId: "agent-1",
        catalystKind: "security_incident",
        sourceIdentityId: "id-1",
        emitted: true,
        laterConfirmed: true,
        laterRetracted: false,
        leadTimeHours: 4,
      },
      {
        agentId: "agent-1",
        catalystKind: "security_incident",
        sourceIdentityId: "id-1",
        emitted: true,
        laterConfirmed: false,
        laterRetracted: true,
        leadTimeHours: 2,
      },
      {
        agentId: "agent-1",
        catalystKind: "security_incident",
        sourceIdentityId: "id-1",
        emitted: true,
        laterConfirmed: false,
        laterRetracted: false,
        leadTimeHours: 2,
      },
    ] as const;
    const scorecard = replayScorecard(facts);
    expect(scorecard.precision).toBe(0.5);
    expect(scorecard.rows[0]?.precision).toBe(0.5);
    expect(scorecard.rows[0]?.signalsEmitted).toBe(4);
    expect(scorecard.rows[0]?.laterConfirmed).toBe(2);
  });
});

describe("retention downsample replay", () => {
  it("keeps the last value of each UTC day", () => {
    const daily = downsampleRawToDaily([
      { observedAt: new Date("2026-09-01T01:00:00.000Z"), value: 1, unit: "usd" },
      { observedAt: new Date("2026-09-01T23:00:00.000Z"), value: 2, unit: "usd" },
      { observedAt: new Date("2026-09-02T00:00:00.000Z"), value: 3, unit: "usd" },
    ]);
    expect(daily).toEqual([
      {
        dayUtc: "2026-09-01",
        observedAt: new Date("2026-09-01T00:00:00.000Z"),
        value: 2,
        unit: "usd",
      },
      {
        dayUtc: "2026-09-02",
        observedAt: new Date("2026-09-02T00:00:00.000Z"),
        value: 3,
        unit: "usd",
      },
    ]);
  });

  it("caps retention deletes at 5,000 rows and 40 loops", () => {
    expect(retentionDeleteBatches(100_000)).toBe(20);
    expect(retentionDeleteBatches(250_000)).toBe(40);
    expect(retentionDeleteBatches(0)).toBe(0);
  });
});

describe("observation load replay", () => {
  it("records RSS for 1,000 subjects across five recorded providers", () => {
    const result = runObserveLoadBenchmark();
    expect(result.subjects).toBe(REPLAY_LOAD_SUBJECTS);
    expect(result.providers).toBe(REPLAY_LOAD_PROVIDERS);
    expect(result.windowPoints).toBe(REPLAY_LOAD_WINDOW);
    expect(result.parsed.coinGeckoBtcSpot).toBe(77333);
    expect(result.parsed.hyperliquidBtcMark).toBe(78540.9);
    expect(result.parsed.defiLlamaAaveTvl).toBe(18218792583);
    expect(result.parsed.polymarketMid).toBe(0.905);
    expect(result.parsed.binanceBtcMark).toBe(78732.5);
    expect(result.returnShocks).toBe(1_000);
    expect(result.volumeHits).toBe(1_000);
    expect(result.tvlHits).toBe(1_000);
    expect(result.oiHits).toBe(1_000);
    expect(result.oddsHits).toBe(1_000);
    expect(result.dailyPoints).toBe(2_000);
    expect(result.retentionBatchesFor100k).toBe(20);
    expect(result.after.rss).toBeGreaterThan(0);
    expect(result.after.peakRss).toBeGreaterThanOrEqual(result.after.rss);
  });
});
