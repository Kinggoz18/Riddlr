import { createHash } from "node:crypto";
import { decryptSecretWithKeys } from "@riddlr/crypto";
import {
  agentMarketDomains,
  agentSkills,
  agentSources,
  agents,
  aiUsageEvents,
  analyses,
  analysisCache,
  assets,
  claimEvidence,
  claims,
  encryptedSecrets,
  eventAssessmentReasons,
  eventAssessments,
  eventAssets,
  eventClaims,
  eventEvidence,
  events,
  evidenceItems,
  evidenceOccurrences,
  evidenceRelations,
  instanceSettings,
  observationPins,
  observationSeries,
  observations,
  portfolioHoldings,
  providerConfigs,
  publisherHostPolicies,
  scanSourceRuns,
  scans,
  signalClaimProofs,
  signals,
  skills,
  sourceFetchRequests,
  sources,
  tokenBudgetReservations,
  watchlistItems,
  watchlists,
} from "@riddlr/db";
import {
  absorbMarketDataClusters,
  absorbObservationClusters,
  analysisReservationTokens,
  assessReliability,
  blockedPublisherHosts,
  buildEventFacts,
  canonicalizeUrl,
  claimGroupKey,
  classifyReprint,
  clusterEventTitle,
  clusterEvidence,
  decideSignalGate,
  discoverCandidate,
  estimatePromptTokens,
  eventClusterFingerprint,
  factsToApplicability,
  formatAnalysisFacts,
  formatDiscoveryNotes,
  headlineBodyMismatch,
  independenceCounts,
  isMaterialEvent,
  isNearDuplicate,
  isObservedAnomalyKind,
  lineageOriginKey,
  MAX_EVENTS_PER_SCAN,
  MAX_OBSERVATIONS_PER_EVENT,
  MAX_OBSERVE_PINS,
  MAX_SEARXNG_ASSET_QUERIES,
  MAX_SKILLS_PER_AGENT,
  MAX_WATCHLIST_ITEMS,
  type MarketObservation,
  nextEventStatus,
  normalizeEvidence,
  observationsFromDetectorPayload,
  observationsFromMarketPayload,
  overlappingOutbound,
  type RawEvidence,
  type ReliabilityStatus,
  resolveDailyTokenBudget,
  SIGNAL_JSON_SCHEMA,
  SIGNAL_SCHEMA_VERSION,
  selectApplicableSkills,
  shouldSkipForDailyTokenBudget,
  skippedSkillNotice,
  sourceHostname,
  takeBounded,
  textOpposes,
  uniqueIndependentHosts,
  utcDayRange,
  utcDayStamp,
  validateSignalOutput,
} from "@riddlr/domain";
import {
  buildAnalysisPrompt,
  createAnthropicCompatibleProvider,
  createOpenAiCompatibleProvider,
} from "@riddlr/llm";
import {
  createAlchemyAdapter,
  createBinanceFuturesAdapter,
  createCoinGeckoAdapter,
  createCoinMarketCapAdapter,
  createCryptoComAdapter,
  createDefiLlamaAdapter,
  createDiscordAdapter,
  createFeedsAdapter,
  createHeliusAdapter,
  createHyperliquidAdapter,
  createKalshiAdapter,
  createPolymarketAdapter,
  createSearxngAdapter,
  createSnapshotAdapter,
  createXAdapter,
  type FetchResult,
  parseSnapshotSpaces,
  redactRequestUrl,
  SourceAdapterRegistry,
} from "@riddlr/source-adapters";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { AppContext } from "../context.js";
import { listRegistryAssets, snapshotSpacesForAgent } from "./asset-registry.js";
import {
  enrichAndUnderstandScan,
  ensureOfficialSnapshotSpace,
  loadTrustMaps,
  upsertSourceIdentity,
} from "./intelligence.js";
import { maybeNotify } from "./notify.js";

async function instanceEarlyWarningsEnabled(ctx: AppContext): Promise<boolean> {
  if (ctx.config.RIDDLR_EARLY_WARNING === "true") {
    return true;
  }
  const [settings] = await ctx.db.select().from(instanceSettings).limit(1);
  return settings?.notificationPolicy?.earlyWarnings === true;
}

async function instanceShadowAssessments(ctx: AppContext): Promise<boolean> {
  if (ctx.config.RIDDLR_SHADOW_ASSESSMENTS === "true") {
    return true;
  }
  const [settings] = await ctx.db.select().from(instanceSettings).limit(1);
  return settings?.notificationPolicy?.shadowAssessments === true;
}

const STALE_MS = 48 * 60 * 60 * 1000;

function payloadUrls(payload?: Record<string, unknown> | null): string[] | undefined {
  const raw = payload?.outboundUrls;
  if (!Array.isArray(raw)) {
    return undefined;
  }
  return raw.filter((item): item is string => typeof item === "string");
}

function payloadText(
  payload: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  const value = payload?.[key];
  return typeof value === "string" ? value : undefined;
}

function strongestStance(stances: string[]): string {
  const rank: Record<string, number> = {
    retracts: 4,
    contradicts: 3,
    derived_from: 2,
    updates: 1,
    quotes: 0,
    supports: 0,
  };
  return (
    [...stances].sort((left, right) => (rank[right] ?? 0) - (rank[left] ?? 0))[0] ?? "supports"
  );
}

async function defiLlamaContextObservations(
  ctx: AppContext,
  canonicalIds: readonly string[],
): Promise<MarketObservation[]> {
  const ids = takeBounded([...new Set(canonicalIds.filter(Boolean))], 16);
  if (ids.length === 0) {
    return [];
  }
  const rows = await ctx.db
    .select({
      subjectCanonicalId: observationSeries.subjectCanonicalId,
      value: observationSeries.value,
      unit: observationSeries.unit,
      observedAt: observationSeries.observedAt,
    })
    .from(observationSeries)
    .where(
      and(
        eq(observationSeries.provider, "defillama"),
        eq(observationSeries.metric, "tvl_usd"),
        eq(observationSeries.resolution, "raw"),
        inArray(observationSeries.subjectCanonicalId, ids),
      ),
    )
    .orderBy(desc(observationSeries.observedAt))
    .limit(ids.length * 8);
  const bySubject = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = bySubject.get(row.subjectCanonicalId) ?? [];
    if (list.length < 8) {
      list.push(row);
      bySubject.set(row.subjectCanonicalId, list);
    }
  }
  const out: MarketObservation[] = [];
  for (const [subject, series] of bySubject) {
    const latest = series[0];
    if (!latest) {
      continue;
    }
    out.push({
      kind: "tvl_usd",
      assetCanonicalId: subject,
      value: latest.value,
      unit: latest.unit,
      observedAt: latest.observedAt,
      sourceId: "defillama",
    });
    const target = latest.observedAt.getTime() - 24 * 60 * 60 * 1000;
    const prior = series.find(
      (item) => Math.abs(item.observedAt.getTime() - target) <= 6 * 60 * 60 * 1000,
    );
    if (prior && prior.value > 0 && prior !== latest) {
      out.push({
        kind: "tvl_change_1d",
        assetCanonicalId: subject,
        value: ((latest.value - prior.value) / prior.value) * 100,
        unit: "percent",
        observedAt: latest.observedAt,
        sourceId: "defillama",
      });
    }
  }
  return out;
}

async function perpContextObservations(
  ctx: AppContext,
  canonicalIds: readonly string[],
): Promise<MarketObservation[]> {
  const ids = takeBounded([...new Set(canonicalIds.filter(Boolean))], 16);
  if (ids.length === 0) {
    return [];
  }
  const rows = await ctx.db
    .select({
      provider: observationSeries.provider,
      metric: observationSeries.metric,
      subjectCanonicalId: observationSeries.subjectCanonicalId,
      value: observationSeries.value,
      unit: observationSeries.unit,
      observedAt: observationSeries.observedAt,
    })
    .from(observationSeries)
    .where(
      and(
        inArray(observationSeries.provider, ["hyperliquid", "binance-futures"]),
        inArray(observationSeries.metric, [
          "funding_rate_apr",
          "open_interest_usd",
          "volume_24h_usd",
        ]),
        eq(observationSeries.resolution, "raw"),
        inArray(observationSeries.subjectCanonicalId, ids),
      ),
    )
    .orderBy(desc(observationSeries.observedAt))
    .limit(ids.length * 12);
  const seen = new Set<string>();
  const out: MarketObservation[] = [];
  for (const row of rows) {
    const key = `${row.provider}|${row.metric}|${row.subjectCanonicalId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({
      kind: row.metric,
      assetCanonicalId: row.subjectCanonicalId,
      value: row.value,
      unit: row.unit,
      observedAt: row.observedAt,
      sourceId: row.provider,
    });
  }
  return out;
}

async function oddsContextObservations(
  ctx: AppContext,
  canonicalIds: readonly string[],
): Promise<MarketObservation[]> {
  const ids = takeBounded([...new Set(canonicalIds.filter(Boolean))], 16);
  if (ids.length === 0) {
    return [];
  }
  const rows = await ctx.db
    .select({
      provider: observationSeries.provider,
      metric: observationSeries.metric,
      subjectCanonicalId: observationSeries.subjectCanonicalId,
      value: observationSeries.value,
      unit: observationSeries.unit,
      observedAt: observationSeries.observedAt,
    })
    .from(observationSeries)
    .where(
      and(
        inArray(observationSeries.provider, ["polymarket", "kalshi"]),
        inArray(observationSeries.metric, ["odds_yes", "odds_change_1h", "odds_change_24h"]),
        eq(observationSeries.resolution, "raw"),
        inArray(observationSeries.subjectCanonicalId, ids),
      ),
    )
    .orderBy(desc(observationSeries.observedAt))
    .limit(ids.length * 12);
  const seen = new Set<string>();
  const out: MarketObservation[] = [];
  for (const row of rows) {
    const key = `${row.provider}|${row.metric}|${row.subjectCanonicalId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({
      kind: row.metric,
      assetCanonicalId: row.subjectCanonicalId,
      value: row.value,
      unit: row.unit,
      observedAt: row.observedAt,
      sourceId: row.provider,
    });
  }
  return out;
}

export async function runScan(
  ctx: AppContext,
  scanId: string,
  deps: { fetchImpl?: typeof fetch } = {},
) {
  const scanRows = await ctx.db.select().from(scans).where(eq(scans.id, scanId));
  const scan = scanRows[0];
  if (!scan) {
    throw new Error(`Unknown scan ${scanId}`);
  }
  try {
    await ctx.db.update(scans).set({ status: "running" }).where(eq(scans.id, scanId));
    const sourceRows = await ctx.db
      .select({ source: sources })
      .from(agentSources)
      .innerJoin(sources, eq(agentSources.sourceId, sources.id))
      .where(and(eq(agentSources.agentId, scan.agentId), eq(sources.enabled, true)))
      .limit(ctx.config.RIDDLR_SCAN_SOURCE_LIMIT);
    const boundSources = sourceRows
      .map((row) => row.source)
      .sort(
        (left, right) =>
          left.adapterId.localeCompare(right.adapterId) || left.id.localeCompare(right.id),
      );
    if (boundSources.length === 0) {
      await ctx.db
        .update(scans)
        .set({
          status: "failed",
          error: "Agent has no enabled sources.",
          finishedAt: new Date(),
        })
        .where(eq(scans.id, scanId));
      return;
    }
    const adapters = new SourceAdapterRegistry();
    adapters.register(createSearxngAdapter(deps.fetchImpl ?? fetch));
    adapters.register(createDiscordAdapter(deps.fetchImpl ?? fetch));
    adapters.register(createXAdapter(deps.fetchImpl ?? fetch));
    adapters.register(createFeedsAdapter(deps.fetchImpl ?? fetch));
    adapters.register(createDefiLlamaAdapter(deps.fetchImpl ?? fetch));
    adapters.register(createHyperliquidAdapter(deps.fetchImpl ?? fetch));
    adapters.register(createBinanceFuturesAdapter(deps.fetchImpl ?? fetch));
    adapters.register(createPolymarketAdapter(deps.fetchImpl ?? fetch));
    adapters.register(createKalshiAdapter(deps.fetchImpl ?? fetch));
    adapters.register(createSnapshotAdapter(deps.fetchImpl ?? fetch));
    adapters.register(createAlchemyAdapter(deps.fetchImpl ?? fetch));
    adapters.register(createHeliusAdapter());
    adapters.register(createCoinGeckoAdapter(deps.fetchImpl ?? fetch));
    adapters.register(createCoinMarketCapAdapter(deps.fetchImpl ?? fetch));
    adapters.register(createCryptoComAdapter(deps.fetchImpl ?? fetch));
    const agentContext = await loadAgentScanContext(ctx, scan.agentId);
    const module = agentContext.module;
    let partial = false;
    let sourceFailures = 0;
    let sourceSuccesses = 0;
    const collected = [];
    const publisherPolicies = await ctx.db.select().from(publisherHostPolicies).limit(256);
    const blockedHosts = blockedPublisherHosts(publisherPolicies);

    const perSourceQuota = Math.max(
      1,
      Math.floor(ctx.config.RIDDLR_SCAN_EVIDENCE_LIMIT / Math.max(1, boundSources.length)),
    );
    for (const source of boundSources) {
      const adapter = adapters.get(source.adapterId);
      if (!adapter) {
        await ctx.db.insert(scanSourceRuns).values({
          scanId,
          sourceId: source.id,
          status: "skipped",
          errorClass: "capability_missing",
          errorMessage: "Adapter not implemented",
        });
        continue;
      }
      const remaining: number = Math.min(
        perSourceQuota,
        ctx.config.RIDDLR_SCAN_EVIDENCE_LIMIT - collected.length,
      );
      if (remaining <= 0) {
        break;
      }
      const runtimeConfig: Record<string, unknown> = { ...source.config };
      if (source.adapterId === "snapshot") {
        const derived = await snapshotSpacesForAgent(ctx, agentContext.watchlist);
        const existingAssets =
          source.config.spaceAssets &&
          typeof source.config.spaceAssets === "object" &&
          !Array.isArray(source.config.spaceAssets)
            ? (source.config.spaceAssets as Record<string, string>)
            : {};
        runtimeConfig.derivedSpaces = derived.spaces;
        runtimeConfig.spaceAssets = { ...existingAssets, ...derived.spaceAssets };
        for (const space of parseSnapshotSpaces([
          ...(Array.isArray(source.config.spaces) ? source.config.spaces : []),
          ...derived.spaces,
        ])) {
          await ensureOfficialSnapshotSpace(ctx, space);
        }
      }
      if (source.secretId) {
        const secretRows = await ctx.db
          .select()
          .from(encryptedSecrets)
          .where(eq(encryptedSecrets.id, source.secretId))
          .limit(1);
        const secret = secretRows[0];
        if (secret) {
          runtimeConfig.token = decryptSecretWithKeys({
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
        }
      }
      const queryTexts =
        adapter.id === "searxng"
          ? takeBounded(
              [
                ...new Set(
                  module
                    .sourceQueries({
                      adapterId: adapter.id,
                      watchlist: agentContext.watchlist,
                    })
                    .map((item) => item.trim())
                    .filter(Boolean),
                ),
              ],
              MAX_SEARXNG_ASSET_QUERIES + 1,
            )
          : module.sourceQueries({
              adapterId: adapter.id,
              watchlist: agentContext.watchlist,
            });
      const texts = queryTexts.length > 0 ? queryTexts : [""];
      const requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            sourceId: source.id,
            adapterId: source.adapterId,
            queries: texts,
          }),
        )
        .digest("hex");
      const merged: Array<{ raw: RawEvidence; fetchRequestId?: string }> = [];
      const seenUrls = new Set<string>();
      const allErrors: FetchResult["errors"] = [];
      let anyPartial = false;
      let lastPersistConfig: Record<string, unknown> | undefined;
      for (const queryText of texts) {
        const [fetchRequest] = await ctx.db
          .insert(sourceFetchRequests)
          .values({
            scanId,
            sourceId: source.id,
            adapterId: source.adapterId,
            requestHash,
            requestUrl: redactRequestUrl(
              `https://adapter.local/${source.adapterId}?q=${encodeURIComponent(queryText)}`,
            ),
            status: "running",
          })
          .returning();
        const result = await adapter.fetch(runtimeConfig, {
          query: queryText,
          timeRange: "day",
          language: adapter.id === "searxng" ? "en" : undefined,
          categories: adapter.id === "searxng" ? ["news"] : undefined,
          limit: remaining,
          blockedHosts: adapter.id === "searxng" ? blockedHosts : undefined,
        });
        if (fetchRequest) {
          const charged = result.adapterMetadata?.readsCharged;
          await ctx.db
            .update(sourceFetchRequests)
            .set({
              status: result.errors.length && result.evidence.length === 0 ? "failed" : "succeeded",
              errorClass: result.errors[0]?.class,
              finishedAt: new Date(),
              evidenceCount:
                typeof charged === "number" && Number.isFinite(charged)
                  ? charged
                  : result.evidence.length,
              requestUrl: result.requestUrl ? redactRequestUrl(result.requestUrl) : undefined,
              responseStatus: result.responseStatus,
              adapterMetadata: result.adapterMetadata,
              providerRequestId: result.providerRequestId,
              paginationCursor: result.paginationCursor,
            })
            .where(eq(sourceFetchRequests.id, fetchRequest.id));
        }
        if (result.partial || result.errors.length > 0) {
          anyPartial = true;
        }
        allErrors.push(...result.errors);
        const persistConfig =
          result.adapterMetadata &&
          typeof result.adapterMetadata.persistConfig === "object" &&
          result.adapterMetadata.persistConfig !== null
            ? (result.adapterMetadata.persistConfig as Record<string, unknown>)
            : undefined;
        if (persistConfig) {
          lastPersistConfig = persistConfig;
        }
        for (const item of result.evidence) {
          const key = canonicalizeUrl(item.url);
          if (key) {
            if (seenUrls.has(key)) {
              continue;
            }
            seenUrls.add(key);
          }
          merged.push({ raw: item, fetchRequestId: fetchRequest?.id });
        }
      }
      if (anyPartial) {
        partial = true;
      }
      const bounded = takeBounded(merged, remaining);
      await ctx.db.insert(scanSourceRuns).values({
        scanId,
        sourceId: source.id,
        status: allErrors.length && bounded.length === 0 ? "failed" : "succeeded",
        errorClass: allErrors[0]?.class,
        errorMessage: allErrors.map((item) => item.message).join("; ") || null,
        evidenceCount: bounded.length,
      });
      if (allErrors.length && bounded.length === 0) {
        sourceFailures += 1;
      } else {
        sourceSuccesses += 1;
      }
      await ctx.db
        .update(sources)
        .set({
          lastHealthOk: bounded.length > 0 || allErrors.length === 0,
          lastHealthMessage: allErrors[0]?.message ?? "ok",
          lastHealthAt: new Date(),
          ...(lastPersistConfig ? { config: { ...source.config, ...lastPersistConfig } } : {}),
        })
        .where(eq(sources.id, source.id));
      collected.push(
        ...bounded.map((item) => ({
          raw: item.raw,
          sourceId: source.id,
          fetchRequestId: item.fetchRequestId,
          family: source.family,
          adapterId: source.adapterId,
          normalized: normalizeEvidence(item.raw),
        })),
      );
    }

    const usedIds: string[] = [];
    const byHash = new Map<string, string>();
    const trustMaps = await loadTrustMaps(ctx);
    for (const item of collected) {
      const existing = byHash.get(item.normalized.contentHash);
      try {
        const identityId = await upsertSourceIdentity(ctx, item.normalized.sourceIdentity);
        const hostname = sourceHostname(item.normalized.canonicalUrl);
        const snap = trustMaps.snapshot(identityId, hostname);
        const adapterPayload = {
          ...(item.normalized.adapterPayload ?? {}),
          ...(item.normalized.outboundUrls ? { outboundUrls: item.normalized.outboundUrls } : {}),
        };
        const [row] = await ctx.db
          .insert(evidenceItems)
          .values({
            sourceId: item.sourceId,
            scanId,
            fingerprint: item.normalized.fingerprint,
            contentHash: item.normalized.contentHash,
            canonicalUrl: item.normalized.canonicalUrl,
            title: item.normalized.title,
            bodyText: item.normalized.bodyText,
            author: item.normalized.author,
            publishedAt: item.normalized.publishedAt,
            fetchedAt: item.normalized.fetchedAt,
            adapterPayload,
            sourceFamily: item.family,
            adapterId: item.adapterId,
            externalId: item.normalized.externalId,
            language: item.normalized.language,
            fetchRequestId: item.fetchRequestId,
            contentCompleteness: item.normalized.contentCompleteness,
            originKey: item.normalized.originKey,
            referencedOriginKey: item.normalized.referencedOriginKey,
            sourceIdentityId: identityId,
            sourcePolicyRevision: snap.revision,
            editedAt: item.normalized.editedAt,
          })
          .onConflictDoNothing()
          .returning();
        const persisted =
          row ??
          (
            await ctx.db
              .select()
              .from(evidenceItems)
              .where(eq(evidenceItems.fingerprint, item.normalized.fingerprint))
          )[0];
        if (persisted) {
          usedIds.push(persisted.id);
          byHash.set(item.normalized.contentHash, persisted.id);
          ctx.metrics.evidenceOutcomes.inc({
            completeness: item.normalized.contentCompleteness ?? "snippet",
          });
          await ctx.db
            .insert(evidenceOccurrences)
            .values({
              evidenceId: persisted.id,
              scanId,
              sourceId: item.sourceId,
              fetchRequestId: item.fetchRequestId,
            })
            .onConflictDoNothing();
          if (existing && existing !== persisted.id) {
            await ctx.db
              .insert(evidenceRelations)
              .values({
                fromId: persisted.id,
                toId: existing,
                kind: "reprint_of",
              })
              .onConflictDoNothing();
          }
        }
      } catch {
        partial = true;
      }
    }

    const initialRows =
      usedIds.length > 0
        ? await ctx.db.select().from(evidenceItems).where(inArray(evidenceItems.id, usedIds))
        : [];
    if (ctx.enrichQueue) {
      for (const row of takeBounded(initialRows, ctx.config.RIDDLR_SCAN_EVIDENCE_LIMIT)) {
        await ctx.enrichQueue.add(
          "enrich",
          {
            scanId,
            evidenceId: row.id,
            marketDomainId: module.id,
            idempotencyKey: `enrich:${row.id}`,
          },
          {
            jobId: `enrich:${scanId}:${row.id}`,
            attempts: 3,
            backoff: { type: "exponential", delay: 5_000 },
          },
        );
      }
    }
    if (ctx.understandQueue) {
      for (const row of takeBounded(initialRows, ctx.config.RIDDLR_SCAN_EVIDENCE_LIMIT)) {
        await ctx.understandQueue.add(
          "understand",
          {
            scanId,
            evidenceId: row.id,
            marketDomainId: module.id,
            idempotencyKey: `understand:${row.id}`,
          },
          {
            jobId: `understand:${scanId}:${row.id}`,
            attempts: 3,
            backoff: { type: "exponential", delay: 5_000 },
          },
        );
      }
    }
    if (ctx.clusterQueue) {
      await ctx.clusterQueue.add(
        "cluster",
        { scanId, marketDomainId: module.id, idempotencyKey: `cluster:${scanId}` },
        { jobId: `cluster:${scanId}`, attempts: 3, backoff: { type: "exponential", delay: 5_000 } },
      );
    }
    if (initialRows.length > 0) {
      await enrichAndUnderstandScan({
        ctx,
        module,
        evidenceRows: initialRows,
        fetchImpl: deps.fetchImpl,
        windowStart: scan.windowStart,
      });
    }
    await clusterScanEvents(ctx, scan, usedIds, deps);

    const failed = sourceSuccesses === 0 && (sourceFailures > 0 || collected.length === 0);
    const status = failed ? "failed" : partial ? "partial" : "succeeded";
    await ctx.db
      .update(scans)
      .set({
        status,
        partial: status === "partial",
        finishedAt: new Date(),
      })
      .where(eq(scans.id, scanId));
    ctx.metrics.scans.inc({ status });
  } catch (error) {
    await ctx.db
      .update(scans)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : "scan failed",
        finishedAt: new Date(),
      })
      .where(eq(scans.id, scanId));
    ctx.metrics.scans.inc({ status: "failed" });
    throw error;
  }
}

export async function clusterScanEvents(
  ctx: AppContext,
  scan: typeof scans.$inferSelect,
  usedIds: string[],
  deps: { fetchImpl?: typeof fetch } = {},
) {
  const agentContext = await loadAgentScanContext(ctx, scan.agentId);
  const module = agentContext.module;
  const evidenceRows =
    usedIds.length > 0
      ? await ctx.db.select().from(evidenceItems).where(inArray(evidenceItems.id, usedIds))
      : [];
  const holdings = await ctx.db.select().from(portfolioHoldings).limit(50);
  const holdingIds = new Set(holdings.map((item) => item.canonicalId));
  const pinRows = await ctx.db
    .select({ subjectCanonicalId: observationPins.subjectCanonicalId })
    .from(observationPins)
    .limit(MAX_OBSERVE_PINS);
  const pinIds = new Set(pinRows.map((item) => item.subjectCanonicalId));
  const registry = await listRegistryAssets(ctx);
  const trustMaps = await loadTrustMaps(ctx);
  const claimLinks =
    usedIds.length > 0
      ? await ctx.db
          .select({
            evidenceId: claimEvidence.evidenceId,
            stance: claimEvidence.stance,
            excerpt: claimEvidence.excerpt,
            fingerprint: claims.fingerprint,
            claimId: claims.id,
            title: claims.title,
            kind: claims.kind,
            polarity: claims.polarity,
            modality: claims.modality,
            objectText: claims.objectText,
            value: claims.value,
            unit: claims.unit,
            predicate: claims.predicate,
            subjectCanonicalId: claims.subjectCanonicalId,
            marketDomainId: claims.marketDomainId,
          })
          .from(claimEvidence)
          .innerJoin(claims, eq(claimEvidence.claimId, claims.id))
          .where(inArray(claimEvidence.evidenceId, usedIds))
      : [];
  const claimsByEvidence = new Map<string, typeof claimLinks>();
  for (const link of claimLinks) {
    const current = claimsByEvidence.get(link.evidenceId) ?? [];
    current.push(link);
    claimsByEvidence.set(link.evidenceId, current);
  }

  const prepared = evidenceRows.map((row) => {
    const outboundUrls = payloadUrls(row.adapterPayload);
    const normalized = normalizeEvidence({
      sourceFamily: row.sourceFamily ?? "collected",
      adapterId: row.adapterId ?? "pipeline",
      url: row.canonicalUrl ?? undefined,
      title: row.title ?? undefined,
      bodyText: row.bodyText ?? undefined,
      fetchedAt: row.fetchedAt,
      publishedAt: row.publishedAt ?? undefined,
      adapterPayload: row.adapterPayload ?? undefined,
      contentCompleteness:
        (row.contentCompleteness as
          | "snippet"
          | "full_document"
          | "native_complete"
          | "incomplete"
          | "unsupported") ?? undefined,
      originKey: row.originKey ?? undefined,
      referencedOriginKey: row.referencedOriginKey ?? undefined,
      outboundUrls,
    });
    const linked = claimsByEvidence.get(row.id) ?? [];
    return {
      id: row.id,
      row,
      normalized,
      hostname: sourceHostname(row.canonicalUrl),
      publishedAt: row.publishedAt ?? undefined,
      sourceFamily: row.sourceFamily ?? undefined,
      originKey: row.originKey ?? normalized.originKey,
      referencedOriginKey: row.referencedOriginKey ?? undefined,
      outboundUrls,
      claimFingerprints: linked.map((item) => item.fingerprint),
      claimGroupKeys: linked.map((item) =>
        claimGroupKey({
          kind: item.kind,
          subjectCanonicalId: item.subjectCanonicalId ?? undefined,
        }),
      ),
      marketDomainId: module.id,
      assetCanonicalIds: [
        ...new Set([
          ...module.extractAssets([normalized], registry).map((item) => item.canonicalId),
          ...linked
            .map((item) => item.subjectCanonicalId)
            .filter((id): id is string => Boolean(id)),
        ]),
      ],
      text: `${normalized.normalizedTitle} ${normalized.normalizedText}`,
    };
  });

  for (let index = 0; index < prepared.length; index += 1) {
    const current = prepared[index];
    if (!current) {
      continue;
    }
    for (let priorIndex = 0; priorIndex < index; priorIndex += 1) {
      const prior = prepared[priorIndex];
      if (!prior) {
        continue;
      }
      if (
        current.normalized.contentHash !== prior.normalized.contentHash &&
        isNearDuplicate(current.text, prior.text)
      ) {
        await ctx.db
          .insert(evidenceRelations)
          .values({
            fromId: current.id,
            toId: prior.id,
            kind: "near_duplicate_of",
          })
          .onConflictDoNothing();
        break;
      }
    }
  }

  const clustered =
    prepared.length > 0
      ? clusterEvidence(prepared, MAX_EVENTS_PER_SCAN)
      : { clusters: [] as (typeof prepared)[], remainder: [] as typeof prepared };
  const clusters = absorbObservationClusters(absorbMarketDataClusters(clustered.clusters));
  const windowDay = utcDayStamp(scan.windowStart);

  if (clustered.remainder && clustered.remainder.length > 0) {
    const overflowFingerprint = eventClusterFingerprint({
      marketDomainId: module.id,
      claimFingerprints: clustered.remainder.flatMap((item) => item.claimFingerprints),
      contentHashes: clustered.remainder.map((item) => item.row.contentHash),
      assetCanonicalIds: clustered.remainder.flatMap((item) => item.assetCanonicalIds),
      windowDay,
    });
    const [existingOverflow] = overflowFingerprint
      ? await ctx.db
          .select()
          .from(events)
          .where(eq(events.clusterFingerprint, overflowFingerprint))
          .limit(1)
      : [];
    const overflow =
      existingOverflow ??
      (
        await ctx.db
          .insert(events)
          .values({
            agentId: scan.agentId,
            scanId: scan.id,
            title: "Deferred evidence (cluster overflow)",
            status: "deferred",
            windowStart: scan.windowStart,
            independentCount: 0,
            derivedCount: 0,
            marketDomainId: module.id,
            reliabilityStatus: "mention",
            clusterFingerprint: overflowFingerprint,
          })
          .returning()
      )[0];
    if (overflow) {
      for (const item of clustered.remainder) {
        await ctx.db
          .insert(eventEvidence)
          .values({ eventId: overflow.id, evidenceId: item.id, role: "supporting" })
          .onConflictDoNothing();
      }
    }
    if (ctx.clusterQueue) {
      await ctx.clusterQueue.add(
        "cluster",
        {
          scanId: scan.id,
          marketDomainId: module.id,
          idempotencyKey: `cluster:${scan.id}:overflow`,
        },
        {
          jobId: `cluster:${scan.id}:overflow`,
          attempts: 3,
          backoff: { type: "exponential", delay: 5_000 },
        },
      );
    }
  }

  if (clusters.length === 0 && clustered.remainder.length === 0) {
    await ctx.db.insert(events).values({
      agentId: scan.agentId,
      scanId: scan.id,
      title: "No evidence in this scan window",
      status: "empty",
      windowStart: scan.windowStart,
      independentCount: 0,
      derivedCount: 0,
    });
  }

  const earlyWarningsEnabled = await instanceEarlyWarningsEnabled(ctx);
  const shadowAssessments = await instanceShadowAssessments(ctx);

  for (const cluster of clusters) {
    const clusterRows = cluster.map((item) => item.row);
    const clusterNorm = cluster.map((item) => item.normalized);
    const extracted = module.extractAssets(clusterNorm, registry);
    for (const id of cluster.flatMap((item) => item.assetCanonicalIds)) {
      if (extracted.some((asset) => asset.canonicalId === id)) {
        continue;
      }
      const row = registry.find((asset) => asset.canonicalId === id);
      if (row) {
        extracted.push({
          assetClass: row.assetClass,
          canonicalId: row.canonicalId,
          symbol: row.symbol ?? undefined,
          displayName: row.name ?? undefined,
        });
      }
    }
    const sourced = takeBounded(
      [
        ...cluster.flatMap((item) =>
          observationsFromMarketPayload(
            item.row.adapterPayload,
            item.row.adapterId ?? item.id,
            item.publishedAt ?? item.row.fetchedAt,
          ),
        ),
        ...cluster.flatMap((item) =>
          observationsFromDetectorPayload(
            item.row.adapterPayload,
            item.row.adapterId ?? item.id,
            item.publishedAt ?? item.row.fetchedAt,
          ),
        ),
        ...module.extractObservations(clusterNorm, registry),
        ...(await defiLlamaContextObservations(
          ctx,
          extracted.map((item) => item.canonicalId),
        )),
        ...(await perpContextObservations(
          ctx,
          extracted.map((item) => item.canonicalId),
        )),
        ...(await oddsContextObservations(
          ctx,
          extracted.map((item) => item.canonicalId),
        )),
      ],
      MAX_OBSERVATIONS_PER_EVENT,
    );
    const roles = cluster.map((item, index) => {
      if (item.sourceFamily === "market_data") {
        return "supporting" as const;
      }
      if (item.sourceFamily === "observation") {
        return "primary" as const;
      }
      const currentOrigin = lineageOriginKey({
        originKey: item.originKey,
        referencedOriginKey: item.referencedOriginKey,
        outboundUrls: item.outboundUrls,
        attributedOrigin: payloadText(item.row.adapterPayload, "attributedOrigin"),
        hostname: item.hostname,
      });
      const sameOrigin = cluster.some((other, otherIndex) => {
        if (otherIndex >= index) {
          return false;
        }
        return (
          currentOrigin ===
          lineageOriginKey({
            originKey: other.originKey,
            referencedOriginKey: other.referencedOriginKey,
            outboundUrls: other.outboundUrls,
            attributedOrigin: payloadText(other.row.adapterPayload, "attributedOrigin"),
            hostname: other.hostname,
          })
        );
      });
      return classifyReprint({
        sameCanonicalUrl: clusterRows.some(
          (other, otherIndex) =>
            otherIndex < index &&
            other.canonicalUrl &&
            other.canonicalUrl === item.row.canonicalUrl,
        ),
        sameContentHash: clusterRows.some(
          (other, otherIndex) => otherIndex < index && other.contentHash === item.row.contentHash,
        ),
        nearDuplicate: cluster.some(
          (other, otherIndex) => otherIndex < index && isNearDuplicate(item.text, other.text),
        ),
        sameOrigin,
        sharedOutbound: cluster.some(
          (other, otherIndex) =>
            otherIndex < index && overlappingOutbound(item.outboundUrls, other.outboundUrls),
        ),
        snippetOnly: false,
        opposingClaims: cluster.some(
          (other, otherIndex) => otherIndex < index && textOpposes(item.text, other.text),
        ),
      });
    });
    const counts = independenceCounts(roles);
    const watchlistIds = new Set(agentContext.watchlist.map((item) => item.canonicalId));
    const watchlistOverlap =
      extracted.some((item) => watchlistIds.has(item.canonicalId)) ||
      extracted.some((item) => pinIds.has(item.canonicalId));
    const overlap = extracted.filter((item) => holdingIds.has(item.canonicalId));
    const hostCount = uniqueIndependentHosts(
      cluster.flatMap((item, index) =>
        item.sourceFamily === "market_data"
          ? []
          : [{ hostname: item.hostname, role: roles[index] ?? "primary" }],
      ),
    );
    const observationOnly =
      cluster.length > 0 && cluster.every((item) => item.sourceFamily === "observation");
    const fingerprint = eventClusterFingerprint({
      marketDomainId: module.id,
      claimFingerprints: observationOnly ? [] : cluster.flatMap((item) => item.claimFingerprints),
      contentHashes: observationOnly ? [] : cluster.map((item) => item.row.contentHash),
      assetCanonicalIds: cluster.flatMap((item) => item.assetCanonicalIds),
      windowDay,
    });
    const context = module.assembleContext({
      evidence: clusterNorm,
      assets: extracted,
      observations: sourced,
      watchlist: agentContext.watchlist,
    });
    const clusterClaims = cluster.flatMap((item) => claimsByEvidence.get(item.id) ?? []);
    const observedAnomaly =
      clusterClaims.some((item) => isObservedAnomalyKind(item.kind)) ||
      (observationOnly &&
        clusterClaims.some(
          (item) =>
            item.kind === "crypto:market_stress" ||
            item.kind === "crypto:stablecoin_peg_change" ||
            item.predicate === "odds_jump" ||
            item.kind === "crypto:macro_policy_decision" ||
            item.kind === "crypto:regulatory_action",
        ));
    const retractingCount = clusterClaims.filter((item) => item.stance === "retracts").length;
    const contradictingFromClaims = clusterClaims.filter(
      (item) => item.stance === "contradicts",
    ).length;
    const facts = buildEventFacts({
      evidence: cluster.map((item, index) => ({
        hostname: item.hostname,
        sourceFamily: item.sourceFamily ?? item.row.sourceFamily ?? undefined,
        text: item.text,
        publishedAt: item.publishedAt,
        role: roles[index] ?? "primary",
        adapterPayload: item.row.adapterPayload,
        originKey: item.originKey,
        referencedOriginKey: item.referencedOriginKey,
        outboundUrls: item.outboundUrls,
        attributedOrigin: payloadText(item.row.adapterPayload, "attributedOrigin"),
        contentCompleteness: item.row.contentCompleteness as
          | "snippet"
          | "full_document"
          | "native_complete"
          | "incomplete"
          | "unsupported",
        hasValidatedClaim: (claimsByEvidence.get(item.id) ?? []).length > 0,
        trustTier: trustMaps.forEvidence(item.row.sourceIdentityId, item.hostname),
        headlineMismatch: headlineBodyMismatch(item.row.title ?? undefined, item.text),
        retracting: (claimsByEvidence.get(item.id) ?? []).some(
          (link) => link.stance === "retracts",
        ),
      })),
      assets: extracted,
      observations: sourced,
      watchlistOverlap,
      portfolioOverlap: overlap.length > 0,
    });
    const newest = cluster
      .map((item) => item.publishedAt ?? item.row.fetchedAt)
      .reduce((latest, value) => (value > latest ? value : latest), new Date(0));
    const stale = Date.now() - newest.getTime() > STALE_MS;
    const reliability = assessReliability({
      contentCompleteness: facts.contentCompleteness,
      independentOriginCount: facts.independentOriginCount,
      supportingCount: facts.primaryCount,
      contradictingCount: Math.max(facts.contradictingCount, contradictingFromClaims),
      retractingCount,
      hasTrustedFirsthand: facts.hasTrustedFirsthand,
      hasValidatedClaim: facts.hasValidatedClaim,
      headlineMismatch: facts.headlineMismatch,
      observedAnomaly,
    });
    const uniqueClaims = new Map<string, (typeof clusterClaims)[number]>();
    for (const link of clusterClaims) {
      uniqueClaims.set(link.claimId, link);
    }
    const impact = module.assessImpact({
      claims: [...uniqueClaims.values()].map((item) => ({
        marketDomainId: (item.marketDomainId as typeof module.id) ?? module.id,
        kind: item.kind,
        subjectCanonicalId: item.subjectCanonicalId ?? undefined,
        predicate: item.predicate,
        objectText: item.objectText ?? undefined,
        value: item.value,
        unit: item.unit ?? undefined,
        polarity: item.polarity as "asserted" | "negated",
        modality: item.modality as "asserted" | "alleged" | "forecast" | "denied",
        fingerprint: item.fingerprint,
        title: item.title,
      })),
      assets: extracted,
      observations: sourced,
      watchlistOverlap,
      portfolioOverlap: overlap.length > 0,
      hasTrustedFirsthand: facts.hasTrustedFirsthand,
      stale,
      contradicted: facts.contradictingCount > 0 || contradictingFromClaims > 0,
      retracted: reliability.status === "retracted",
    });
    const material = isMaterialEvent({
      independentHostCount: hostCount,
      independentFamilyCount: new Set(clusterRows.map((row) => row.sourceFamily ?? row.sourceId))
        .size,
      independentOriginCount: facts.independentOriginCount,
      evidenceCount: clusterRows.length,
      derivedCount: counts.derivedReprintCount,
      watchlistOverlap,
      portfolioOverlap: overlap.length > 0,
      sourcedObservationCount: sourced.length,
      hasAuthoritativePrimary: facts.hasAuthoritativePrimary,
      hasTrustedFirsthand: facts.hasTrustedFirsthand,
      contentCompleteness: facts.contentCompleteness,
      hasValidatedClaim: facts.hasValidatedClaim,
      observedAnomaly,
      communitySocialOnly: facts.communitySocialOnly,
    });
    const discovery = discoverCandidate({
      facts,
      objectives: agentContext.agent?.objectives ?? [],
      text: cluster.map((item) => item.text).join("\n"),
      material,
    });
    const status = nextEventStatus({
      evidenceCount: clusterRows.length,
      discovery,
      material,
    });
    const notes = [
      ...context.notes,
      ...formatAnalysisFacts(facts),
      ...formatDiscoveryNotes(discovery),
      overlap.length > 0
        ? `Portfolio holdings overlap: ${overlap.map((item) => item.canonicalId).join(", ")}`
        : "Portfolio holdings overlap: none",
    ];
    const principal = clusterClaims[0];
    const title = clusterEventTitle({
      assets: extracted,
      evidenceTitles: clusterRows.map((item) => item.title),
      hostnames: cluster.map((item) => item.hostname ?? "unknown-host"),
      principalClaimTitle: principal?.title,
      reliabilityStatus: reliability.status,
    });
    const existingEvents = fingerprint
      ? await ctx.db
          .select()
          .from(events)
          .where(eq(events.clusterFingerprint, fingerprint))
          .limit(1)
      : [];
    let event = existingEvents[0];
    const previousReliability = event?.reliabilityStatus as ReliabilityStatus | undefined;
    if (event) {
      await ctx.db
        .update(events)
        .set({
          scanId: scan.id,
          title,
          status,
          independentCount: facts.independentOriginCount,
          derivedCount: counts.derivedReprintCount,
          materialityReason: material.reason,
          epistemicStatus: discovery.epistemicStatus,
          candidateKind: discovery.kind,
          discoveryReason: discovery.reason,
          marketDomainId: module.id,
          reliabilityStatus: reliability.status,
          impactLevel: impact.level,
          contentCompleteness: facts.contentCompleteness,
          principalClaimId: principal?.claimId,
        })
        .where(eq(events.id, event.id));
      event = { ...event, status, scanId: scan.id, title };
    } else {
      const inserted = await ctx.db
        .insert(events)
        .values({
          agentId: scan.agentId,
          scanId: scan.id,
          title,
          status,
          windowStart: scan.windowStart,
          independentCount: facts.independentOriginCount,
          derivedCount: counts.derivedReprintCount,
          clusterFingerprint: fingerprint,
          materialityReason: material.reason,
          epistemicStatus: discovery.epistemicStatus,
          candidateKind: discovery.kind,
          discoveryReason: discovery.reason,
          marketDomainId: module.id,
          reliabilityStatus: reliability.status,
          impactLevel: impact.level,
          contentCompleteness: facts.contentCompleteness,
          principalClaimId: principal?.claimId,
        })
        .returning();
      event = inserted[0];
    }
    if (!event) {
      continue;
    }
    for (let index = 0; index < clusterRows.length; index += 1) {
      const evidence = clusterRows[index];
      const role = roles[index] ?? "primary";
      if (evidence) {
        await ctx.db
          .insert(eventEvidence)
          .values({ eventId: event.id, evidenceId: evidence.id, role })
          .onConflictDoNothing();
      }
    }
    for (const asset of takeBounded(extracted, 50)) {
      await ctx.db
        .insert(assets)
        .values({
          assetClass: asset.assetClass,
          canonicalId: asset.canonicalId,
          symbol: asset.symbol,
          name: asset.displayName,
        })
        .onConflictDoNothing();
      const [persisted] = await ctx.db
        .select()
        .from(assets)
        .where(eq(assets.canonicalId, asset.canonicalId))
        .limit(1);
      if (persisted) {
        await ctx.db
          .insert(eventAssets)
          .values({ eventId: event.id, assetId: persisted.id })
          .onConflictDoNothing();
      }
    }
    if (observationOnly) {
      await ctx.db.delete(observations).where(eq(observations.eventId, event.id));
    }
    for (const observation of sourced) {
      await ctx.db.insert(observations).values({
        eventId: event.id,
        kind: observation.kind,
        assetCanonicalId: observation.assetCanonicalId,
        value: observation.value,
        unit: observation.unit,
        observedAt: observation.observedAt,
        sourceId: observation.sourceId,
      });
    }
    const stanceByClaim = new Map<string, string[]>();
    for (const link of clusterClaims) {
      const current = stanceByClaim.get(link.claimId) ?? [];
      current.push(link.stance);
      stanceByClaim.set(link.claimId, current);
    }
    for (const [claimId, stances] of stanceByClaim) {
      await ctx.db
        .insert(eventClaims)
        .values({ eventId: event.id, claimId, stance: strongestStance(stances) })
        .onConflictDoUpdate({
          target: [eventClaims.eventId, eventClaims.claimId],
          set: { stance: strongestStance(stances) },
        });
    }
    const [latestAssessment] = await ctx.db
      .select()
      .from(eventAssessments)
      .where(eq(eventAssessments.eventId, event.id))
      .orderBy(desc(eventAssessments.revision))
      .limit(1);
    const changed =
      !latestAssessment ||
      latestAssessment.reliabilityStatus !== reliability.status ||
      latestAssessment.impactLevel !== impact.level ||
      latestAssessment.contentCompleteness !== facts.contentCompleteness ||
      latestAssessment.independentOriginCount !== facts.independentOriginCount;
    if (changed) {
      const [assessment] = await ctx.db
        .insert(eventAssessments)
        .values({
          eventId: event.id,
          revision: (latestAssessment?.revision ?? 0) + 1,
          reliabilityStatus: reliability.status,
          impactLevel: impact.level,
          contentCompleteness: facts.contentCompleteness,
          independentOriginCount: facts.independentOriginCount,
          independentActorCount: facts.independentActorCount,
          disputed: reliability.status === "disputed",
          retracted: reliability.status === "retracted",
          policyVersion: module.id,
        })
        .onConflictDoNothing()
        .returning();
      if (assessment) {
        ctx.metrics.assessments.inc({ reliability: reliability.status });
        for (const code of takeBounded(impact.reasonCodes, 8)) {
          await ctx.db
            .insert(eventAssessmentReasons)
            .values({ assessmentId: assessment.id, code, detail: impact.reason })
            .onConflictDoNothing();
        }
      }
    }

    const analysisAllowed = cluster.some((item) =>
      trustMaps.allows(item.row.sourceIdentityId, item.hostname, "analysis"),
    );
    if (material.material && analysisAllowed) {
      const claimIds = [...new Set(clusterClaims.map((item) => item.claimId))];
      if (ctx.analyzeQueue) {
        await ctx.analyzeQueue.add(
          "analyze",
          {
            eventId: event.id,
            scanId: scan.id,
            marketDomainId: module.id,
            idempotencyKey: `analyze:${event.id}`,
          },
          {
            jobId: `analyze:${event.id}`,
            attempts: 3,
            backoff: { type: "exponential", delay: 5_000 },
          },
        );
      } else if (!observationOnly) {
        await maybeAnalyze(
          ctx,
          event.id,
          scan.agentId,
          takeBounded(clusterRows, ctx.config.RIDDLR_ANALYSIS_EVIDENCE_LIMIT),
          notes,
          agentContext,
          deps.fetchImpl,
          {
            facts,
            material,
            title: event.title,
            reliability: reliability.status,
            impact: impact.level,
            claimIds,
            claimKinds: [...new Set(clusterClaims.map((item) => item.kind))],
            earlyWarningsEnabled,
            previousReliability,
            shadowAssessments,
            marketDomainId: module.id,
            earlyWarningAllowed: cluster.some((item) =>
              trustMaps.allows(item.row.sourceIdentityId, item.hostname, "early_warning"),
            ),
          },
        );
      }
    }
  }
}

async function loadAgentScanContext(ctx: AppContext, agentId: string) {
  const [agent] = await ctx.db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  const skillRows = await ctx.db
    .select({
      slug: skills.slug,
      markdownBody: skills.markdownBody,
    })
    .from(agentSkills)
    .innerJoin(skills, eq(agentSkills.skillId, skills.id))
    .where(eq(agentSkills.agentId, agentId))
    .limit(MAX_SKILLS_PER_AGENT);
  const [watchlist] = await ctx.db
    .select()
    .from(watchlists)
    .where(eq(watchlists.agentId, agentId))
    .limit(1);
  const items = watchlist
    ? await ctx.db
        .select()
        .from(watchlistItems)
        .where(eq(watchlistItems.watchlistId, watchlist.id))
        .limit(MAX_WATCHLIST_ITEMS)
    : [];
  const domainRows = await ctx.db
    .select()
    .from(agentMarketDomains)
    .where(eq(agentMarketDomains.agentId, agentId))
    .limit(4);
  const domainId = (domainRows[0]?.marketDomainId ?? "crypto") as
    | "crypto"
    | "equities"
    | "forex"
    | "commodities"
    | "macro";
  const module = ctx.domains.require(domainId);
  const registry = await listRegistryAssets(ctx);
  const resolved = items
    .map((item) =>
      module.canonicalizeAsset(
        {
          canonicalId: item.canonicalId,
          symbol: item.symbol ?? undefined,
          name: item.name ?? undefined,
          assetClass: item.assetClass as "cryptocurrency" | "meme_coin" | "stablecoin",
        },
        registry,
      ),
    )
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  return {
    agent,
    skillPolicies: skillRows.map((row) => ({ slug: row.slug, markdown: row.markdownBody })),
    watchlist: resolved,
    module,
    marketDomainId: module.id,
  };
}

function fallbackFacts(
  evidenceRows: Array<{
    id: string;
    title: string | null;
    bodyText: string | null;
    canonicalUrl: string | null;
    sourceFamily?: string | null;
  }>,
  _notes: string[],
) {
  return buildEventFacts({
    evidence: evidenceRows.map((row) => ({
      hostname: sourceHostname(row.canonicalUrl),
      sourceFamily: row.sourceFamily ?? undefined,
      text: `${row.title ?? ""} ${row.bodyText ?? ""}`,
      role: "primary",
    })),
    assets: [],
    observations: [],
    watchlistOverlap: false,
    portfolioOverlap: false,
  });
}

async function dailyTokenCommitment(
  ctx: AppContext,
  agentId: string,
  dayUtc: string,
): Promise<{ recordedUsage: number; openReservations: number }> {
  const { start, endExclusive } = utcDayRange(dayUtc);
  const [usage] = await ctx.db
    .select({
      tokens: sql<number>`coalesce(sum(
        case
          when ${aiUsageEvents.cacheHit} then 0
          else coalesce(
            ${aiUsageEvents.completionTotal},
            coalesce(${aiUsageEvents.promptTokens}, 0) + coalesce(${aiUsageEvents.completionTokens}, 0)
          )
        end
      ), 0)`,
    })
    .from(aiUsageEvents)
    .where(
      and(
        eq(aiUsageEvents.agentId, agentId),
        gte(aiUsageEvents.createdAt, start),
        lt(aiUsageEvents.createdAt, endExclusive),
      ),
    );
  const [open] = await ctx.db
    .select({
      tokens: sql<number>`coalesce(sum(${tokenBudgetReservations.reservedTokens}), 0)`,
    })
    .from(tokenBudgetReservations)
    .where(
      and(
        eq(tokenBudgetReservations.agentId, agentId),
        eq(tokenBudgetReservations.dayUtc, dayUtc),
        eq(tokenBudgetReservations.status, "open"),
      ),
    );
  return {
    recordedUsage: Number(usage?.tokens ?? 0),
    openReservations: Number(open?.tokens ?? 0),
  };
}

async function reserveDailyAnalysisTokens(
  ctx: AppContext,
  input: { agentId: string; budget: number | null; promptChars: number },
): Promise<{ id: string } | "skip" | undefined> {
  if (input.budget === null) {
    return undefined;
  }
  const dayUtc = utcDayStamp();
  const nextReservation = analysisReservationTokens(input.promptChars);
  const before = await dailyTokenCommitment(ctx, input.agentId, dayUtc);
  if (
    shouldSkipForDailyTokenBudget({
      budget: input.budget,
      recordedUsageTokens: before.recordedUsage,
      openReservationTokens: before.openReservations,
      nextReservationTokens: nextReservation,
    })
  ) {
    ctx.logger.info(
      { agentId: input.agentId, budget: input.budget },
      "token budget exhausted; analysis skipped",
    );
    return "skip";
  }
  const [row] = await ctx.db
    .insert(tokenBudgetReservations)
    .values({
      agentId: input.agentId,
      dayUtc,
      reservedTokens: nextReservation,
      status: "open",
    })
    .returning();
  const after = await dailyTokenCommitment(ctx, input.agentId, dayUtc);
  if (
    shouldSkipForDailyTokenBudget({
      budget: input.budget,
      recordedUsageTokens: after.recordedUsage,
      openReservationTokens: after.openReservations,
      nextReservationTokens: 0,
    })
  ) {
    if (row) {
      await ctx.db
        .update(tokenBudgetReservations)
        .set({ status: "abandoned" })
        .where(eq(tokenBudgetReservations.id, row.id));
    }
    ctx.logger.info(
      { agentId: input.agentId, budget: input.budget },
      "token budget exhausted; analysis skipped",
    );
    return "skip";
  }
  return row;
}

async function maybeAnalyze(
  ctx: AppContext,
  eventId: string,
  agentId: string,
  evidenceRows: Array<{
    id: string;
    title: string | null;
    bodyText: string | null;
    canonicalUrl: string | null;
    sourceFamily?: string | null;
    adapterPayload?: Record<string, unknown> | null;
  }>,
  notes: string[],
  agentContext: Awaited<ReturnType<typeof loadAgentScanContext>>,
  fetchImpl?: typeof fetch,
  hint?: {
    facts: ReturnType<typeof buildEventFacts>;
    material: ReturnType<typeof isMaterialEvent>;
    title: string;
    reliability?: ReliabilityStatus;
    impact?: "informational" | "low" | "moderate" | "high" | "critical";
    claimIds?: string[];
    claimKinds?: string[];
    earlyWarningsEnabled?: boolean;
    previousReliability?: ReliabilityStatus;
    shadowAssessments?: boolean;
    marketDomainId?: string;
    earlyWarningAllowed?: boolean;
  },
) {
  const budget = resolveDailyTokenBudget(
    agentContext.agent?.tokenBudget,
    ctx.config.RIDDLR_DEFAULT_TOKEN_BUDGET,
  );
  const providers = await ctx.db.select().from(providerConfigs).limit(8);
  const llm = providers.find(
    (item) =>
      item.kind.includes("compatible") ||
      item.kind.includes("openai") ||
      item.kind.includes("anthropic"),
  );
  if (!llm?.secretId) {
    return;
  }
  const secretRows = await ctx.db
    .select()
    .from(encryptedSecrets)
    .where(eq(encryptedSecrets.id, llm.secretId))
    .limit(1);
  const secret = secretRows[0];
  if (!secret) {
    return;
  }
  const apiKey = decryptSecretWithKeys({
    keys: ctx.masterKeys,
    secret: {
      ciphertext: secret.ciphertext,
      nonce: secret.nonce,
      tag: secret.tag,
      alg: "aes-256-gcm",
      keyVersion: secret.keyVersion,
    },
    purpose: "llm",
    aad: `${secret.purpose}|${secret.keyVersion}`,
  });
  const settings = llm.settings as { baseUrl?: string; model?: string };
  const provider =
    llm.kind === "anthropic_compatible"
      ? createAnthropicCompatibleProvider({
          baseUrl: String(settings.baseUrl),
          apiKey,
          fetchImpl,
        })
      : createOpenAiCompatibleProvider({
          baseUrl: String(settings.baseUrl),
          apiKey,
          fetchImpl,
        });
  const selection = selectApplicableSkills({
    attached: agentContext.skillPolicies,
    facts: factsToApplicability(hint?.facts ?? fallbackFacts(evidenceRows, notes)),
  });
  const selectedPolicies = selection.selected
    .map((item) => agentContext.skillPolicies.find((policy) => policy.slug === item.slug))
    .filter((item): item is { slug: string; markdown: string } => Boolean(item));
  const factNotes = hint
    ? formatAnalysisFacts(hint.facts)
    : notes.filter((note) => note.length > 0);
  const skippedNotices = selection.skipped
    .map((item) => skippedSkillNotice(item))
    .filter((item): item is string => Boolean(item));
  const prompt = buildAnalysisPrompt({
    eventSummary: hint?.title ?? "Evidence cluster",
    evidence: evidenceRows.map((row) => ({
      id: row.id,
      title: row.title ?? undefined,
      bodyText: row.bodyText ?? undefined,
      url: row.canonicalUrl ?? undefined,
    })),
    contextNotes: [
      ...factNotes,
      ...skippedNotices,
      ...notes.filter((note) => !factNotes.includes(note)),
    ],
    skillPolicies: selectedPolicies,
    claimIds: hint?.claimIds,
  });
  const promptHash = createHash("sha256").update(prompt.system).digest("hex");
  const skillHash = createHash("sha256")
    .update(selectedPolicies.map((item) => `${item.slug}\n${item.markdown}`).join("\n"))
    .digest("hex");
  const contextHash = createHash("sha256")
    .update(JSON.stringify({ notes: factNotes, evidence: evidenceRows.map((row) => row.id) }))
    .digest("hex");
  const [cached] = await ctx.db
    .select()
    .from(analysisCache)
    .where(
      and(
        eq(analysisCache.provider, provider.kind),
        eq(analysisCache.model, String(settings.model ?? "gpt-4.1-mini")),
        eq(analysisCache.schemaVersion, SIGNAL_SCHEMA_VERSION),
        eq(analysisCache.promptHash, promptHash),
        eq(analysisCache.skillHash, skillHash),
        eq(analysisCache.contextHash, contextHash),
      ),
    )
    .limit(1);
  let reservation: { id: string } | undefined;
  if (!cached) {
    const reserved = await reserveDailyAnalysisTokens(ctx, {
      agentId,
      budget,
      promptChars: prompt.system.length + prompt.user.length,
    });
    if (reserved === "skip") {
      return;
    }
    reservation = reserved;
  }
  try {
    const allowed = new Set(evidenceRows.map((row) => row.id));
    let parsed: unknown = cached?.rawOutput;
    const cacheHit = Boolean(cached);
    let completionTokens: number | undefined;
    let promptTokens: number | undefined;
    let latencyMs = 0;
    let providerRequestId: string | undefined;
    if (!cached) {
      const completion = await provider.completeStructured({
        model: String(settings.model ?? "gpt-4.1-mini"),
        system: prompt.system,
        user: prompt.user,
        jsonSchema: SIGNAL_JSON_SCHEMA,
        timeoutMs: 45_000,
      });
      parsed = completion.parsed;
      completionTokens = completion.usage?.completionTokens;
      promptTokens = completion.usage?.promptTokens;
      latencyMs = completion.latencyMs;
      providerRequestId = completion.providerRequestId;
      await ctx.db.insert(analysisCache).values({
        provider: provider.kind,
        model: String(settings.model ?? "gpt-4.1-mini"),
        schemaVersion: SIGNAL_SCHEMA_VERSION,
        promptHash,
        skillHash,
        contextHash,
        rawOutput: completion.parsed as Record<string, unknown>,
      });
    }
    const claimEvidenceLinks = new Map<string, Set<string>>();
    if ((hint?.claimIds ?? []).length > 0 && evidenceRows.length > 0) {
      const links = await ctx.db
        .select({
          claimId: claimEvidence.claimId,
          evidenceId: claimEvidence.evidenceId,
        })
        .from(claimEvidence)
        .where(
          inArray(
            claimEvidence.evidenceId,
            evidenceRows.map((row) => row.id),
          ),
        );
      for (const link of links) {
        const current = claimEvidenceLinks.get(link.claimId) ?? new Set<string>();
        current.add(link.evidenceId);
        claimEvidenceLinks.set(link.claimId, current);
      }
    }
    const allowedEventTypes = new Set(
      (hint?.claimKinds ?? [])
        .map((kind) => agentContext.module.mapClaimKindToCatalyst(kind))
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    );
    const signal = validateSignalOutput(
      parsed,
      allowed,
      new Set(hint?.claimIds ?? []),
      hint?.reliability,
      claimEvidenceLinks,
      allowedEventTypes,
    );
    const material = hint?.material ?? {
      material: true,
      reason: "independent_origins",
    };
    const gate = decideSignalGate({
      facts: hint?.facts ?? fallbackFacts(evidenceRows, notes),
      risk: signal.risk,
      confidence: signal.confidence,
      material,
      reliability: hint?.reliability,
      impact: hint?.impact,
      earlyWarningsEnabled: hint?.earlyWarningsEnabled,
      previousReliability: hint?.previousReliability,
      shadowAssessments: hint?.shadowAssessments ?? (await instanceShadowAssessments(ctx)),
    });
    const notifyEligible =
      gate.notifyKind === "early_warning" && hint?.earlyWarningAllowed === false
        ? false
        : gate.notifyEligible;
    ctx.metrics.notifications.inc({
      kind: notifyEligible ? gate.notifyKind : gate.persist ? "held" : "skipped",
    });
    const skillTrace = {
      selected: selection.selected,
      skipped: selection.skipped.map((item) => ({
        ...item,
        notice: skippedSkillNotice(item),
      })),
      llmCalls: cacheHit ? 0 : 1,
      contextChars: prompt.system.length + prompt.user.length,
      estimatedPromptTokens: estimatePromptTokens(prompt.system.length + prompt.user.length),
      signalGate: {
        disposition: gate.disposition,
        notifyEligible,
        reason: gate.reason,
      },
    };
    await ctx.db.insert(aiUsageEvents).values({
      agentId,
      provider: provider.kind,
      model: String(settings.model ?? "unknown"),
      promptTokens: cacheHit ? 0 : promptTokens,
      completionTokens: cacheHit ? 0 : completionTokens,
      completionTotal: cacheHit ? 0 : (promptTokens ?? 0) + (completionTokens ?? 0),
      latencyMs,
      providerRequestId,
      cacheHit,
      status: "recorded",
    });
    if (reservation) {
      await ctx.db
        .update(tokenBudgetReservations)
        .set({
          status: "consumed",
          consumedTokens: cacheHit ? 0 : (promptTokens ?? 0) + (completionTokens ?? 0),
        })
        .where(eq(tokenBudgetReservations.id, reservation.id));
    }
    await ctx.db.insert(analyses).values({
      eventId,
      model: String(settings.model ?? "unknown"),
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      promptTokens,
      completionTokens,
      latencyMs,
      rawOutput: parsed as Record<string, unknown>,
      skillTrace,
    });
    let saved: { id: string } | undefined;
    if (gate.persist) {
      const inserted = await ctx.db
        .insert(signals)
        .values({
          eventId,
          agentId,
          headline: signal.headline,
          whyItMatters: signal.whyItMatters,
          proof: {
            evidenceIds: signal.proof.evidenceIds,
            claimIds: takeBounded(signal.proof.claimIds ?? [], 32),
            summary: signal.proof.summary,
          },
          action: signal.action,
          risk: signal.risk,
          confidence: String(gate.cappedConfidence),
          marketContext: signal.marketContext,
          contradictoryEvidence: signal.contradictoryEvidence,
          invalidationConditions: signal.invalidationConditions,
          schemaVersion: "1",
          notifyEligible,
          epistemicStatus: "signal",
          outputKind: gate.outputKind,
          notifyKind: gate.notifyKind,
        })
        .onConflictDoNothing()
        .returning();
      saved = inserted[0];
      if (saved) {
        for (const claimId of signal.proof.claimIds ?? []) {
          const linked = claimEvidenceLinks.get(claimId);
          for (const evidenceId of signal.proof.evidenceIds) {
            if (!linked?.has(evidenceId)) {
              continue;
            }
            await ctx.db
              .insert(signalClaimProofs)
              .values({ signalId: saved.id, claimId, evidenceId })
              .onConflictDoNothing();
          }
        }
      }
      await ctx.db.update(events).set({ status: "analyzed" }).where(eq(events.id, eventId));
    } else {
      await ctx.db.update(events).set({ status: "analyzed" }).where(eq(events.id, eventId));
    }
    if (saved && notifyEligible) {
      if (ctx.notifyQueue) {
        await ctx.notifyQueue.add(
          "notify",
          {
            signalId: saved.id,
            marketDomainId: hint?.marketDomainId ?? agentContext.marketDomainId,
            idempotencyKey: `notify:${saved.id}`,
          },
          {
            jobId: `notify:${saved.id}`,
            attempts: 5,
            backoff: { type: "exponential", delay: 2000 },
          },
        );
      } else {
        await maybeNotify(ctx, saved.id, signal.risk, signal.headline, fetchImpl);
      }
    }
  } catch (error) {
    ctx.logger.warn({ err: error }, "analysis failed closed");
    await ctx.db.update(events).set({ status: "needs_analysis" }).where(eq(events.id, eventId));
    if (reservation) {
      await ctx.db
        .update(tokenBudgetReservations)
        .set({ status: "abandoned" })
        .where(eq(tokenBudgetReservations.id, reservation.id));
    }
  }
}

export async function analyzeQueuedEvent(
  ctx: AppContext,
  eventId: string,
  fetchImpl?: typeof fetch,
) {
  const [event] = await ctx.db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event || event.status !== "needs_analysis") {
    return;
  }
  const linked = await ctx.db
    .select({
      id: evidenceItems.id,
      title: evidenceItems.title,
      bodyText: evidenceItems.bodyText,
      canonicalUrl: evidenceItems.canonicalUrl,
      sourceFamily: evidenceItems.sourceFamily,
      adapterPayload: evidenceItems.adapterPayload,
      publishedAt: evidenceItems.publishedAt,
      fetchedAt: evidenceItems.fetchedAt,
      originKey: evidenceItems.originKey,
      referencedOriginKey: evidenceItems.referencedOriginKey,
      contentCompleteness: evidenceItems.contentCompleteness,
      sourceIdentityId: evidenceItems.sourceIdentityId,
      role: eventEvidence.role,
    })
    .from(eventEvidence)
    .innerJoin(evidenceItems, eq(eventEvidence.evidenceId, evidenceItems.id))
    .where(eq(eventEvidence.eventId, eventId))
    .limit(ctx.config.RIDDLR_ANALYSIS_EVIDENCE_LIMIT);
  const observationRows = await ctx.db
    .select()
    .from(observations)
    .where(eq(observations.eventId, eventId))
    .limit(MAX_OBSERVATIONS_PER_EVENT);
  const assetLinks = await ctx.db
    .select()
    .from(eventAssets)
    .where(eq(eventAssets.eventId, eventId))
    .limit(50);
  const assetIds = assetLinks.map((item) => item.assetId);
  const eventAssetRows =
    assetIds.length > 0
      ? await ctx.db.select().from(assets).where(inArray(assets.id, assetIds)).limit(50)
      : [];
  const claimRows = await ctx.db
    .select({ claimId: eventClaims.claimId, kind: claims.kind })
    .from(eventClaims)
    .innerJoin(claims, eq(eventClaims.claimId, claims.id))
    .where(eq(eventClaims.eventId, eventId))
    .limit(32);
  const agentContext = await loadAgentScanContext(ctx, event.agentId);
  const watchlistIds = new Set(agentContext.watchlist.map((item) => item.canonicalId));
  const trustMaps = await loadTrustMaps(ctx);
  const facts = buildEventFacts({
    evidence: linked.map((row) => ({
      hostname: sourceHostname(row.canonicalUrl),
      sourceFamily: row.sourceFamily ?? undefined,
      text: `${row.title ?? ""} ${row.bodyText ?? ""}`,
      publishedAt: row.publishedAt ?? undefined,
      role: (row.role === "supporting" || row.role === "derived" || row.role === "contradicting"
        ? row.role
        : "primary") as "primary" | "supporting" | "derived" | "contradicting",
      adapterPayload: row.adapterPayload,
      originKey: row.originKey ?? undefined,
      referencedOriginKey: row.referencedOriginKey ?? undefined,
      outboundUrls: payloadUrls(row.adapterPayload),
      contentCompleteness:
        (row.contentCompleteness as
          | "snippet"
          | "full_document"
          | "native_complete"
          | "incomplete"
          | "unsupported") ?? undefined,
      hasValidatedClaim: claimRows.length > 0,
      trustTier: trustMaps.forEvidence(row.sourceIdentityId, sourceHostname(row.canonicalUrl)),
    })),
    assets: eventAssetRows.map((item) => ({
      assetClass: item.assetClass,
      canonicalId: item.canonicalId,
    })),
    observations: [
      ...linked.flatMap((row) =>
        observationsFromMarketPayload(row.adapterPayload, row.id, row.publishedAt ?? row.fetchedAt),
      ),
      ...linked.flatMap((row) =>
        observationsFromDetectorPayload(
          row.adapterPayload,
          row.id,
          row.publishedAt ?? row.fetchedAt,
        ),
      ),
      ...observationRows.map((row) => ({
        kind: row.kind,
        value: row.value,
        unit: row.unit ?? undefined,
        observedAt: row.observedAt,
        sourceId: row.sourceId,
        assetCanonicalId: row.assetCanonicalId ?? undefined,
      })),
    ],
    watchlistOverlap: eventAssetRows.some((item) => watchlistIds.has(item.canonicalId)),
    portfolioOverlap: false,
  });
  const material = isMaterialEvent({
    independentHostCount: facts.independentHostCount,
    independentFamilyCount: facts.independentFamilyCount,
    independentOriginCount: facts.independentOriginCount,
    evidenceCount: facts.evidenceCount,
    derivedCount: facts.derivedCount,
    watchlistOverlap: facts.watchlistOverlap,
    portfolioOverlap: facts.portfolioOverlap,
    sourcedObservationCount: observationRows.length,
    hasAuthoritativePrimary: facts.hasTrustedFirsthand,
    hasTrustedFirsthand: facts.hasTrustedFirsthand,
    contentCompleteness: facts.contentCompleteness,
    hasValidatedClaim: facts.hasValidatedClaim,
    observedAnomaly: linked.some((row) => row.sourceFamily === "observation"),
  });
  const discovery = discoverCandidate({
    facts,
    objectives: agentContext.agent?.objectives ?? [],
    text: linked.map((row) => `${row.title ?? ""} ${row.bodyText ?? ""}`).join("\n"),
    material,
  });
  await maybeAnalyze(
    ctx,
    event.id,
    event.agentId,
    linked,
    [
      ...formatAnalysisFacts(facts),
      ...formatDiscoveryNotes(discovery),
      event.materialityReason ? `Materiality: ${event.materialityReason}` : "",
    ].filter(Boolean),
    agentContext,
    fetchImpl,
    {
      facts,
      material,
      title: event.title,
      reliability: event.reliabilityStatus as ReliabilityStatus | undefined,
      impact: event.impactLevel as
        | "informational"
        | "low"
        | "moderate"
        | "high"
        | "critical"
        | undefined,
      claimIds: claimRows.map((item) => item.claimId),
      claimKinds: claimRows.map((item) => item.kind),
      earlyWarningsEnabled: await instanceEarlyWarningsEnabled(ctx),
      previousReliability: event.reliabilityStatus as ReliabilityStatus | undefined,
      shadowAssessments: await instanceShadowAssessments(ctx),
      marketDomainId: event.marketDomainId ?? agentContext.marketDomainId,
      earlyWarningAllowed: linked.some((row) =>
        trustMaps.allows(row.sourceIdentityId, sourceHostname(row.canonicalUrl), "early_warning"),
      ),
    },
  );
}
