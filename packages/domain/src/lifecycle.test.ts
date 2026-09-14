import { describe, expect, it } from "vitest";
import { CLUSTER_WINDOW_MS } from "./cluster.js";
import type { RegistryAsset } from "./domain-module.js";
import {
  aggregateScorecard,
  canonicalEvent,
  clusterJoinsEvent,
  clusterShingleMatch,
  DEFAULT_EVENT_JOIN_WINDOWS,
  eventIdentityKey,
  eventJoinWindowForKind,
  identityKeysForSubject,
  isPrimaryLeadTier,
  leadTimeHours,
  leadTimeMs,
  medianNumber,
  nearestSeriesPoint,
  nextLifecycleState,
  observationDelta,
  parseScheduledAt,
  reopenResolvedEvent,
  scorecardPrecision,
  subjectAliasIds,
  unlabeledJoinWindow,
  windowElapsed,
  withinJoinWindow,
} from "./lifecycle.js";

const FIRST = new Date("2026-09-14T08:00:00.000Z");
const FOUR_HOURS = new Date("2026-09-14T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

function registryAsset(canonicalId: string, aliases: string[]): RegistryAsset {
  return {
    assetClass: "cryptocurrency",
    canonicalId,
    aliases,
    externalIds: {},
    status: "active",
  };
}

describe("event join windows", () => {
  it("uses 72h for security_incident and 24h for market_stress", () => {
    expect(eventJoinWindowForKind("security_incident")).toEqual({
      kind: "duration",
      ms: 72 * HOUR_MS,
    });
    expect(eventJoinWindowForKind("market_stress")).toEqual({
      kind: "duration",
      ms: 24 * HOUR_MS,
    });
    expect(eventJoinWindowForKind("token_unlock")).toEqual({ kind: "until_execution" });
    expect(DEFAULT_EVENT_JOIN_WINDOWS.governance_proposal).toEqual({ kind: "until_execution" });
    expect(unlabeledJoinWindow()).toEqual({ kind: "duration", ms: CLUSTER_WINDOW_MS });
  });

  it("joins an open security incident inside 72h and opens a new event after the window", () => {
    const window = eventJoinWindowForKind("security_incident");
    expect(
      clusterJoinsEvent({
        clusterAt: new Date(FIRST.getTime() + 71 * HOUR_MS),
        eventFirstObservedAt: FIRST,
        eventLifecycle: "open",
        window,
        sharedClaimFingerprint: true,
        shingleMatch: false,
        scheduledAtChanged: false,
        catalystKind: "security_incident",
      }),
    ).toBe("join");
    expect(
      clusterJoinsEvent({
        clusterAt: new Date(FIRST.getTime() + 73 * HOUR_MS),
        eventFirstObservedAt: FIRST,
        eventLifecycle: "open",
        window,
        sharedClaimFingerprint: true,
        shingleMatch: false,
        scheduledAtChanged: false,
        catalystKind: "security_incident",
      }),
    ).toBe("new");
  });

  it("does not join without a shared claim fingerprint or shingle match", () => {
    expect(
      clusterJoinsEvent({
        clusterAt: FIRST,
        eventFirstObservedAt: FIRST,
        eventLifecycle: "open",
        window: eventJoinWindowForKind("security_incident"),
        sharedClaimFingerprint: false,
        shingleMatch: false,
        scheduledAtChanged: false,
        catalystKind: "security_incident",
      }),
    ).toBe("new");
    expect(
      clusterShingleMatch(
        "Issuer confirmed a bridge drain of 40 million after the exploit.",
        "Issuer confirmed a bridge drain of 40 million after the exploit!",
      ),
    ).toBe(true);
  });

  it("does not reopen a resolved duration event and reopens a scheduled event when the date changes", () => {
    expect(
      reopenResolvedEvent({
        kind: "security_incident",
        scheduledAtChanged: false,
        sameClaimFingerprint: true,
      }),
    ).toBe(false);
    expect(
      clusterJoinsEvent({
        clusterAt: new Date("2026-10-02T00:00:00.000Z"),
        eventFirstObservedAt: FIRST,
        eventLifecycle: "resolved",
        window: eventJoinWindowForKind("token_unlock"),
        scheduledAt: new Date("2026-09-20T00:00:00.000Z"),
        sharedClaimFingerprint: true,
        shingleMatch: false,
        scheduledAtChanged: true,
        catalystKind: "token_unlock",
      }),
    ).toBe("reopen");
    expect(
      clusterJoinsEvent({
        clusterAt: FOUR_HOURS,
        eventFirstObservedAt: FIRST,
        eventLifecycle: "resolved",
        window: eventJoinWindowForKind("security_incident"),
        sharedClaimFingerprint: true,
        shingleMatch: false,
        scheduledAtChanged: false,
        catalystKind: "security_incident",
      }),
    ).toBe("new");
  });

  it("keeps an until-execution event joinable until the scheduled instant", () => {
    const scheduledAt = new Date("2026-09-20T00:00:00.000Z");
    expect(
      withinJoinWindow({
        clusterAt: new Date("2026-09-19T23:00:00.000Z"),
        firstObservedAt: FIRST,
        window: eventJoinWindowForKind("token_unlock"),
        scheduledAt,
      }),
    ).toBe(true);
    expect(
      windowElapsed({
        now: new Date("2026-09-20T00:00:01.000Z"),
        firstObservedAt: FIRST,
        window: eventJoinWindowForKind("token_unlock"),
        scheduledAt,
      }),
    ).toBe(true);
    expect(
      windowElapsed({
        now: new Date(FIRST.getTime() + 25 * HOUR_MS),
        firstObservedAt: FIRST,
        window: eventJoinWindowForKind("market_stress"),
      }),
    ).toBe(true);
  });
});

describe("event identity", () => {
  it("selects the older event as canonical when two open events share a key", () => {
    const older = {
      id: "b",
      firstObservedAt: new Date("2026-09-14T08:00:00.000Z"),
    };
    const newer = {
      id: "a",
      firstObservedAt: new Date("2026-09-14T09:00:00.000Z"),
    };
    expect(canonicalEvent([newer, older])?.id).toBe("b");
  });

  it("keys labeled events by domain, catalyst kind, and subject, not UTC day", () => {
    const first = eventIdentityKey({
      marketDomainId: "crypto",
      catalystKind: "security_incident",
      subjectCanonicalId: "coingecko:bitcoin",
    });
    const second = eventIdentityKey({
      marketDomainId: "crypto",
      catalystKind: "security_incident",
      subjectCanonicalId: "coingecko:bitcoin",
    });
    expect(first).toBe(second);
    expect(first).not.toBe(
      eventIdentityKey({
        marketDomainId: "crypto",
        catalystKind: "market_stress",
        subjectCanonicalId: "coingecko:bitcoin",
      }),
    );
  });

  it("matches a re-canonicalised subject through registry aliases", () => {
    const registry = [registryAsset("coingecko:btc", ["coingecko:bitcoin", "btc"])];
    expect(subjectAliasIds("coingecko:bitcoin", registry)).toContain("coingecko:btc");
    const keys = identityKeysForSubject({
      marketDomainId: "crypto",
      catalystKind: "security_incident",
      subjectCanonicalId: "coingecko:bitcoin",
      registry,
    });
    expect(keys).toContain(
      eventIdentityKey({
        marketDomainId: "crypto",
        catalystKind: "security_incident",
        subjectCanonicalId: "coingecko:btc",
      }),
    );
  });
});

describe("lifecycle transitions", () => {
  it("moves open to developing on a new independent origin and to confirmed on primary confirmation", () => {
    expect(
      nextLifecycleState({
        current: "open",
        retractingCount: 0,
        contradictingCount: 0,
        reliabilityStatus: "single_source",
        newIndependentOrigin: true,
      }),
    ).toEqual({ state: "developing", reason: "new_independent_origin" });
    expect(
      nextLifecycleState({
        current: "confirmed",
        retractingCount: 0,
        contradictingCount: 0,
        reliabilityStatus: "single_source",
        newIndependentOrigin: true,
      }),
    ).toEqual({ state: "confirmed", reason: "unchanged" });
  });

  it("records disputed when a retraction arrives before a confirmation", () => {
    expect(
      nextLifecycleState({
        current: "open",
        retractingCount: 1,
        contradictingCount: 0,
        reliabilityStatus: "retracted",
        newIndependentOrigin: false,
      }),
    ).toEqual({ state: "retracted", reason: "retracting_claim" });
    expect(
      nextLifecycleState({
        current: "retracted",
        retractingCount: 1,
        contradictingCount: 1,
        reliabilityStatus: "disputed",
        newIndependentOrigin: false,
      }),
    ).toEqual({ state: "disputed", reason: "retraction_and_confirmation" });
  });

  it("keeps superseded sticky and resolves after the join window elapses", () => {
    expect(
      nextLifecycleState({
        current: "open",
        superseded: true,
        retractingCount: 0,
        contradictingCount: 0,
        reliabilityStatus: "single_source",
        newIndependentOrigin: false,
      }),
    ).toEqual({ state: "superseded", reason: "merged_into_canonical" });
    expect(
      nextLifecycleState({
        current: "confirmed",
        retractingCount: 0,
        contradictingCount: 0,
        reliabilityStatus: "primary_confirmed",
        newIndependentOrigin: false,
        windowElapsed: true,
      }),
    ).toEqual({ state: "resolved", reason: "window_elapsed" });
  });
});

describe("lead time and outcomes", () => {
  it("measures lead time as firstPrimaryAt minus firstObservedAt", () => {
    expect(leadTimeMs(FIRST, FOUR_HOURS)).toBe(4 * HOUR_MS);
    expect(leadTimeHours(FIRST, FOUR_HOURS)).toBe(4);
    expect(isPrimaryLeadTier("official_firsthand")).toBe(true);
    expect(isPrimaryLeadTier("known_analyst")).toBe(false);
    expect(leadTimeMs(FOUR_HOURS, FIRST)).toBe(0);
  });

  it("records price, funding, and TVL deltas without dividing by a zero baseline", () => {
    expect(observationDelta(100, 110)).toEqual({ abs: 10, pct: 10 });
    expect(observationDelta(0, 5)).toEqual({ abs: 5, pct: undefined });
    const point = nearestSeriesPoint(
      [
        { observedAt: new Date("2026-09-14T12:50:00.000Z"), value: 101 },
        { observedAt: new Date("2026-09-14T13:00:00.000Z"), value: 110 },
      ],
      new Date("2026-09-14T13:05:00.000Z"),
      15 * 60 * 1000,
    );
    expect(point?.value).toBe(110);
  });

  it("parses a changed scheduled date from effectiveStart", () => {
    expect(
      parseScheduledAt({
        effectiveStart: new Date("2026-10-01T00:00:00.000Z"),
        objectText: "2026-09-01T00:00:00.000Z",
      })?.toISOString(),
    ).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("scorecard", () => {
  it("reports precision as later confirmed over signals emitted", () => {
    expect(scorecardPrecision(4, 2)).toBe(0.5);
    expect(scorecardPrecision(0, 0)).toBeUndefined();
    expect(medianNumber([1, 3, 2])).toBe(2);
    const rows = aggregateScorecard([
      {
        agentId: "agent-1",
        catalystKind: "security_incident",
        sourceIdentityId: "id-1",
        emitted: true,
        laterConfirmed: true,
        laterRetracted: false,
        leadTimeHours: 4,
        move24hPct: 10,
      },
      {
        agentId: "agent-1",
        catalystKind: "security_incident",
        sourceIdentityId: "id-1",
        emitted: true,
        laterConfirmed: false,
        laterRetracted: true,
        leadTimeHours: 2,
        move24hPct: 6,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.signalsEmitted).toBe(2);
    expect(rows[0]?.laterConfirmed).toBe(1);
    expect(rows[0]?.laterRetracted).toBe(1);
    expect(rows[0]?.precision).toBe(0.5);
    expect(rows[0]?.retractionRate).toBe(0.5);
    expect(rows[0]?.medianLeadTimeHours).toBe(3);
    expect(rows[0]?.medianMove24hPct).toBe(8);
  });
});
