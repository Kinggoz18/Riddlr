import {
  assetDeskQuerySchema,
  morningQuerySchema,
  observationSeriesQuerySchema,
} from "@riddlr/api-contract";
import {
  assets,
  claimEvidence,
  claims,
  eventAssets,
  eventClaims,
  eventEvidence,
  events,
  evidenceItems,
  observationSeries,
  signals,
  sourceIdentities,
  watchlistItems,
  watchlists,
} from "@riddlr/db";
import {
  boundSeriesPoints,
  change24hPct,
  DASHBOARD_CHART_METRICS,
  type DashboardChartMetric,
  DEFAULT_CHART_LOOKBACK_MS,
  isLifecycleState,
  isOpenLifecycle,
  isUpcomingCatalystKind,
  MAX_ASSET_CLAIMS,
  MAX_ASSET_EVIDENCE,
  MAX_ASSET_IDENTITIES,
  MAX_CHART_MARKERS,
  MAX_CHART_SPARK_POINTS,
  MAX_MORNING_ASSETS,
  MAX_MORNING_CATALYSTS_PER_ASSET,
  MAX_MORNING_EVENTS_PER_ASSET,
  MAX_MORNING_SIGNALS_PER_ASSET,
  MAX_MORNING_WATCHLISTS,
  MAX_SERIES_WINDOW,
  MORNING_LOOKBACK_MS,
  parseMorningSince,
  takeBounded,
  UPCOMING_CATALYST_HORIZON_MS,
} from "@riddlr/domain";
import { and, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../context.js";

type SeriesPoint = {
  observedAt: string;
  value: number;
  unit?: string;
  provider?: string;
};

type Quote = {
  value: number;
  unit: string;
  observedAt: string;
  provider: string;
};

function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function quoteFromRow(row: {
  value: number;
  unit: string;
  observedAt: Date;
  provider: string;
}): Quote {
  return {
    value: row.value,
    unit: row.unit,
    observedAt: iso(row.observedAt),
    provider: row.provider,
  };
}

async function watchedCanonicalIds(ctx: AppContext): Promise<string[]> {
  const lists = await ctx.db
    .select({ id: watchlists.id })
    .from(watchlists)
    .limit(MAX_MORNING_WATCHLISTS);
  if (lists.length === 0) {
    return [];
  }
  const items = await ctx.db
    .select({ canonicalId: watchlistItems.canonicalId })
    .from(watchlistItems)
    .where(
      inArray(
        watchlistItems.watchlistId,
        lists.map((row) => row.id),
      ),
    )
    .limit(MAX_MORNING_WATCHLISTS * MAX_MORNING_ASSETS);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of items) {
    if (seen.has(item.canonicalId)) {
      continue;
    }
    seen.add(item.canonicalId);
    ids.push(item.canonicalId);
  }
  return takeBounded(ids, MAX_MORNING_ASSETS);
}

async function latestMetricQuotes(
  ctx: AppContext,
  subjects: readonly string[],
  metrics: readonly string[],
): Promise<Map<string, Quote>> {
  if (subjects.length === 0 || metrics.length === 0) {
    return new Map();
  }
  const rows = await ctx.db
    .selectDistinctOn([observationSeries.metric, observationSeries.subjectCanonicalId], {
      metric: observationSeries.metric,
      subjectCanonicalId: observationSeries.subjectCanonicalId,
      value: observationSeries.value,
      unit: observationSeries.unit,
      observedAt: observationSeries.observedAt,
      provider: observationSeries.provider,
    })
    .from(observationSeries)
    .where(
      and(
        eq(observationSeries.resolution, "raw"),
        inArray(observationSeries.metric, [...metrics]),
        inArray(observationSeries.subjectCanonicalId, [...subjects]),
      ),
    )
    .orderBy(
      observationSeries.metric,
      observationSeries.subjectCanonicalId,
      desc(observationSeries.observedAt),
    )
    .limit(subjects.length * metrics.length);
  const map = new Map<string, Quote>();
  for (const row of rows) {
    map.set(`${row.metric}:${row.subjectCanonicalId}`, quoteFromRow(row));
  }
  return map;
}

async function seriesForSubjects(
  ctx: AppContext,
  subjects: readonly string[],
  metric: DashboardChartMetric,
  from: Date,
  perSubject: number,
): Promise<Map<string, SeriesPoint[]>> {
  const grouped = new Map<string, SeriesPoint[]>();
  if (subjects.length === 0) {
    return grouped;
  }
  const rows = await ctx.db
    .select({
      subjectCanonicalId: observationSeries.subjectCanonicalId,
      observedAt: observationSeries.observedAt,
      value: observationSeries.value,
      unit: observationSeries.unit,
      provider: observationSeries.provider,
    })
    .from(observationSeries)
    .where(
      and(
        eq(observationSeries.metric, metric),
        eq(observationSeries.resolution, "raw"),
        inArray(observationSeries.subjectCanonicalId, [...subjects]),
        gte(observationSeries.observedAt, from),
      ),
    )
    .orderBy(desc(observationSeries.observedAt))
    .limit(subjects.length * perSubject);
  for (const row of rows) {
    const current = grouped.get(row.subjectCanonicalId) ?? [];
    if (current.length >= perSubject) {
      continue;
    }
    current.push({
      observedAt: iso(row.observedAt),
      value: row.value,
      unit: row.unit,
      provider: row.provider,
    });
    grouped.set(row.subjectCanonicalId, current);
  }
  for (const [subject, points] of grouped) {
    grouped.set(subject, boundSeriesPoints([...points].reverse(), perSubject));
  }
  return grouped;
}

async function eventsForSubjects(ctx: AppContext, subjects: readonly string[], limit: number) {
  if (subjects.length === 0) {
    return [];
  }
  const assetRows = await ctx.db
    .select({ id: assets.id, canonicalId: assets.canonicalId })
    .from(assets)
    .where(inArray(assets.canonicalId, [...subjects]))
    .limit(MAX_MORNING_ASSETS);
  const links =
    assetRows.length > 0
      ? await ctx.db
          .select({ eventId: eventAssets.eventId, assetId: eventAssets.assetId })
          .from(eventAssets)
          .where(
            inArray(
              eventAssets.assetId,
              assetRows.map((row) => row.id),
            ),
          )
          .limit(limit)
      : [];
  const linkedIds = [...new Set(links.map((row) => row.eventId))];
  const subjectMatch = inArray(events.subjectCanonicalId, [...subjects]);
  const rows = await ctx.db
    .select()
    .from(events)
    .where(
      and(
        isNull(events.supersededByEventId),
        linkedIds.length > 0 ? or(subjectMatch, inArray(events.id, linkedIds)) : subjectMatch,
      ),
    )
    .orderBy(desc(events.windowStart))
    .limit(limit);
  const canonicalByAssetId = new Map(assetRows.map((row) => [row.id, row.canonicalId]));
  return rows.map((row) => ({
    ...row,
    linkedCanonicalIds: [
      ...new Set([
        ...(row.subjectCanonicalId ? [row.subjectCanonicalId] : []),
        ...links
          .filter((link) => link.eventId === row.id)
          .map((link) => canonicalByAssetId.get(link.assetId))
          .filter((item): item is string => Boolean(item)),
      ]),
    ],
  }));
}

export async function loadMorning(ctx: AppContext, sinceRaw: string | undefined, now = new Date()) {
  const since = parseMorningSince(sinceRaw, now);
  const ids = await watchedCanonicalIds(ctx);
  const assetRows =
    ids.length > 0
      ? await ctx.db
          .select()
          .from(assets)
          .where(inArray(assets.canonicalId, ids))
          .limit(MAX_MORNING_ASSETS)
      : [];
  const byCanonical = new Map(assetRows.map((row) => [row.canonicalId, row]));
  const quotes = await latestMetricQuotes(ctx, ids, [
    "spot_price",
    "price_change_24h",
    "funding_rate_apr",
    "open_interest_usd",
  ]);
  const sparkFrom = new Date(now.getTime() - MORNING_LOOKBACK_MS);
  const sparks = await seriesForSubjects(ctx, ids, "spot_price", sparkFrom, MAX_CHART_SPARK_POINTS);
  const related = await eventsForSubjects(
    ctx,
    ids,
    MAX_MORNING_ASSETS * MAX_MORNING_EVENTS_PER_ASSET,
  );
  const upcomingHorizon = new Date(now.getTime() + UPCOMING_CATALYST_HORIZON_MS);
  const signalRows =
    ids.length > 0
      ? await ctx.db
          .select({
            id: signals.id,
            headline: signals.headline,
            risk: signals.risk,
            createdAt: signals.createdAt,
            eventId: signals.eventId,
            subjectCanonicalId: events.subjectCanonicalId,
          })
          .from(signals)
          .innerJoin(events, eq(signals.eventId, events.id))
          .where(gte(signals.createdAt, since))
          .orderBy(desc(signals.createdAt))
          .limit(MAX_MORNING_ASSETS * MAX_MORNING_SIGNALS_PER_ASSET)
      : [];
  const upcoming = related.filter(
    (row) =>
      row.scheduledAt &&
      row.scheduledAt.getTime() > now.getTime() &&
      row.scheduledAt.getTime() <= upcomingHorizon.getTime() &&
      isUpcomingCatalystKind(row.catalystKind),
  );
  return {
    asOf: iso(now),
    since: iso(since),
    assets: ids.map((canonicalId) => {
      const asset = byCanonical.get(canonicalId);
      const lastPrice = quotes.get(`spot_price:${canonicalId}`);
      const recordedChange = quotes.get(`price_change_24h:${canonicalId}`);
      const spark = sparks.get(canonicalId) ?? [];
      const oldest = spark[0];
      const change = change24hPct({
        latest: lastPrice
          ? { observedAt: new Date(lastPrice.observedAt), value: lastPrice.value }
          : undefined,
        prior: oldest
          ? { observedAt: new Date(oldest.observedAt), value: oldest.value }
          : undefined,
        recordedChange: recordedChange?.value,
      });
      const openEvents = takeBounded(
        related.filter(
          (row) =>
            row.linkedCanonicalIds.includes(canonicalId) &&
            isLifecycleState(row.lifecycleState) &&
            isOpenLifecycle(row.lifecycleState),
        ),
        MAX_MORNING_EVENTS_PER_ASSET,
      );
      return {
        canonicalId,
        symbol: asset?.symbol ?? null,
        name: asset?.name ?? null,
        assetClass: asset?.assetClass ?? null,
        lastPrice: lastPrice ?? null,
        change24hPct: change,
        funding: quotes.get(`funding_rate_apr:${canonicalId}`) ?? null,
        openInterest: quotes.get(`open_interest_usd:${canonicalId}`) ?? null,
        spark,
        openEvents: openEvents.map((row) => ({
          id: row.id,
          title: row.title,
          reliabilityStatus: row.reliabilityStatus,
          impactLevel: row.impactLevel,
          lifecycleState: row.lifecycleState,
          firstObservedAt: row.firstObservedAt ? iso(row.firstObservedAt) : null,
        })),
        newSignals: takeBounded(
          signalRows.filter(
            (row) =>
              row.subjectCanonicalId === canonicalId ||
              related.some(
                (event) =>
                  event.id === row.eventId && event.linkedCanonicalIds.includes(canonicalId),
              ),
          ),
          MAX_MORNING_SIGNALS_PER_ASSET,
        ).map((row) => ({
          id: row.id,
          headline: row.headline,
          risk: row.risk,
          createdAt: iso(row.createdAt),
          eventId: row.eventId,
        })),
        upcomingCatalysts: takeBounded(
          upcoming.filter((row) => row.linkedCanonicalIds.includes(canonicalId)),
          MAX_MORNING_CATALYSTS_PER_ASSET,
        ).map((row) => ({
          id: row.id,
          title: row.title,
          catalystKind: row.catalystKind,
          scheduledAt: row.scheduledAt ? iso(row.scheduledAt) : null,
        })),
      };
    }),
  };
}

export async function loadAssetDesk(ctx: AppContext, canonicalId: string, now = new Date()) {
  const [asset] = await ctx.db
    .select()
    .from(assets)
    .where(eq(assets.canonicalId, canonicalId))
    .limit(1);
  if (!asset) {
    return undefined;
  }
  const from = new Date(now.getTime() - DEFAULT_CHART_LOOKBACK_MS);
  const quotes = await latestMetricQuotes(
    ctx,
    [canonicalId],
    ["spot_price", "price_change_24h", "funding_rate_apr", "open_interest_usd", "tvl_usd"],
  );
  const series: Record<DashboardChartMetric, SeriesPoint[]> = {
    spot_price: [],
    funding_rate_apr: [],
    open_interest_usd: [],
    tvl_usd: [],
  };
  for (const metric of DASHBOARD_CHART_METRICS) {
    const grouped = await seriesForSubjects(ctx, [canonicalId], metric, from, MAX_SERIES_WINDOW);
    series[metric] = grouped.get(canonicalId) ?? [];
  }
  const related = await eventsForSubjects(
    ctx,
    [canonicalId],
    MAX_CHART_MARKERS + MAX_MORNING_EVENTS_PER_ASSET,
  );
  const eventIds = takeBounded(
    related.map((row) => row.id),
    MAX_CHART_MARKERS,
  );
  const evidenceRows =
    eventIds.length > 0
      ? await ctx.db
          .select({
            id: evidenceItems.id,
            title: evidenceItems.title,
            canonicalUrl: evidenceItems.canonicalUrl,
            publishedAt: evidenceItems.publishedAt,
            fetchedAt: evidenceItems.fetchedAt,
            sourceIdentityId: evidenceItems.sourceIdentityId,
            eventId: eventEvidence.eventId,
          })
          .from(eventEvidence)
          .innerJoin(evidenceItems, eq(eventEvidence.evidenceId, evidenceItems.id))
          .where(inArray(eventEvidence.eventId, eventIds))
          .orderBy(desc(evidenceItems.fetchedAt))
          .limit(MAX_ASSET_EVIDENCE)
      : [];
  const claimRows =
    eventIds.length > 0
      ? await ctx.db
          .select({
            claimId: claims.id,
            title: claims.title,
            kind: claims.kind,
            catalystKind: claims.kind,
            eventId: eventClaims.eventId,
            stance: eventClaims.stance,
            excerpt: claimEvidence.excerpt,
            evidenceId: claimEvidence.evidenceId,
          })
          .from(eventClaims)
          .innerJoin(claims, eq(eventClaims.claimId, claims.id))
          .leftJoin(claimEvidence, eq(claimEvidence.claimId, claims.id))
          .where(inArray(eventClaims.eventId, eventIds))
          .limit(MAX_ASSET_CLAIMS)
      : [];
  const identityIds = [
    ...new Set(
      evidenceRows
        .map((row) => row.sourceIdentityId)
        .filter((item): item is string => Boolean(item)),
    ),
  ];
  const identityRows =
    identityIds.length > 0
      ? await ctx.db
          .select({
            id: sourceIdentities.id,
            displayName: sourceIdentities.displayName,
            hostname: sourceIdentities.hostname,
            platform: sourceIdentities.platform,
          })
          .from(sourceIdentities)
          .where(inArray(sourceIdentities.id, takeBounded(identityIds, MAX_ASSET_IDENTITIES)))
          .limit(MAX_ASSET_IDENTITIES)
      : [];
  const identityById = new Map(identityRows.map((row) => [row.id, row]));
  const firstByEvent = new Map<string, { identityId: string; reportedAt: Date; eventId: string }>();
  for (const row of evidenceRows) {
    if (!row.sourceIdentityId) {
      continue;
    }
    const at = row.publishedAt ?? row.fetchedAt;
    const previous = firstByEvent.get(row.eventId);
    if (!previous || at.getTime() < previous.reportedAt.getTime()) {
      firstByEvent.set(row.eventId, {
        identityId: row.sourceIdentityId,
        reportedAt: at,
        eventId: row.eventId,
      });
    }
  }
  const spark = series.spot_price;
  const lastPrice = quotes.get(`spot_price:${canonicalId}`);
  const recordedChange = quotes.get(`price_change_24h:${canonicalId}`);
  const oldest = spark[0];
  return {
    asset: {
      canonicalId: asset.canonicalId,
      symbol: asset.symbol,
      name: asset.name,
      assetClass: asset.assetClass,
    },
    lastPrice: lastPrice ?? null,
    change24hPct: change24hPct({
      latest: lastPrice
        ? { observedAt: new Date(lastPrice.observedAt), value: lastPrice.value }
        : undefined,
      prior: oldest ? { observedAt: new Date(oldest.observedAt), value: oldest.value } : undefined,
      recordedChange: recordedChange?.value,
    }),
    funding: quotes.get(`funding_rate_apr:${canonicalId}`) ?? null,
    openInterest: quotes.get(`open_interest_usd:${canonicalId}`) ?? null,
    tvl: quotes.get(`tvl_usd:${canonicalId}`) ?? null,
    series,
    events: takeBounded(related, MAX_CHART_MARKERS).map((row) => ({
      id: row.id,
      title: row.title,
      reliabilityStatus: row.reliabilityStatus,
      impactLevel: row.impactLevel,
      lifecycleState: row.lifecycleState,
      catalystKind: row.catalystKind,
      firstObservedAt: row.firstObservedAt ? iso(row.firstObservedAt) : iso(row.windowStart),
      scheduledAt: row.scheduledAt ? iso(row.scheduledAt) : null,
    })),
    evidence: evidenceRows.map((row) => ({
      id: row.id,
      title: row.title,
      canonicalUrl: row.canonicalUrl,
      eventId: row.eventId,
      at: iso(row.publishedAt ?? row.fetchedAt),
    })),
    claims: takeBounded(
      [...new Map(claimRows.map((row) => [row.claimId, row])).values()],
      MAX_ASSET_CLAIMS,
    ).map((row) => ({
      claimId: row.claimId,
      title: row.title,
      kind: row.kind,
      stance: row.stance,
      excerpt: row.excerpt,
      evidenceId: row.evidenceId,
      eventId: row.eventId,
    })),
    firstIdentities: takeBounded([...firstByEvent.values()], MAX_ASSET_IDENTITIES).map((row) => {
      const identity = identityById.get(row.identityId);
      return {
        identityId: row.identityId,
        displayName: identity?.displayName ?? identity?.hostname ?? identity?.platform ?? null,
        eventId: row.eventId,
        reportedAt: iso(row.reportedAt),
      };
    }),
  };
}

export async function loadObservationSeries(
  ctx: AppContext,
  input: { subject: string; metric: DashboardChartMetric; limit?: number },
) {
  const limit = Math.min(input.limit ?? MAX_SERIES_WINDOW, MAX_SERIES_WINDOW);
  const from = new Date(Date.now() - DEFAULT_CHART_LOOKBACK_MS);
  const grouped = await seriesForSubjects(ctx, [input.subject], input.metric, from, limit);
  const points = grouped.get(input.subject) ?? [];
  return { subject: input.subject, metric: input.metric, points };
}

export function registerDashboardRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  authed: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
) {
  app.get("/api/v1/morning", { preHandler: authed }, async (request) => {
    const query = morningQuerySchema.parse(request.query);
    return loadMorning(ctx, query.since);
  });

  app.get("/api/v1/asset-desk", { preHandler: authed }, async (request, reply) => {
    const query = assetDeskQuerySchema.parse(request.query);
    const desk = await loadAssetDesk(ctx, query.canonicalId);
    if (!desk) {
      return sendError(reply, 404, "not_found", "Asset not found.");
    }
    return desk;
  });

  app.get("/api/v1/observation-series", { preHandler: authed }, async (request) => {
    const query = observationSeriesQuerySchema.parse(request.query);
    return loadObservationSeries(ctx, {
      subject: query.subject,
      metric: query.metric,
      limit: query.limit,
    });
  });
}
