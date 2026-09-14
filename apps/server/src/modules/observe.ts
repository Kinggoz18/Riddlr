import { createHash } from "node:crypto";
import { observationLatestQuerySchema, observationPinSchema } from "@riddlr/api-contract";
import { decryptSecretWithKeys } from "@riddlr/crypto";
import {
  agentPortfolios,
  agents,
  claimEvidence,
  claims,
  encryptedSecrets,
  evidenceItems,
  evidenceOccurrences,
  observationPins,
  observationSeries,
  portfolioHoldings,
  scans,
  sourceFetchRequests,
  sources,
  watchlistItems,
  watchlists,
} from "@riddlr/db";
import {
  canonicalizeFromRegistry,
  type DetectorSpec,
  detectFundingDivergenceForSubject,
  detectMarketStressForSubject,
  detectOddsJumpForSubject,
  detectorEvidenceFingerprint,
  detectPegDeviationForSubject,
  detectReturnShockForSubject,
  detectTvlDrawdownForSubject,
  detectVolumeAnomalyForSubject,
  excerptHash,
  fingerprintClaim,
  MAX_OBSERVATIONS_PER_POLL,
  MAX_OBSERVE_PINS,
  MAX_RETENTION_DELETE_BATCH,
  MAX_RETENTION_LOOPS,
  MAX_SERIES_WINDOW,
  normalizeEvidence,
  OBSERVATION_SERIES_ORIGIN_KEY,
  OBSERVE_NATIVE_SUBJECT_RE,
  type RawEvidence,
  takeBounded,
} from "@riddlr/domain";
import { CRYPTO_DETECTOR_SPECS } from "@riddlr/domain-crypto";
import { QUEUE_NAMES } from "@riddlr/queue";
import {
  BINANCE_FUTURES_PROVIDER_ID,
  COINGECKO_SPOT_PROVIDER_ID,
  createBinanceFuturesProvider,
  createCoinGeckoSpotProvider,
  createDefiLlamaProvider,
  createHyperliquidProvider,
  createKalshiProvider,
  createPolymarketProvider,
  DEFILLAMA_PROVIDER_ID,
  HYPERLIQUID_PROVIDER_ID,
  KALSHI_PROVIDER_ID,
  ObservationProviderRegistry,
  POLYMARKET_PROVIDER_ID,
  redactRequestUrl,
} from "@riddlr/source-adapters";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import type { AppContext } from "../context.js";
import {
  findRegistryAsset,
  listRegistryAssets,
  listWatchedCanonicalIds,
} from "./asset-registry.js";
import { clusterScanEvents } from "./pipeline.js";

const OBSERVE_LAST = "riddlr:observe:last:";
const OBSERVE_RESULT = "riddlr:observe:result:";
const OBSERVE_LOCK = "riddlr:observe:lock:";

export function createObservationProviders(): ObservationProviderRegistry {
  const registry = new ObservationProviderRegistry();
  registry.register(createCoinGeckoSpotProvider());
  registry.register(createDefiLlamaProvider());
  registry.register(createHyperliquidProvider());
  registry.register(createBinanceFuturesProvider());
  registry.register(createPolymarketProvider());
  registry.register(createKalshiProvider());
  return registry;
}

function executedRows(result: unknown): unknown[] {
  if (Array.isArray(result)) {
    return result;
  }
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows: unknown }).rows;
    if (Array.isArray(rows)) {
      return rows;
    }
  }
  return [];
}

function providers(ctx: AppContext): ObservationProviderRegistry {
  if (!ctx.observationProviders) {
    ctx.observationProviders = createObservationProviders();
  }
  return ctx.observationProviders;
}

function asCategoryMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string") {
      out[key] = item;
    }
  }
  return out;
}

async function coingeckoTokenHeaders(ctx: AppContext): Promise<Record<string, string>> {
  const [source] = await ctx.db
    .select()
    .from(sources)
    .where(eq(sources.adapterId, "coingecko"))
    .limit(1);
  if (!source?.secretId) {
    return {};
  }
  const [secret] = await ctx.db
    .select()
    .from(encryptedSecrets)
    .where(eq(encryptedSecrets.id, source.secretId))
    .limit(1);
  if (!secret) {
    return {};
  }
  const token = decryptSecretWithKeys({
    keys: ctx.masterKeys,
    secret: {
      ciphertext: secret.ciphertext,
      nonce: secret.nonce,
      tag: secret.tag,
      alg: "aes-256-gcm",
      keyVersion: secret.keyVersion,
    },
    purpose: secret.purpose,
    aad: `${secret.purpose}|${secret.keyVersion}`,
  });
  return token ? { token } : {};
}

export async function ensureObservationSource(ctx: AppContext, providerId: string) {
  const [existing] = await ctx.db
    .select()
    .from(sources)
    .where(eq(sources.adapterId, providerId))
    .limit(1);
  if (existing) {
    return existing;
  }
  const [row] = await ctx.db
    .insert(sources)
    .values({
      family: "observation",
      adapterId: providerId,
      name: providerId === COINGECKO_SPOT_PROVIDER_ID ? "CoinGecko spot observations" : providerId,
      enabled: true,
      config: {},
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create observation source.");
  }
  return row;
}

export async function listObserveSubjects(ctx: AppContext): Promise<string[]> {
  const watched = await listWatchedCanonicalIds(ctx);
  const pins = await ctx.db.select().from(observationPins).limit(MAX_OBSERVE_PINS);
  for (const pin of pins) {
    watched.add(pin.subjectCanonicalId);
  }
  return takeBounded([...watched], ctx.config.RIDDLR_OBSERVE_MAX_SUBJECTS);
}

async function futuresSymbolMap(ctx: AppContext, subjects: readonly string[]) {
  const registry = await listRegistryAssets(ctx);
  const watched = new Set(subjects);
  const map: Record<string, string> = {};
  for (const asset of registry) {
    if (!watched.has(asset.canonicalId)) {
      continue;
    }
    const symbol = asset.symbol?.trim();
    if (!symbol) {
      continue;
    }
    const resolved = canonicalizeFromRegistry({ symbol }, registry);
    if (resolved?.canonicalId === asset.canonicalId) {
      map[symbol.toUpperCase()] = asset.canonicalId;
    }
  }
  return map;
}

async function predictionAssetHints(ctx: AppContext, subjects: readonly string[]) {
  const registry = await listRegistryAssets(ctx);
  const watched = new Set(subjects);
  const hints: Array<{ canonicalId: string; symbol?: string; name?: string }> = [];
  for (const asset of registry) {
    if (!watched.has(asset.canonicalId)) {
      continue;
    }
    hints.push({
      canonicalId: asset.canonicalId,
      symbol: asset.symbol ?? undefined,
      name: asset.name ?? undefined,
    });
  }
  return takeBounded(hints, 64);
}

export async function latestSpotQuotes(
  ctx: AppContext,
  canonicalIds: readonly string[],
): Promise<Record<string, { value: number; unit: string; observedAt: string; provider: string }>> {
  const ids = takeBounded(
    [...new Set(canonicalIds.filter(Boolean))],
    ctx.config.RIDDLR_OBSERVE_MAX_SUBJECTS,
  );
  if (ids.length === 0) {
    return {};
  }
  const rawRows = await ctx.db.execute(sql`
    SELECT DISTINCT ON (subject_canonical_id)
      subject_canonical_id AS "subjectCanonicalId",
      value,
      unit,
      observed_at AS "observedAt",
      provider
    FROM observation_series
    WHERE metric = 'spot_price'
      AND resolution = 'raw'
      AND subject_canonical_id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})
    ORDER BY subject_canonical_id, observed_at DESC
    LIMIT ${ctx.config.RIDDLR_OBSERVE_MAX_SUBJECTS}
  `);
  const rows = executedRows(rawRows) as Array<{
    subjectCanonicalId: string;
    value: number;
    unit: string;
    observedAt: Date | string;
    provider: string;
  }>;
  const quotes: Record<
    string,
    { value: number; unit: string; observedAt: string; provider: string }
  > = {};
  for (const row of rows) {
    quotes[row.subjectCanonicalId] = {
      value: row.value,
      unit: row.unit,
      observedAt: new Date(row.observedAt).toISOString(),
      provider: row.provider,
    };
  }
  return quotes;
}

async function persistSeries(
  ctx: AppContext,
  rows: Array<{
    provider: string;
    metric: string;
    subjectCanonicalId: string;
    observedAt: Date;
    value: number;
    unit: string;
    fetchRequestId?: string;
  }>,
) {
  let inserted = 0;
  for (const row of takeBounded(rows, MAX_OBSERVATIONS_PER_POLL)) {
    const saved = await ctx.db
      .insert(observationSeries)
      .values({
        provider: row.provider,
        metric: row.metric,
        subjectCanonicalId: row.subjectCanonicalId,
        observedAt: row.observedAt,
        value: row.value,
        unit: row.unit,
        fetchRequestId: row.fetchRequestId,
        resolution: "raw",
      })
      .onConflictDoNothing({
        target: [
          observationSeries.provider,
          observationSeries.metric,
          observationSeries.subjectCanonicalId,
          observationSeries.observedAt,
          observationSeries.resolution,
        ],
      })
      .returning({ id: observationSeries.id });
    if (saved[0]) {
      inserted += 1;
    }
  }
  return inserted;
}

async function seriesWindow(
  ctx: AppContext,
  provider: string,
  metric: string,
  subjectCanonicalId: string,
) {
  const rows = await ctx.db
    .select({
      observedAt: observationSeries.observedAt,
      value: observationSeries.value,
    })
    .from(observationSeries)
    .where(
      and(
        eq(observationSeries.provider, provider),
        eq(observationSeries.metric, metric),
        eq(observationSeries.subjectCanonicalId, subjectCanonicalId),
        eq(observationSeries.resolution, "raw"),
      ),
    )
    .orderBy(desc(observationSeries.observedAt))
    .limit(MAX_SERIES_WINDOW);
  return rows.map((row) => ({ observedAt: row.observedAt, value: row.value })).reverse();
}

async function fundingDivergenceSeries(ctx: AppContext, subjectCanonicalId: string) {
  const predictedHl = await seriesWindow(
    ctx,
    HYPERLIQUID_PROVIDER_ID,
    "funding_predicted_apr",
    subjectCanonicalId,
  );
  const predictedBn = await seriesWindow(
    ctx,
    HYPERLIQUID_PROVIDER_ID,
    "funding_predicted_binance_apr",
    subjectCanonicalId,
  );
  return {
    left:
      predictedHl.length > 0
        ? predictedHl
        : await seriesWindow(ctx, HYPERLIQUID_PROVIDER_ID, "funding_rate_apr", subjectCanonicalId),
    right:
      predictedBn.length > 0
        ? predictedBn
        : await seriesWindow(
            ctx,
            BINANCE_FUTURES_PROVIDER_ID,
            "funding_rate_apr",
            subjectCanonicalId,
          ),
  };
}

export async function selectObserveAgent(ctx: AppContext, subjectCanonicalId: string) {
  const [fromWatchlist] = await ctx.db
    .select({ agent: agents })
    .from(agents)
    .innerJoin(watchlists, eq(watchlists.agentId, agents.id))
    .innerJoin(watchlistItems, eq(watchlistItems.watchlistId, watchlists.id))
    .where(and(eq(agents.enabled, true), eq(watchlistItems.canonicalId, subjectCanonicalId)))
    .orderBy(asc(agents.createdAt))
    .limit(1);
  if (fromWatchlist?.agent) {
    return fromWatchlist.agent;
  }
  const [fromHolding] = await ctx.db
    .select({ agent: agents })
    .from(agents)
    .innerJoin(agentPortfolios, eq(agentPortfolios.agentId, agents.id))
    .innerJoin(portfolioHoldings, eq(portfolioHoldings.portfolioId, agentPortfolios.portfolioId))
    .where(and(eq(agents.enabled, true), eq(portfolioHoldings.canonicalId, subjectCanonicalId)))
    .orderBy(asc(agents.createdAt))
    .limit(1);
  if (fromHolding?.agent) {
    return fromHolding.agent;
  }
  const [pin] = await ctx.db
    .select({ id: observationPins.id })
    .from(observationPins)
    .where(eq(observationPins.subjectCanonicalId, subjectCanonicalId))
    .limit(1);
  if (!pin) {
    return undefined;
  }
  const [fallback] = await ctx.db
    .select()
    .from(agents)
    .where(eq(agents.enabled, true))
    .orderBy(asc(agents.createdAt))
    .limit(1);
  return fallback;
}

async function persistDetectorFinding(
  ctx: AppContext,
  sourceId: string,
  fetchRequestId: string | undefined,
  finding: NonNullable<ReturnType<typeof detectReturnShockForSubject>>,
) {
  const agent = await selectObserveAgent(ctx, finding.subjectCanonicalId);
  if (!agent) {
    return { persisted: false, reason: "no_agent" as const };
  }
  const fingerprintKey = detectorEvidenceFingerprint(finding);
  const raw = {
    sourceFamily: "observation",
    adapterId: finding.detectorId,
    externalId: fingerprintKey,
    url: `riddlr:observation/${finding.detectorId}/${finding.version}/${finding.subjectCanonicalId}/${finding.polarity}`,
    title: finding.claimTitle,
    bodyText: finding.bodyText,
    fetchedAt: finding.windowEnd,
    publishedAt: finding.windowEnd,
    contentCompleteness: "native_complete" as const,
    originKey: OBSERVATION_SERIES_ORIGIN_KEY,
    adapterPayload: {
      detector: finding.detectorId,
      version: finding.version,
      metric: finding.metric,
      subjectCanonicalId: finding.subjectCanonicalId,
      unit: finding.unit,
      zScore: finding.zScore,
      thresholdAbsZ: finding.thresholdAbsZ,
      sampleCount: finding.sampleCount,
      series: takeBounded(
        finding.series.map((item) => ({
          observedAt: item.observedAt.toISOString(),
          value: item.value,
        })),
        finding.sampleCount + 1,
      ),
    },
  };
  const normalized = normalizeEvidence(raw);
  const day = finding.windowEnd.toISOString().slice(0, 10);
  const [scan] = await ctx.db
    .insert(scans)
    .values({
      agentId: agent.id,
      status: "observe",
      windowStart: finding.windowStart,
      idempotencyKey: `observe:${agent.id}:${day}`,
    })
    .onConflictDoNothing()
    .returning();
  const scanRow =
    scan ??
    (
      await ctx.db
        .select()
        .from(scans)
        .where(eq(scans.idempotencyKey, `observe:${agent.id}:${day}`))
        .limit(1)
    )[0];
  if (!scanRow) {
    return { persisted: false, reason: "scan" as const };
  }
  const [evidence] = await ctx.db
    .insert(evidenceItems)
    .values({
      sourceId,
      scanId: scanRow.id,
      fingerprint: normalized.fingerprint,
      contentHash: normalized.contentHash,
      canonicalUrl: normalized.canonicalUrl,
      title: normalized.title,
      bodyText: normalized.bodyText,
      publishedAt: normalized.publishedAt,
      fetchedAt: normalized.fetchedAt,
      adapterPayload: raw.adapterPayload,
      sourceFamily: "observation",
      adapterId: finding.detectorId,
      externalId: fingerprintKey,
      fetchRequestId,
      contentCompleteness: "native_complete",
      originKey: OBSERVATION_SERIES_ORIGIN_KEY,
    })
    .onConflictDoNothing()
    .returning();
  const evidenceRow =
    evidence ??
    (
      await ctx.db
        .select()
        .from(evidenceItems)
        .where(eq(evidenceItems.fingerprint, normalized.fingerprint))
        .limit(1)
    )[0];
  if (!evidenceRow) {
    return { persisted: false, reason: "evidence" as const };
  }
  await ctx.db
    .insert(evidenceOccurrences)
    .values({
      evidenceId: evidenceRow.id,
      scanId: scanRow.id,
      sourceId,
      fetchRequestId,
      observedAt: finding.windowEnd,
    })
    .onConflictDoNothing();
  const claim = {
    marketDomainId: "crypto" as const,
    kind: finding.claimKind,
    subjectCanonicalId: finding.subjectCanonicalId,
    predicate: finding.detectorId,
    objectText: `${finding.polarity} z=${finding.zScore.toFixed(2)}${finding.bodyText.includes(", agreed") ? " agreed" : ""}`,
    value: finding.zScore,
    unit: finding.unit,
    polarity: "asserted" as const,
    modality: "asserted" as const,
    fingerprint: fingerprintClaim({
      marketDomainId: "crypto",
      kind: finding.claimKind,
      subjectCanonicalId: finding.subjectCanonicalId,
      polarity: "asserted",
      objectText: finding.polarity,
      value: finding.polarity,
      timeBucket: day,
    }),
    title: finding.claimTitle,
  };
  const [savedClaim] = await ctx.db
    .insert(claims)
    .values({
      marketDomainId: claim.marketDomainId,
      kind: claim.kind,
      subjectCanonicalId: claim.subjectCanonicalId,
      predicate: claim.predicate,
      objectText: claim.objectText,
      value: claim.value,
      unit: claim.unit,
      polarity: claim.polarity,
      modality: claim.modality,
      fingerprint: claim.fingerprint,
      title: claim.title,
      policyVersion: finding.version,
      extractionVersion: `detector-${finding.detectorId}.${finding.version}`,
      effectiveStart: finding.windowEnd,
    })
    .onConflictDoNothing()
    .returning();
  const persistedClaim =
    savedClaim ??
    (
      await ctx.db.select().from(claims).where(eq(claims.fingerprint, claim.fingerprint)).limit(1)
    )[0];
  if (persistedClaim) {
    const excerpt = finding.bodyText.slice(0, 180);
    await ctx.db
      .insert(claimEvidence)
      .values({
        claimId: persistedClaim.id,
        evidenceId: evidenceRow.id,
        stance: "supports",
        excerpt,
        excerptHash: excerptHash(excerpt),
      })
      .onConflictDoNothing();
  }
  return {
    persisted: true,
    reason: "ok" as const,
    scan: scanRow,
    evidenceId: evidenceRow.id,
  };
}

async function persistHackEvidence(
  ctx: AppContext,
  sourceId: string,
  fetchRequestId: string | undefined,
  raw: RawEvidence,
  subjects: ReadonlySet<string>,
) {
  const payload = raw.adapterPayload ?? {};
  const subjectCanonicalId =
    typeof payload.subjectCanonicalId === "string" ? payload.subjectCanonicalId : undefined;
  if (!subjectCanonicalId || !subjects.has(subjectCanonicalId)) {
    return { persisted: false, reason: "unwatched" as const };
  }
  const agent = await selectObserveAgent(ctx, subjectCanonicalId);
  if (!agent) {
    return { persisted: false, reason: "no_agent" as const };
  }
  const normalized = normalizeEvidence(raw);
  const publishedAt = normalized.publishedAt ?? normalized.fetchedAt;
  const day = publishedAt.toISOString().slice(0, 10);
  const [scan] = await ctx.db
    .insert(scans)
    .values({
      agentId: agent.id,
      status: "observe",
      windowStart: publishedAt,
      idempotencyKey: `observe:${agent.id}:${day}`,
    })
    .onConflictDoNothing()
    .returning();
  const scanRow =
    scan ??
    (
      await ctx.db
        .select()
        .from(scans)
        .where(eq(scans.idempotencyKey, `observe:${agent.id}:${day}`))
        .limit(1)
    )[0];
  if (!scanRow) {
    return { persisted: false, reason: "scan" as const };
  }
  const amount =
    typeof payload.amount === "number" && Number.isFinite(payload.amount)
      ? payload.amount
      : undefined;
  const [evidence] = await ctx.db
    .insert(evidenceItems)
    .values({
      sourceId,
      scanId: scanRow.id,
      fingerprint: normalized.fingerprint,
      contentHash: normalized.contentHash,
      canonicalUrl: normalized.canonicalUrl,
      title: normalized.title,
      bodyText: normalized.bodyText,
      publishedAt: normalized.publishedAt,
      fetchedAt: normalized.fetchedAt,
      adapterPayload: payload,
      sourceFamily: raw.sourceFamily,
      adapterId: raw.adapterId,
      externalId: raw.externalId,
      fetchRequestId,
      contentCompleteness: "native_complete",
      originKey: normalized.originKey,
      referencedOriginKey: raw.referencedOriginKey,
    })
    .onConflictDoNothing()
    .returning();
  const evidenceRow =
    evidence ??
    (
      await ctx.db
        .select()
        .from(evidenceItems)
        .where(eq(evidenceItems.fingerprint, normalized.fingerprint))
        .limit(1)
    )[0];
  if (!evidenceRow) {
    return { persisted: false, reason: "evidence" as const };
  }
  await ctx.db
    .insert(evidenceOccurrences)
    .values({
      evidenceId: evidenceRow.id,
      scanId: scanRow.id,
      sourceId,
      fetchRequestId,
      observedAt: publishedAt,
    })
    .onConflictDoNothing();
  const objectText = normalized.bodyText?.slice(0, 180) ?? normalized.title ?? "hack";
  const claim = {
    marketDomainId: "crypto" as const,
    kind: "crypto:security_incident",
    subjectCanonicalId,
    predicate: "security_incident",
    objectText,
    value: amount ?? null,
    unit: amount != null ? "usd" : undefined,
    polarity: "asserted" as const,
    modality: "asserted" as const,
    fingerprint: fingerprintClaim({
      marketDomainId: "crypto",
      kind: "crypto:security_incident",
      subjectCanonicalId,
      polarity: "asserted",
      objectText,
      value: amount,
      timeBucket: day,
    }),
    title: normalized.title ?? `${subjectCanonicalId} security incident`,
  };
  const [savedClaim] = await ctx.db
    .insert(claims)
    .values({
      marketDomainId: claim.marketDomainId,
      kind: claim.kind,
      subjectCanonicalId: claim.subjectCanonicalId,
      predicate: claim.predicate,
      objectText: claim.objectText,
      value: claim.value,
      unit: claim.unit,
      polarity: claim.polarity,
      modality: claim.modality,
      fingerprint: claim.fingerprint,
      title: claim.title,
      policyVersion: "defillama-hacks-v1",
      extractionVersion: "detector-defillama_hacks.v1",
      effectiveStart: publishedAt,
    })
    .onConflictDoNothing()
    .returning();
  const persistedClaim =
    savedClaim ??
    (
      await ctx.db.select().from(claims).where(eq(claims.fingerprint, claim.fingerprint)).limit(1)
    )[0];
  if (persistedClaim) {
    const excerpt = objectText.slice(0, 180);
    await ctx.db
      .insert(claimEvidence)
      .values({
        claimId: persistedClaim.id,
        evidenceId: evidenceRow.id,
        stance: "supports",
        excerpt,
        excerptHash: excerptHash(excerpt),
      })
      .onConflictDoNothing();
  }
  return {
    persisted: true,
    reason: "ok" as const,
    scan: scanRow,
    evidenceId: evidenceRow.id,
  };
}

async function findingForDetector(
  ctx: AppContext,
  providerId: string,
  spec: DetectorSpec,
  subject: string,
  categories: Record<string, string>,
) {
  const points = await seriesWindow(ctx, providerId, spec.metric, subject);
  switch (spec.id) {
    case "return_shock":
      return detectReturnShockForSubject(subject, points, spec);
    case "volume_anomaly":
      return detectVolumeAnomalyForSubject(subject, points, spec);
    case "tvl_drawdown":
      return detectTvlDrawdownForSubject(subject, points, spec);
    case "peg_deviation":
      return detectPegDeviationForSubject(
        subject,
        points,
        await seriesWindow(ctx, COINGECKO_SPOT_PROVIDER_ID, "spot_price", subject),
        spec,
      );
    case "market_stress":
      return detectMarketStressForSubject(
        subject,
        {
          fundingApr: points,
          openInterestUsd: await seriesWindow(ctx, providerId, "open_interest_usd", subject),
          liquidations1mUsd: await seriesWindow(ctx, providerId, "liquidations_1m_usd", subject),
        },
        spec,
      );
    case "funding_divergence": {
      const series = await fundingDivergenceSeries(ctx, subject);
      return detectFundingDivergenceForSubject(subject, series.left, series.right, spec);
    }
    case "odds_jump":
      return detectOddsJumpForSubject(
        subject,
        {
          oddsYes: points,
          liquidityUsd: (await seriesWindow(ctx, providerId, "odds_liquidity_usd", subject)).at(-1)
            ?.value,
          otherVenueOddsYes: await seriesWindow(
            ctx,
            providerId === POLYMARKET_PROVIDER_ID ? KALSHI_PROVIDER_ID : POLYMARKET_PROVIDER_ID,
            "odds_yes",
            subject,
          ),
          claimKind:
            categories[subject] === "regulatory_or_legal_action"
              ? "crypto:regulatory_action"
              : spec.claimKind,
        },
        spec,
      );
    default:
      return undefined;
  }
}

async function runDetectors(
  ctx: AppContext,
  providerId: string,
  sourceId: string,
  fetchRequestId: string | undefined,
  subjects: readonly string[],
  sourceConfig: Record<string, unknown> = {},
) {
  const clustered = new Map<
    string,
    { scan: NonNullable<Awaited<ReturnType<typeof persistDetectorFinding>>["scan"]>; ids: string[] }
  >();
  const categories = asCategoryMap(sourceConfig.marketCategory);
  for (const subject of takeBounded(subjects, ctx.config.RIDDLR_OBSERVE_MAX_SUBJECTS)) {
    for (const spec of CRYPTO_DETECTOR_SPECS) {
      const specProvider = spec.provider ?? COINGECKO_SPOT_PROVIDER_ID;
      if (specProvider !== providerId) {
        continue;
      }
      const hit = await findingForDetector(ctx, providerId, spec, subject, categories);
      if (!hit) {
        ctx.metrics.detectorFindings.inc({ detector: spec.id, result: "none" });
        continue;
      }
      const saved = await persistDetectorFinding(ctx, sourceId, fetchRequestId, hit);
      ctx.metrics.detectorFindings.inc({
        detector: spec.id,
        result: saved.persisted ? "fired" : "skipped",
      });
      if (!saved.persisted || !saved.scan || !saved.evidenceId) {
        continue;
      }
      const current = clustered.get(saved.scan.id) ?? { scan: saved.scan, ids: [] };
      if (!current.ids.includes(saved.evidenceId)) {
        current.ids.push(saved.evidenceId);
      }
      clustered.set(saved.scan.id, current);
    }
  }
  for (const item of clustered.values()) {
    await clusterScanEvents(ctx, item.scan, item.ids);
  }
}

export async function retainObservationSeries(ctx: AppContext) {
  const retentionDays = ctx.config.RIDDLR_OBSERVE_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const olderThanRetention = sql`now() - (${retentionDays}::int * interval '1 day')`;
  await ctx.db.execute(sql`
    INSERT INTO observation_series (
      provider, metric, subject_canonical_id, observed_at, value, unit, resolution
    )
    SELECT
      provider,
      metric,
      subject_canonical_id,
      date_trunc('day', observed_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
      (array_agg(value ORDER BY observed_at DESC))[1],
      (array_agg(unit ORDER BY observed_at DESC))[1],
      'daily'
    FROM observation_series
    WHERE resolution = 'raw' AND observed_at < ${olderThanRetention}
    GROUP BY provider, metric, subject_canonical_id, date_trunc('day', observed_at AT TIME ZONE 'UTC')
    ON CONFLICT DO NOTHING
  `);
  let deleted = 0;
  for (let loop = 0; loop < MAX_RETENTION_LOOPS; loop += 1) {
    const result = await ctx.db.execute(sql`
      WITH doomed AS (
        SELECT id FROM observation_series
        WHERE resolution = 'raw' AND observed_at < ${olderThanRetention}
        LIMIT ${MAX_RETENTION_DELETE_BATCH}
      )
      DELETE FROM observation_series
      WHERE id IN (SELECT id FROM doomed)
      RETURNING id
    `);
    const countDeleted = executedRows(result).length;
    deleted += countDeleted;
    if (countDeleted === 0) {
      break;
    }
  }
  return { cutoff, deleted };
}

export async function observationHealth(ctx: AppContext) {
  const providerId = COINGECKO_SPOT_PROVIDER_ID;
  const lastPollAt = await ctx.redis.get(`${OBSERVE_LAST}${providerId}`);
  const lastResult = await ctx.redis.get(`${OBSERVE_RESULT}${providerId}`);
  const subjects = await listObserveSubjects(ctx);
  const [series] = await ctx.db
    .select({ value: count() })
    .from(observationSeries)
    .where(eq(observationSeries.resolution, "raw"));
  const [latest] = await ctx.db
    .select({ observedAt: observationSeries.observedAt })
    .from(observationSeries)
    .where(eq(observationSeries.resolution, "raw"))
    .orderBy(desc(observationSeries.observedAt))
    .limit(1);
  const freshnessGapSeconds = latest?.observedAt
    ? Math.max(0, Math.floor((Date.now() - latest.observedAt.getTime()) / 1000))
    : null;
  return {
    provider: providerId,
    lastPollAt,
    lastResult,
    subjectCount: subjects.length,
    seriesCount: Number(series?.value ?? 0),
    freshnessGapSeconds,
    intervalSeconds: ctx.config.RIDDLR_OBSERVE_PRICE_INTERVAL_SECONDS,
    retentionDays: ctx.config.RIDDLR_OBSERVE_RETENTION_DAYS,
    providers: await Promise.all(
      providers(ctx)
        .list()
        .map(async (item) => ({
          id: item.id,
          lastPollAt: await ctx.redis.get(`${OBSERVE_LAST}${item.id}`),
          lastResult: await ctx.redis.get(`${OBSERVE_RESULT}${item.id}`),
          intervalSeconds:
            item.id === COINGECKO_SPOT_PROVIDER_ID
              ? ctx.config.RIDDLR_OBSERVE_PRICE_INTERVAL_SECONDS
              : Math.round(item.defaultIntervalMs / 1000),
        })),
    ),
  };
}

function observationProviderForPoll(ctx: AppContext, providerId: string, fetchImpl?: typeof fetch) {
  const registry = providers(ctx);
  if (fetchImpl && providerId === COINGECKO_SPOT_PROVIDER_ID) {
    return createCoinGeckoSpotProvider({
      fetchImpl,
      intervalMs: ctx.config.RIDDLR_OBSERVE_PRICE_INTERVAL_SECONDS * 1000,
    });
  }
  if (fetchImpl && providerId === DEFILLAMA_PROVIDER_ID) {
    return createDefiLlamaProvider({ fetchImpl, minIntervalMs: 0 });
  }
  if (fetchImpl && providerId === HYPERLIQUID_PROVIDER_ID) {
    return createHyperliquidProvider({ fetchImpl, minIntervalMs: 0 });
  }
  if (fetchImpl && providerId === BINANCE_FUTURES_PROVIDER_ID) {
    return createBinanceFuturesProvider({
      fetchImpl,
      minIntervalMs: 0,
      drainLiquidations: () => [],
    });
  }
  if (fetchImpl && providerId === POLYMARKET_PROVIDER_ID) {
    return createPolymarketProvider({ fetchImpl, minIntervalMs: 0 });
  }
  if (fetchImpl && providerId === KALSHI_PROVIDER_ID) {
    return createKalshiProvider({ fetchImpl, minIntervalMs: 0 });
  }
  return registry.require(providerId);
}

function intervalSecondsFor(ctx: AppContext, provider: { id: string; defaultIntervalMs: number }) {
  if (provider.id === COINGECKO_SPOT_PROVIDER_ID) {
    return ctx.config.RIDDLR_OBSERVE_PRICE_INTERVAL_SECONDS;
  }
  return Math.max(30, Math.ceil(provider.defaultIntervalMs / 1000));
}

export async function pollObservationProvider(
  ctx: AppContext,
  providerId: string,
  fetchImpl?: typeof fetch,
) {
  const provider = observationProviderForPoll(ctx, providerId, fetchImpl);
  if (provider.optIn) {
    const [existing] = await ctx.db
      .select()
      .from(sources)
      .where(and(eq(sources.adapterId, provider.id), eq(sources.enabled, true)))
      .limit(1);
    if (!existing) {
      ctx.metrics.observePolls.inc({ provider: provider.id, result: "source_disabled" });
      return { observations: 0, error: "source_disabled" };
    }
  }
  const lockTtl = intervalSecondsFor(ctx, provider);
  const locked = await ctx.redis.set(`${OBSERVE_LOCK}${provider.id}`, "1", "EX", lockTtl, "NX");
  if (!locked) {
    ctx.metrics.observePolls.inc({ provider: provider.id, result: "lock_held" });
    return { observations: 0, error: "lock_held" };
  }
  const subjects = await listObserveSubjects(ctx);
  const source = provider.optIn
    ? (
        await ctx.db
          .select()
          .from(sources)
          .where(and(eq(sources.adapterId, provider.id), eq(sources.enabled, true)))
          .limit(1)
      )[0]
    : await ensureObservationSource(ctx, provider.id);
  if (!source) {
    return { observations: 0, error: "source_disabled" };
  }
  const headers =
    provider.id === COINGECKO_SPOT_PROVIDER_ID ? await coingeckoTokenHeaders(ctx) : {};
  const now = new Date();
  const batchSize = ctx.config.RIDDLR_OBSERVE_BATCH_SIZE;
  let inserted = 0;
  let lastFetchId: string | undefined;
  let lastError: string | undefined;
  let lastClass: string | undefined;
  const batches: string[][] = provider.optIn
    ? [subjects]
    : (() => {
        const groups: string[][] = [];
        for (let index = 0; index < subjects.length; index += batchSize) {
          groups.push(subjects.slice(index, index + batchSize));
        }
        return groups;
      })();
  const subjectSet = new Set(subjects);
  const detectorSubjects = new Set(subjects);
  let mergedConfig: Record<string, unknown> = { ...source.config };
  for (const batch of takeBounded(batches, 40)) {
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ provider: provider.id, ids: batch, at: now.toISOString() }))
      .digest("hex");
    const [fetchRequest] = await ctx.db
      .insert(sourceFetchRequests)
      .values({
        sourceId: source.id,
        adapterId: provider.id,
        requestHash,
        status: "running",
      })
      .returning();
    const observeConfig: Record<string, unknown> = { ...source.config, ...headers };
    if (provider.id === HYPERLIQUID_PROVIDER_ID || provider.id === BINANCE_FUTURES_PROVIDER_ID) {
      observeConfig.symbolMap = await futuresSymbolMap(ctx, batch);
    }
    if (provider.id === POLYMARKET_PROVIDER_ID || provider.id === KALSHI_PROVIDER_ID) {
      observeConfig.assetHints = await predictionAssetHints(ctx, batch);
    }
    const result = await provider.observe(observeConfig, {
      subjectCanonicalIds: batch,
      observedAt: now,
    });
    lastClass = result.errors[0]?.class;
    lastError = result.errors[0]?.message;
    if (fetchRequest) {
      lastFetchId = fetchRequest.id;
      await ctx.db
        .update(sourceFetchRequests)
        .set({
          status: result.errors.length && result.observations.length === 0 ? "failed" : "succeeded",
          errorClass: result.errors[0]?.class,
          finishedAt: new Date(),
          evidenceCount: result.observations.length + (result.evidence?.length ?? 0),
          requestUrl: result.requestUrl ? redactRequestUrl(result.requestUrl) : undefined,
          responseStatus: result.responseStatus,
        })
        .where(eq(sourceFetchRequests.id, fetchRequest.id));
    }
    await ctx.db
      .update(sources)
      .set({
        lastHealthOk: result.observations.length > 0 || result.errors.length === 0,
        lastHealthMessage: result.errors[0]?.message ?? "ok",
        lastHealthAt: new Date(),
        ...(result.persistConfig ? { config: { ...source.config, ...result.persistConfig } } : {}),
      })
      .where(eq(sources.id, source.id));
    if (result.persistConfig) {
      mergedConfig = { ...mergedConfig, ...result.persistConfig };
    }
    if (result.errors.some((item) => item.class === "rate_limited")) {
      ctx.metrics.observePolls.inc({ provider: provider.id, result: "rate_limited" });
      await ctx.redis.set(`${OBSERVE_LAST}${provider.id}`, now.toISOString(), "EX", 7 * 24 * 3600);
      await ctx.redis.set(`${OBSERVE_RESULT}${provider.id}`, "rate_limited", "EX", 7 * 24 * 3600);
      return { observations: inserted, error: "rate_limited" };
    }
    inserted += await persistSeries(
      ctx,
      result.observations.map((item) => ({
        ...item,
        fetchRequestId: fetchRequest?.id,
      })),
    );
    for (const item of result.observations) {
      detectorSubjects.add(item.subjectCanonicalId);
    }
    const clustered = new Map<
      string,
      { scan: NonNullable<Awaited<ReturnType<typeof persistHackEvidence>>["scan"]>; ids: string[] }
    >();
    for (const item of result.evidence ?? []) {
      const saved = await persistHackEvidence(ctx, source.id, fetchRequest?.id, item, subjectSet);
      if (!saved.persisted || !saved.scan || !saved.evidenceId) {
        continue;
      }
      const current = clustered.get(saved.scan.id) ?? { scan: saved.scan, ids: [] };
      if (!current.ids.includes(saved.evidenceId)) {
        current.ids.push(saved.evidenceId);
      }
      clustered.set(saved.scan.id, current);
    }
    for (const item of clustered.values()) {
      await clusterScanEvents(ctx, item.scan, item.ids);
    }
  }
  await runDetectors(ctx, provider.id, source.id, lastFetchId, [...detectorSubjects], mergedConfig);
  await retainObservationSeries(ctx);
  const resultLabel = lastClass && inserted === 0 ? lastClass : inserted === 0 ? "empty" : "ok";
  ctx.metrics.observePolls.inc({ provider: provider.id, result: resultLabel });
  await ctx.redis.set(`${OBSERVE_LAST}${provider.id}`, now.toISOString(), "EX", 7 * 24 * 3600);
  await ctx.redis.set(`${OBSERVE_RESULT}${provider.id}`, resultLabel, "EX", 7 * 24 * 3600);
  return { observations: inserted, error: inserted === 0 ? lastError : undefined };
}

export async function enqueueObserveIfDue(ctx: AppContext) {
  if (ctx.config.RIDDLR_ENV === "test" || !ctx.observeQueue) {
    return;
  }
  const now = Date.now();
  for (const provider of providers(ctx).list()) {
    if (provider.optIn) {
      const [existing] = await ctx.db
        .select({ id: sources.id })
        .from(sources)
        .where(and(eq(sources.adapterId, provider.id), eq(sources.enabled, true)))
        .limit(1);
      if (!existing) {
        continue;
      }
    }
    const intervalMs =
      provider.id === COINGECKO_SPOT_PROVIDER_ID
        ? ctx.config.RIDDLR_OBSERVE_PRICE_INTERVAL_SECONDS * 1000
        : provider.defaultIntervalMs;
    const last = await ctx.redis.get(`${OBSERVE_LAST}${provider.id}`);
    const due = !last || now - new Date(last).getTime() >= intervalMs;
    if (!due) {
      continue;
    }
    const bucket = Math.floor(now / intervalMs);
    await ctx.observeQueue.add(
      QUEUE_NAMES.observePoll,
      { providerId: provider.id, idempotencyKey: `${provider.id}:${bucket}` },
      { jobId: `observe:${provider.id}:${bucket}`, removeOnComplete: 100, removeOnFail: 100 },
    );
  }
}

export async function addObservationPin(
  ctx: AppContext,
  input: { subjectCanonicalId: string; metric?: string; provider?: string },
) {
  const subject = input.subjectCanonicalId.trim();
  const native = OBSERVE_NATIVE_SUBJECT_RE.test(subject);
  const asset = native ? undefined : await findRegistryAsset(ctx, subject);
  if (!native && !asset) {
    const error = new Error("Unknown asset.");
    (error as Error & { statusCode?: number; code?: string }).statusCode = 400;
    (error as Error & { code?: string }).code = "unknown_asset";
    throw error;
  }
  const canonicalId = native ? subject : (asset?.canonicalId as string);
  const [{ value: existing } = { value: 0 }] = await ctx.db
    .select({ value: count() })
    .from(observationPins);
  if (Number(existing) >= MAX_OBSERVE_PINS) {
    const error = new Error(`At most ${MAX_OBSERVE_PINS} pinned series.`);
    (error as Error & { statusCode?: number; code?: string }).statusCode = 400;
    (error as Error & { code?: string }).code = "pin_limit";
    throw error;
  }
  const [row] = await ctx.db
    .insert(observationPins)
    .values({
      provider: input.provider ?? COINGECKO_SPOT_PROVIDER_ID,
      metric: input.metric ?? "spot_price",
      subjectCanonicalId: canonicalId,
    })
    .onConflictDoNothing()
    .returning();
  return (
    row ??
    (
      await ctx.db
        .select()
        .from(observationPins)
        .where(
          and(
            eq(observationPins.provider, input.provider ?? COINGECKO_SPOT_PROVIDER_ID),
            eq(observationPins.metric, input.metric ?? "spot_price"),
            eq(observationPins.subjectCanonicalId, canonicalId),
          ),
        )
        .limit(1)
    )[0]
  );
}

export async function listObservationPins(ctx: AppContext) {
  return ctx.db.select().from(observationPins).limit(MAX_OBSERVE_PINS);
}

export async function removeObservationPin(ctx: AppContext, id: string) {
  await ctx.db.delete(observationPins).where(eq(observationPins.id, id));
}

function sendError(
  reply: import("fastify").FastifyReply,
  status: number,
  code: string,
  message: string,
) {
  return reply.code(status).send({ error: { code, message } });
}

export function registerObservationRoutes(
  app: import("fastify").FastifyInstance,
  ctx: AppContext,
  authed: (
    request: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply,
  ) => Promise<unknown>,
) {
  app.get("/api/v1/observations/latest", { preHandler: authed }, async (request) => {
    const query = observationLatestQuerySchema.parse(request.query);
    const subjects = query.q
      ? query.q
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : await listObserveSubjects(ctx);
    const quotes = await latestSpotQuotes(ctx, takeBounded(subjects, query.limit ?? 50));
    return {
      quotes: Object.entries(quotes).map(([canonicalId, quote]) => ({
        canonicalId,
        ...quote,
      })),
    };
  });

  app.get("/api/v1/observations/pins", { preHandler: authed }, async () => {
    const pins = await listObservationPins(ctx);
    return { pins };
  });

  app.post("/api/v1/observations/pins", { preHandler: authed }, async (request, reply) => {
    try {
      const body = observationPinSchema.parse(request.body);
      const pin = await addObservationPin(ctx, body);
      return { pin };
    } catch (error) {
      const code = (error as Error & { code?: string }).code;
      const status = (error as Error & { statusCode?: number }).statusCode ?? 400;
      return sendError(
        reply,
        status,
        code ?? "invalid",
        error instanceof Error ? error.message : "Invalid pin.",
      );
    }
  });

  app.delete("/api/v1/observations/pins/:id", { preHandler: authed }, async (request) => {
    const { id } = request.params as { id: string };
    await removeObservationPin(ctx, id);
    return { ok: true };
  });
}
