import {
  assets,
  eventAssets,
  eventEvidence,
  events,
  evidenceItems,
  observationSeries,
  signalOutcomes,
  signals,
} from "@riddlr/db";
import {
  aggregateScorecard,
  type CatalystKind,
  type EventJoinWindow,
  eventJoinWindowForKind,
  isCatalystKind,
  leadTimeHours,
  MAX_OUTCOME_EVENTS_PER_TICK,
  MAX_OUTCOME_SERIES_POINTS,
  MAX_SCORECARD_ROWS,
  nearestSeriesPoint,
  OUTCOME_HORIZON_MS,
  OUTCOME_HORIZONS,
  OUTCOME_METRICS,
  OUTCOME_POINT_TOLERANCE_MS,
  type OutcomeHorizon,
  type OutcomeMetric,
  observationDelta,
  takeBounded,
  unlabeledJoinWindow,
  windowElapsed,
} from "@riddlr/domain";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { AppContext } from "../context.js";
import { applyLifecycleState } from "./event-lifecycle.js";

function joinWindowForEvent(row: typeof events.$inferSelect): EventJoinWindow {
  return row.catalystKind && isCatalystKind(row.catalystKind)
    ? eventJoinWindowForKind(row.catalystKind as CatalystKind)
    : unlabeledJoinWindow();
}

export async function resolveExpiredEvents(ctx: AppContext, now = new Date()) {
  const open = await ctx.db
    .select()
    .from(events)
    .where(
      and(
        inArray(events.lifecycleState, ["open", "developing", "confirmed", "disputed"]),
        isNull(events.supersededByEventId),
      ),
    )
    .orderBy(events.windowStart)
    .limit(MAX_OUTCOME_EVENTS_PER_TICK);
  for (const event of open) {
    const firstObservedAt = event.firstObservedAt ?? event.windowStart;
    const elapsed = windowElapsed({
      now,
      firstObservedAt,
      window: joinWindowForEvent(event),
      scheduledAt: event.scheduledAt ?? undefined,
    });
    const scheduledPassed = Boolean(
      event.scheduledAt && now.getTime() > event.scheduledAt.getTime(),
    );
    if (!elapsed && !scheduledPassed) {
      continue;
    }
    await applyLifecycleState(ctx, event, {
      retractingCount: event.reliabilityStatus === "retracted" ? 1 : 0,
      contradictingCount: event.reliabilityStatus === "disputed" ? 1 : 0,
      reliabilityStatus: event.reliabilityStatus,
      newIndependentOrigin: false,
      windowElapsed: elapsed,
      scheduledPassed,
    });
  }
}

export async function recordDueOutcomes(ctx: AppContext, now = new Date()) {
  const due = await ctx.db
    .select()
    .from(events)
    .where(and(isNotNull(events.firstNotifiedAt), isNull(events.supersededByEventId)))
    .orderBy(events.firstNotifiedAt)
    .limit(MAX_OUTCOME_EVENTS_PER_TICK);
  for (const event of due) {
    if (!event.firstNotifiedAt) {
      continue;
    }
    const subjects = await subjectsForEvent(ctx, event);
    if (subjects.length === 0) {
      continue;
    }
    const [signal] = await ctx.db
      .select({ id: signals.id })
      .from(signals)
      .where(eq(signals.eventId, event.id))
      .limit(1);
    const existing = await ctx.db
      .select({ horizon: signalOutcomes.horizon, metric: signalOutcomes.metric })
      .from(signalOutcomes)
      .where(eq(signalOutcomes.eventId, event.id))
      .limit(OUTCOME_HORIZONS.length * OUTCOME_METRICS.length);
    const have = new Set(existing.map((row) => `${row.horizon}:${row.metric}`));
    for (const horizon of OUTCOME_HORIZONS) {
      const target = new Date(event.firstNotifiedAt.getTime() + OUTCOME_HORIZON_MS[horizon]);
      if (now.getTime() < target.getTime()) {
        continue;
      }
      for (const metric of OUTCOME_METRICS) {
        if (have.has(`${horizon}:${metric}`)) {
          continue;
        }
        const recorded = await recordHorizonMetric({
          ctx,
          eventId: event.id,
          signalId: signal?.id,
          subjects,
          metric,
          horizon,
          baselineAt: event.firstNotifiedAt,
          targetAt: target,
        });
        if (recorded) {
          ctx.metrics.signalOutcomes.inc({ horizon, metric });
        }
      }
    }
  }
}

async function subjectsForEvent(
  ctx: AppContext,
  event: typeof events.$inferSelect,
): Promise<string[]> {
  const ids = new Set<string>();
  if (event.subjectCanonicalId) {
    ids.add(event.subjectCanonicalId);
  }
  const links = await ctx.db
    .select({ assetId: eventAssets.assetId })
    .from(eventAssets)
    .where(eq(eventAssets.eventId, event.id))
    .limit(16);
  if (links.length > 0) {
    const rows = await ctx.db
      .select({ canonicalId: assets.canonicalId })
      .from(assets)
      .where(
        inArray(
          assets.id,
          links.map((link) => link.assetId),
        ),
      )
      .limit(16);
    for (const row of rows) {
      ids.add(row.canonicalId);
    }
  }
  return takeBounded([...ids], 16);
}

async function recordHorizonMetric(input: {
  ctx: AppContext;
  eventId: string;
  signalId?: string;
  subjects: string[];
  metric: OutcomeMetric;
  horizon: OutcomeHorizon;
  baselineAt: Date;
  targetAt: Date;
}): Promise<boolean> {
  const series = await input.ctx.db
    .select({
      observedAt: observationSeries.observedAt,
      value: observationSeries.value,
    })
    .from(observationSeries)
    .where(
      and(
        eq(observationSeries.metric, input.metric),
        inArray(observationSeries.subjectCanonicalId, input.subjects),
      ),
    )
    .orderBy(observationSeries.observedAt)
    .limit(MAX_OUTCOME_SERIES_POINTS);
  const baseline = nearestSeriesPoint(series, input.baselineAt, OUTCOME_POINT_TOLERANCE_MS);
  const observed = nearestSeriesPoint(series, input.targetAt, OUTCOME_POINT_TOLERANCE_MS);
  if (!baseline || !observed) {
    return false;
  }
  const delta = observationDelta(baseline.value, observed.value);
  await input.ctx.db
    .insert(signalOutcomes)
    .values({
      eventId: input.eventId,
      signalId: input.signalId,
      horizon: input.horizon,
      metric: input.metric,
      baselineValue: baseline.value,
      baselineAt: baseline.observedAt,
      observedValue: observed.value,
      observedAt: observed.observedAt,
      deltaAbs: delta.abs,
      deltaPct: delta.pct,
    })
    .onConflictDoNothing();
  return true;
}

export async function loadScorecard(ctx: AppContext) {
  const eventRows = await ctx.db
    .select()
    .from(events)
    .where(isNull(events.supersededByEventId))
    .orderBy(events.windowStart)
    .limit(MAX_SCORECARD_ROWS);
  const eventIds = eventRows.map((row) => row.id);
  const signalRows =
    eventIds.length > 0
      ? await ctx.db
          .select({ id: signals.id, eventId: signals.eventId, agentId: signals.agentId })
          .from(signals)
          .where(inArray(signals.eventId, eventIds))
          .limit(MAX_SCORECARD_ROWS)
      : [];
  const outcomeRows =
    eventIds.length > 0
      ? await ctx.db
          .select()
          .from(signalOutcomes)
          .where(
            and(
              inArray(signalOutcomes.eventId, eventIds),
              eq(signalOutcomes.horizon, "24h"),
              eq(signalOutcomes.metric, "spot_price"),
            ),
          )
          .limit(MAX_SCORECARD_ROWS)
      : [];
  const identityRows =
    eventIds.length > 0
      ? await ctx.db
          .select({
            eventId: eventEvidence.eventId,
            sourceIdentityId: evidenceItems.sourceIdentityId,
            publishedAt: evidenceItems.publishedAt,
            fetchedAt: evidenceItems.fetchedAt,
          })
          .from(eventEvidence)
          .innerJoin(evidenceItems, eq(eventEvidence.evidenceId, evidenceItems.id))
          .where(inArray(eventEvidence.eventId, eventIds))
          .limit(MAX_SCORECARD_ROWS)
      : [];
  const firstIdentity = new Map<string, string | null>();
  const firstAt = new Map<string, number>();
  for (const row of identityRows) {
    const at = (row.publishedAt ?? row.fetchedAt).getTime();
    const previous = firstAt.get(row.eventId);
    if (previous === undefined || at < previous) {
      firstAt.set(row.eventId, at);
      firstIdentity.set(row.eventId, row.sourceIdentityId);
    }
  }
  const signalsByEvent = new Map(signalRows.map((row) => [row.eventId, row]));
  const moveByEvent = new Map(outcomeRows.map((row) => [row.eventId, row.deltaPct ?? undefined]));
  const facts = eventRows.flatMap((event) => {
    const signal = signalsByEvent.get(event.id);
    if (!signal) {
      return [];
    }
    const laterConfirmed =
      event.lifecycleState === "confirmed" ||
      (event.lifecycleState === "resolved" && event.reliabilityStatus === "primary_confirmed");
    const laterRetracted =
      event.lifecycleState === "retracted" || event.reliabilityStatus === "retracted";
    return [
      {
        agentId: signal.agentId,
        catalystKind: event.catalystKind ?? "unlabeled",
        sourceIdentityId: firstIdentity.get(event.id) ?? null,
        emitted: true,
        laterConfirmed,
        laterRetracted,
        leadTimeHours: leadTimeHours(event.firstObservedAt, event.firstPrimaryAt),
        move24hPct: moveByEvent.get(event.id),
      },
    ];
  });
  return aggregateScorecard(facts);
}
