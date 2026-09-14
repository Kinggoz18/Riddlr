import {
  claims,
  eventClaims,
  eventEvidence,
  eventLifecycleTransitions,
  events,
  evidenceItems,
} from "@riddlr/db";
import {
  type CatalystKind,
  canonicalEvent,
  clusterJoinsEvent,
  clusterShingleMatch,
  type EventJoinWindow,
  earliestTimestamp,
  eventIdentityKey,
  eventJoinWindowForKind,
  identityKeysForSubject,
  isOpenLifecycle,
  isPrimaryLeadTier,
  type LifecycleState,
  MAX_EVENT_IDENTITY_CANDIDATES,
  MAX_LIFECYCLE_TRANSITIONS_PER_EVENT,
  nextLifecycleState,
  parseScheduledAt,
  type RegistryAsset,
  type TrustTier,
  takeBounded,
  unlabeledJoinWindow,
} from "@riddlr/domain";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { AppContext } from "../context.js";

export type LifecycleCluster = {
  agentId: string;
  marketDomainId: string;
  catalystKind?: CatalystKind;
  subjectCanonicalId?: string;
  claimFingerprints: string[];
  contentHashes: string[];
  clusterAt: Date;
  clusterText: string;
  scheduledAt?: Date;
  joinWindow?: EventJoinWindow;
  registry: readonly RegistryAsset[];
};

export function identityKeyForCluster(cluster: LifecycleCluster): string {
  return eventIdentityKey({
    marketDomainId: cluster.marketDomainId,
    catalystKind: cluster.catalystKind,
    subjectCanonicalId: cluster.subjectCanonicalId,
    contentHashes: cluster.contentHashes,
  });
}

export function joinWindowForCluster(cluster: LifecycleCluster) {
  if (cluster.joinWindow) {
    return cluster.joinWindow;
  }
  return cluster.catalystKind
    ? eventJoinWindowForKind(cluster.catalystKind)
    : unlabeledJoinWindow();
}

export async function findJoinableEvent(
  ctx: AppContext,
  cluster: LifecycleCluster,
): Promise<{ event: typeof events.$inferSelect; decision: "join" | "reopen" } | undefined> {
  const keys = cluster.catalystKind
    ? identityKeysForSubject({
        marketDomainId: cluster.marketDomainId,
        catalystKind: cluster.catalystKind,
        subjectCanonicalId: cluster.subjectCanonicalId,
        registry: cluster.registry,
      })
    : [identityKeyForCluster(cluster)];
  const uniqueKeys = takeBounded([...new Set(keys)], MAX_EVENT_IDENTITY_CANDIDATES);
  const candidates =
    uniqueKeys.length > 0
      ? await ctx.db
          .select()
          .from(events)
          .where(and(eq(events.agentId, cluster.agentId), inArray(events.identityKey, uniqueKeys)))
          .orderBy(events.windowStart)
          .limit(MAX_EVENT_IDENTITY_CANDIDATES)
      : [];
  const live = candidates.filter((row) => row.lifecycleState !== "superseded");
  if (live.length === 0) {
    return undefined;
  }
  const eventIds = live.map((row) => row.id);
  const claimRows =
    eventIds.length > 0
      ? await ctx.db
          .select({ eventId: eventClaims.eventId, fingerprint: claims.fingerprint })
          .from(eventClaims)
          .innerJoin(claims, eq(eventClaims.claimId, claims.id))
          .where(inArray(eventClaims.eventId, eventIds))
          .limit(MAX_EVENT_IDENTITY_CANDIDATES * 8)
      : [];
  const evidenceRows =
    eventIds.length > 0
      ? await ctx.db
          .select({
            eventId: eventEvidence.eventId,
            bodyText: evidenceItems.bodyText,
            title: evidenceItems.title,
          })
          .from(eventEvidence)
          .innerJoin(evidenceItems, eq(eventEvidence.evidenceId, evidenceItems.id))
          .where(inArray(eventEvidence.eventId, eventIds))
          .limit(MAX_EVENT_IDENTITY_CANDIDATES * 8)
      : [];
  const fingerprintsByEvent = new Map<string, string[]>();
  for (const row of claimRows) {
    const current = fingerprintsByEvent.get(row.eventId) ?? [];
    current.push(row.fingerprint);
    fingerprintsByEvent.set(row.eventId, current);
  }
  const textByEvent = new Map<string, string>();
  for (const row of evidenceRows) {
    if (!textByEvent.has(row.eventId)) {
      textByEvent.set(row.eventId, `${row.title ?? ""} ${row.bodyText ?? ""}`.trim());
    }
  }
  const window = joinWindowForCluster(cluster);
  const matches: Array<{ event: typeof events.$inferSelect; decision: "join" | "reopen" }> = [];
  for (const event of live) {
    const eventFingerprints = fingerprintsByEvent.get(event.id) ?? [];
    const sharedClaimFingerprint = cluster.claimFingerprints.some((fingerprint) =>
      eventFingerprints.includes(fingerprint),
    );
    const shingleMatch = clusterShingleMatch(cluster.clusterText, textByEvent.get(event.id) ?? "");
    const eventScheduled = event.scheduledAt ?? undefined;
    const scheduledAtChanged = Boolean(
      cluster.scheduledAt &&
        eventScheduled &&
        cluster.scheduledAt.getTime() !== eventScheduled.getTime(),
    );
    const decision = clusterJoinsEvent({
      clusterAt: cluster.clusterAt,
      eventFirstObservedAt: event.firstObservedAt ?? event.windowStart,
      eventLifecycle: event.lifecycleState as LifecycleState,
      window,
      scheduledAt: eventScheduled,
      sharedClaimFingerprint,
      shingleMatch,
      scheduledAtChanged,
      catalystKind: cluster.catalystKind,
    });
    if (decision === "join" || decision === "reopen") {
      matches.push({ event, decision });
    }
  }
  if (matches.length === 0) {
    return undefined;
  }
  const openMatches = matches.filter((item) =>
    isOpenLifecycle(item.event.lifecycleState as LifecycleState),
  );
  const pool = openMatches.length > 0 ? openMatches : matches;
  const canonical = canonicalEvent(
    pool.map((item) => ({
      id: item.event.id,
      firstObservedAt: item.event.firstObservedAt ?? item.event.windowStart,
      decision: item.decision,
      event: item.event,
    })),
  );
  if (!canonical) {
    return undefined;
  }
  const extras = pool.filter(
    (item) =>
      item.event.id !== canonical.id &&
      isOpenLifecycle(item.event.lifecycleState as LifecycleState),
  );
  for (const extra of extras) {
    await mergeSupersededEvent(ctx, canonical.event.id, extra.event.id);
  }
  return { event: canonical.event, decision: canonical.decision };
}

export async function mergeSupersededEvent(ctx: AppContext, canonicalId: string, extraId: string) {
  if (canonicalId === extraId) {
    return;
  }
  const extraLinks = await ctx.db
    .select()
    .from(eventEvidence)
    .where(eq(eventEvidence.eventId, extraId))
    .limit(100);
  for (const link of extraLinks) {
    await ctx.db
      .insert(eventEvidence)
      .values({ eventId: canonicalId, evidenceId: link.evidenceId, role: link.role })
      .onConflictDoNothing();
  }
  const extraClaims = await ctx.db
    .select()
    .from(eventClaims)
    .where(eq(eventClaims.eventId, extraId))
    .limit(64);
  for (const link of extraClaims) {
    await ctx.db
      .insert(eventClaims)
      .values({ eventId: canonicalId, claimId: link.claimId, stance: link.stance })
      .onConflictDoNothing();
  }
  await recordLifecycleTransition(ctx, extraId, "superseded", "merged_into_canonical");
  await ctx.db
    .update(events)
    .set({
      lifecycleState: "superseded",
      supersededByEventId: canonicalId,
      lifecycleChangedAt: new Date(),
    })
    .where(eq(events.id, extraId));
}

export async function recordLifecycleTransition(
  ctx: AppContext,
  eventId: string,
  toState: LifecycleState,
  reason: string,
  fromState?: string | null,
) {
  const existing = await ctx.db
    .select({ id: eventLifecycleTransitions.id })
    .from(eventLifecycleTransitions)
    .where(eq(eventLifecycleTransitions.eventId, eventId))
    .limit(MAX_LIFECYCLE_TRANSITIONS_PER_EVENT);
  if (existing.length >= MAX_LIFECYCLE_TRANSITIONS_PER_EVENT) {
    return;
  }
  await ctx.db.insert(eventLifecycleTransitions).values({
    eventId,
    fromState: fromState ?? null,
    toState,
    reason,
  });
}

export function leadTimesFromEvidence(
  rows: Array<{
    publishedAt?: Date | null;
    fetchedAt: Date;
    trustTier?: string | null;
  }>,
): { firstObservedAt?: Date; firstPrimaryAt?: Date; lastEvidenceAt?: Date } {
  const observed = rows.map((row) => row.publishedAt ?? row.fetchedAt);
  const primary = rows
    .filter((row) => isPrimaryLeadTier((row.trustTier ?? "unknown") as TrustTier))
    .map((row) => row.publishedAt ?? row.fetchedAt);
  const last = [...observed].sort((left, right) => right.getTime() - left.getTime())[0];
  return {
    firstObservedAt: earliestTimestamp(observed),
    firstPrimaryAt: earliestTimestamp(primary),
    lastEvidenceAt: last,
  };
}

export function scheduledAtFromClaims(
  rows: Array<{
    effectiveStart?: Date | null;
    value?: unknown;
    objectText?: string | null;
  }>,
): Date | undefined {
  for (const row of rows) {
    const parsed = parseScheduledAt(row);
    if (parsed) {
      return parsed;
    }
  }
  return undefined;
}

export async function applyLifecycleState(
  ctx: AppContext,
  event: typeof events.$inferSelect,
  input: {
    retractingCount: number;
    contradictingCount: number;
    reliabilityStatus: string;
    newIndependentOrigin: boolean;
    windowElapsed?: boolean;
    scheduledPassed?: boolean;
    reopen?: boolean;
  },
): Promise<LifecycleState> {
  const current = (input.reopen ? "open" : event.lifecycleState) as LifecycleState;
  const next = nextLifecycleState({
    current,
    retractingCount: input.retractingCount,
    contradictingCount: input.contradictingCount,
    reliabilityStatus: input.reliabilityStatus,
    newIndependentOrigin: input.newIndependentOrigin,
    windowElapsed: input.windowElapsed,
    scheduledPassed: input.scheduledPassed,
  });
  if (next.state !== event.lifecycleState || input.reopen) {
    await recordLifecycleTransition(ctx, event.id, next.state, next.reason, event.lifecycleState);
    ctx.metrics.lifecycleTransitions.inc({ to: next.state });
    await ctx.db
      .update(events)
      .set({
        lifecycleState: next.state,
        lifecycleChangedAt: new Date(),
        ...(input.reopen ? { supersededByEventId: null } : {}),
      })
      .where(eq(events.id, event.id));
  }
  return next.state;
}

export async function markFirstNotifiedAt(ctx: AppContext, eventId: string, at: Date) {
  const [row] = await ctx.db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!row || row.firstNotifiedAt) {
    return;
  }
  await ctx.db.update(events).set({ firstNotifiedAt: at }).where(eq(events.id, eventId));
}

export async function loadEventTransitions(ctx: AppContext, eventId: string) {
  return ctx.db
    .select()
    .from(eventLifecycleTransitions)
    .where(eq(eventLifecycleTransitions.eventId, eventId))
    .orderBy(desc(eventLifecycleTransitions.at))
    .limit(MAX_LIFECYCLE_TRANSITIONS_PER_EVENT);
}
