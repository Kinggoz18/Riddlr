import { createHash } from "node:crypto";
import type { CatalystKind } from "./catalysts.js";
import { isCatalystKind, isSubjectFreeCatalyst } from "./catalysts.js";
import { CLUSTER_SIMILARITY_THRESHOLD, CLUSTER_WINDOW_MS, isNearDuplicate } from "./cluster.js";
import type { RegistryAsset } from "./domain-module.js";
import {
  EVENT_JOIN_CLOCK_SKEW_MS,
  MAX_ALIASES_PER_ASSET,
  MAX_EVENT_IDENTITY_CANDIDATES,
  MAX_OUTCOME_SERIES_POINTS,
  MAX_SCORECARD_ROWS,
  takeBounded,
} from "./limits.js";
import type { ReliabilityStatus, TrustTier } from "./reliability.js";

export const LIFECYCLE_STATES = [
  "open",
  "developing",
  "confirmed",
  "disputed",
  "retracted",
  "resolved",
  "superseded",
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const OPEN_LIFECYCLE_STATES = [
  "open",
  "developing",
  "confirmed",
  "disputed",
] as const satisfies readonly LifecycleState[];

export const OUTCOME_HORIZONS = ["1h", "24h", "7d"] as const;
export type OutcomeHorizon = (typeof OUTCOME_HORIZONS)[number];

export const OUTCOME_HORIZON_MS: Record<OutcomeHorizon, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

export const OUTCOME_METRICS = ["spot_price", "funding_rate_apr", "tvl_usd"] as const;
export type OutcomeMetric = (typeof OUTCOME_METRICS)[number];

export type EventJoinWindow = { kind: "duration"; ms: number } | { kind: "until_execution" };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const DEFAULT_EVENT_JOIN_WINDOWS: Record<CatalystKind, EventJoinWindow> = {
  security_incident: { kind: "duration", ms: 72 * HOUR_MS },
  insolvency_or_withdrawal_halt: { kind: "duration", ms: 72 * HOUR_MS },
  peg_deviation: { kind: "duration", ms: DAY_MS },
  token_unlock: { kind: "until_execution" },
  listing_or_delisting: { kind: "duration", ms: 48 * HOUR_MS },
  governance_proposal: { kind: "until_execution" },
  regulatory_or_legal_action: { kind: "duration", ms: 72 * HOUR_MS },
  sanction: { kind: "duration", ms: 72 * HOUR_MS },
  macro_policy_decision: { kind: "duration", ms: 48 * HOUR_MS },
  scheduled_release: { kind: "until_execution" },
  insider_transaction: { kind: "duration", ms: DAY_MS },
  material_corporate_event: { kind: "duration", ms: 48 * HOUR_MS },
  earnings_or_guidance: { kind: "duration", ms: 72 * HOUR_MS },
  large_transfer: { kind: "duration", ms: DAY_MS },
  market_stress: { kind: "duration", ms: DAY_MS },
  observed_anomaly: { kind: "duration", ms: DAY_MS },
  principal_statement: { kind: "duration", ms: DAY_MS },
};

export function isLifecycleState(value: string): value is LifecycleState {
  return (LIFECYCLE_STATES as readonly string[]).includes(value);
}

export function eventJoinWindowForKind(kind: CatalystKind): EventJoinWindow {
  return DEFAULT_EVENT_JOIN_WINDOWS[kind];
}

export function unlabeledJoinWindow(): EventJoinWindow {
  return { kind: "duration", ms: CLUSTER_WINDOW_MS };
}

export function isOpenLifecycle(state: LifecycleState): boolean {
  return (OPEN_LIFECYCLE_STATES as readonly LifecycleState[]).includes(state);
}

export function isPrimaryLeadTier(tier: TrustTier): boolean {
  return tier === "official_firsthand";
}

export function eventIdentityKey(input: {
  marketDomainId: string;
  catalystKind?: CatalystKind;
  subjectCanonicalId?: string;
  contentHashes?: string[];
}): string {
  const subject =
    input.catalystKind && isSubjectFreeCatalyst(input.catalystKind)
      ? ""
      : (input.subjectCanonicalId ?? "");
  const labeled = input.catalystKind ? `${input.catalystKind}|${subject}` : "";
  const hashes = [...new Set(input.contentHashes ?? [])].filter(Boolean).sort().join(",");
  const identity = labeled || (hashes ? `hash:${hashes}` : "unlabeled");
  return createHash("sha256").update(`${input.marketDomainId}|${identity}`).digest("hex");
}

export function subjectAliasIds(
  subjectCanonicalId: string,
  registry: readonly RegistryAsset[],
): string[] {
  const matches = registry.filter(
    (asset) =>
      asset.canonicalId === subjectCanonicalId || asset.aliases.includes(subjectCanonicalId),
  );
  if (matches.length === 0) {
    return [subjectCanonicalId];
  }
  const ids = new Set<string>();
  for (const asset of takeBounded(matches, MAX_EVENT_IDENTITY_CANDIDATES)) {
    ids.add(asset.canonicalId);
    for (const alias of takeBounded(asset.aliases, MAX_ALIASES_PER_ASSET)) {
      if (alias.trim()) {
        ids.add(alias);
      }
    }
  }
  return takeBounded([...ids], MAX_ALIASES_PER_ASSET);
}

export function identityKeysForSubject(input: {
  marketDomainId: string;
  catalystKind: CatalystKind;
  subjectCanonicalId?: string;
  registry: readonly RegistryAsset[];
}): string[] {
  if (isSubjectFreeCatalyst(input.catalystKind) || !input.subjectCanonicalId) {
    return [
      eventIdentityKey({
        marketDomainId: input.marketDomainId,
        catalystKind: input.catalystKind,
      }),
    ];
  }
  const subjects = subjectAliasIds(input.subjectCanonicalId, input.registry);
  return [
    ...new Set(
      subjects.map((subjectCanonicalId) =>
        eventIdentityKey({
          marketDomainId: input.marketDomainId,
          catalystKind: input.catalystKind,
          subjectCanonicalId,
        }),
      ),
    ),
  ];
}

export function parseScheduledAt(input: {
  effectiveStart?: Date | null;
  value?: unknown;
  objectText?: string | null;
}): Date | undefined {
  if (input.effectiveStart && !Number.isNaN(input.effectiveStart.getTime())) {
    return input.effectiveStart;
  }
  if (typeof input.value === "number" && Number.isFinite(input.value)) {
    const ms = input.value > 1e12 ? input.value : input.value > 1e9 ? input.value * 1000 : NaN;
    if (Number.isFinite(ms)) {
      const date = new Date(ms);
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }
  }
  if (typeof input.value === "string" && input.value.trim()) {
    const date = new Date(input.value.trim());
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  if (input.objectText?.trim()) {
    const date = new Date(input.objectText.trim());
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return undefined;
}

export function withinJoinWindow(input: {
  clusterAt: Date;
  firstObservedAt: Date;
  window: EventJoinWindow;
  scheduledAt?: Date;
}): boolean {
  const cluster = input.clusterAt.getTime();
  const start = input.firstObservedAt.getTime() - EVENT_JOIN_CLOCK_SKEW_MS;
  if (input.window.kind === "until_execution") {
    if (!input.scheduledAt) {
      return cluster >= start;
    }
    return cluster >= start && cluster <= input.scheduledAt.getTime();
  }
  return cluster >= start && cluster <= input.firstObservedAt.getTime() + input.window.ms;
}

export function windowElapsed(input: {
  now: Date;
  firstObservedAt: Date;
  window: EventJoinWindow;
  scheduledAt?: Date;
}): boolean {
  if (input.window.kind === "until_execution") {
    return Boolean(input.scheduledAt && input.now.getTime() > input.scheduledAt.getTime());
  }
  return input.now.getTime() > input.firstObservedAt.getTime() + input.window.ms;
}

export function reopenResolvedEvent(input: {
  kind?: CatalystKind;
  scheduledAtChanged: boolean;
  sameClaimFingerprint: boolean;
}): boolean {
  if (!input.kind || !input.sameClaimFingerprint || !input.scheduledAtChanged) {
    return false;
  }
  return eventJoinWindowForKind(input.kind).kind === "until_execution";
}

export type ClusterJoinDecision = "join" | "reopen" | "new";

export function clusterJoinsEvent(input: {
  clusterAt: Date;
  eventFirstObservedAt: Date;
  eventLifecycle: LifecycleState;
  window: EventJoinWindow;
  scheduledAt?: Date;
  sharedClaimFingerprint: boolean;
  shingleMatch: boolean;
  scheduledAtChanged: boolean;
  catalystKind?: CatalystKind;
}): ClusterJoinDecision {
  if (!input.sharedClaimFingerprint && !input.shingleMatch) {
    return "new";
  }
  if (isOpenLifecycle(input.eventLifecycle)) {
    return withinJoinWindow({
      clusterAt: input.clusterAt,
      firstObservedAt: input.eventFirstObservedAt,
      window: input.window,
      scheduledAt: input.scheduledAt,
    })
      ? "join"
      : "new";
  }
  if (
    input.eventLifecycle === "resolved" &&
    reopenResolvedEvent({
      kind: input.catalystKind,
      scheduledAtChanged: input.scheduledAtChanged,
      sameClaimFingerprint: input.sharedClaimFingerprint,
    })
  ) {
    return "reopen";
  }
  return "new";
}

export function clusterShingleMatch(clusterText: string, principalText: string): boolean {
  return isNearDuplicate(clusterText, principalText, CLUSTER_SIMILARITY_THRESHOLD);
}

export function leadTimeMs(
  firstObservedAt?: Date | null,
  firstPrimaryAt?: Date | null,
): number | undefined {
  if (!firstObservedAt || !firstPrimaryAt) {
    return undefined;
  }
  return Math.max(0, firstPrimaryAt.getTime() - firstObservedAt.getTime());
}

export function leadTimeHours(
  firstObservedAt?: Date | null,
  firstPrimaryAt?: Date | null,
): number | undefined {
  const ms = leadTimeMs(firstObservedAt, firstPrimaryAt);
  return ms === undefined ? undefined : ms / HOUR_MS;
}

export function nextLifecycleState(input: {
  current: LifecycleState;
  superseded?: boolean;
  retractingCount: number;
  contradictingCount: number;
  reliabilityStatus: ReliabilityStatus | string;
  newIndependentOrigin: boolean;
  windowElapsed?: boolean;
  scheduledPassed?: boolean;
}): { state: LifecycleState; reason: string } {
  if (input.current === "superseded" || input.superseded) {
    return { state: "superseded", reason: "merged_into_canonical" };
  }
  if (input.retractingCount > 0 && input.contradictingCount > 0) {
    return { state: "disputed", reason: "retraction_and_confirmation" };
  }
  if (input.retractingCount > 0 || input.reliabilityStatus === "retracted") {
    return { state: "retracted", reason: "retracting_claim" };
  }
  if (input.contradictingCount > 0 || input.reliabilityStatus === "disputed") {
    return { state: "disputed", reason: "contradicting_claim" };
  }
  if (input.reliabilityStatus === "primary_confirmed") {
    if (input.windowElapsed || input.scheduledPassed) {
      return { state: "resolved", reason: "window_elapsed" };
    }
    return { state: "confirmed", reason: "primary_confirmed" };
  }
  if (input.windowElapsed || input.scheduledPassed) {
    return {
      state: "resolved",
      reason: input.scheduledPassed ? "scheduled_passed" : "window_elapsed",
    };
  }
  if (input.current === "confirmed") {
    return { state: "confirmed", reason: "unchanged" };
  }
  if (input.newIndependentOrigin) {
    return { state: "developing", reason: "new_independent_origin" };
  }
  if (input.current === "developing") {
    return { state: input.current, reason: "unchanged" };
  }
  return { state: "open", reason: "opened" };
}

export function canonicalEvent<T extends { id: string; firstObservedAt: Date }>(
  events: readonly T[],
): T | undefined {
  const bounded = takeBounded(events, MAX_EVENT_IDENTITY_CANDIDATES);
  return [...bounded].sort((left, right) => {
    const delta = left.firstObservedAt.getTime() - right.firstObservedAt.getTime();
    if (delta !== 0) {
      return delta;
    }
    return left.id.localeCompare(right.id);
  })[0];
}

export function earliestTimestamp(values: Array<Date | undefined | null>): Date | undefined {
  let min: Date | undefined;
  for (const value of values) {
    if (!value || Number.isNaN(value.getTime())) {
      continue;
    }
    if (!min || value.getTime() < min.getTime()) {
      min = value;
    }
  }
  return min;
}

export function observationDelta(
  baseline: number,
  observed: number,
): { abs: number; pct: number | undefined } {
  const abs = observed - baseline;
  if (baseline === 0) {
    return { abs, pct: undefined };
  }
  return { abs, pct: (abs / baseline) * 100 };
}

export function nearestSeriesPoint<T extends { observedAt: Date; value: number }>(
  series: readonly T[],
  target: Date,
  toleranceMs: number,
): T | undefined {
  const bounded = takeBounded(series, MAX_OUTCOME_SERIES_POINTS);
  let best: T | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const point of bounded) {
    const delta = Math.abs(point.observedAt.getTime() - target.getTime());
    if (delta <= toleranceMs && delta < bestDelta) {
      best = point;
      bestDelta = delta;
    }
  }
  return best;
}

export function medianNumber(values: readonly number[]): number | undefined {
  const finite = values
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (finite.length === 0) {
    return undefined;
  }
  const mid = Math.floor(finite.length / 2);
  const center = finite[mid];
  if (center === undefined) {
    return undefined;
  }
  if (finite.length % 2 === 1) {
    return center;
  }
  const prior = finite[mid - 1];
  if (prior === undefined) {
    return center;
  }
  return (prior + center) / 2;
}

export function scorecardPrecision(emitted: number, laterConfirmed: number): number | undefined {
  if (emitted <= 0) {
    return undefined;
  }
  return laterConfirmed / emitted;
}

export type ScorecardFacts = {
  agentId: string;
  catalystKind: string;
  sourceIdentityId: string | null;
  emitted: boolean;
  laterConfirmed: boolean;
  laterRetracted: boolean;
  leadTimeHours?: number;
  move24hPct?: number;
};

export type ScorecardRow = {
  agentId: string;
  catalystKind: string;
  sourceIdentityId: string | null;
  signalsEmitted: number;
  laterConfirmed: number;
  laterRetracted: number;
  precision: number | undefined;
  retractionRate: number | undefined;
  medianLeadTimeHours: number | undefined;
  medianMove24hPct: number | undefined;
};

export function aggregateScorecard(facts: readonly ScorecardFacts[]): ScorecardRow[] {
  const groups = new Map<string, ScorecardFacts[]>();
  for (const row of takeBounded(facts, MAX_SCORECARD_ROWS)) {
    const key = `${row.agentId}|${row.catalystKind}|${row.sourceIdentityId ?? ""}`;
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }
  return [...groups.entries()].map(([, rows]) => {
    const first = rows[0];
    const emitted = rows.filter((row) => row.emitted).length;
    const laterConfirmed = rows.filter((row) => row.laterConfirmed).length;
    const laterRetracted = rows.filter((row) => row.laterRetracted).length;
    return {
      agentId: first?.agentId ?? "",
      catalystKind: first?.catalystKind ?? "",
      sourceIdentityId: first?.sourceIdentityId ?? null,
      signalsEmitted: emitted,
      laterConfirmed,
      laterRetracted,
      precision: scorecardPrecision(emitted, laterConfirmed),
      retractionRate: scorecardPrecision(emitted, laterRetracted),
      medianLeadTimeHours: medianNumber(
        rows.flatMap((row) => (row.leadTimeHours === undefined ? [] : [row.leadTimeHours])),
      ),
      medianMove24hPct: medianNumber(
        rows.flatMap((row) => (row.move24hPct === undefined ? [] : [row.move24hPct])),
      ),
    };
  });
}

export function catalystKindFromValue(value: string | undefined): CatalystKind | undefined {
  return value && isCatalystKind(value) ? value : undefined;
}
