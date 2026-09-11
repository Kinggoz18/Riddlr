import { createHash } from "node:crypto";
import { decryptSecretWithKeys } from "@riddlr/crypto";
import {
  agentSkills,
  agentSources,
  agents,
  aiUsageEvents,
  analyses,
  analysisCache,
  assets,
  encryptedSecrets,
  eventAssets,
  eventEvidence,
  events,
  evidenceItems,
  evidenceOccurrences,
  evidenceRelations,
  observations,
  portfolioHoldings,
  providerConfigs,
  scanSourceRuns,
  scans,
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
  buildEventFacts,
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
  independenceCounts,
  isMaterialEvent,
  isNearDuplicate,
  MAX_EVENTS_PER_SCAN,
  MAX_OBSERVATIONS_PER_EVENT,
  MAX_SKILLS_PER_AGENT,
  MAX_WATCHLIST_ITEMS,
  nextEventStatus,
  normalizeEvidence,
  observationsFromMarketPayload,
  SIGNAL_JSON_SCHEMA,
  selectApplicableSkills,
  skippedSkillNotice,
  sourceHostname,
  takeBounded,
  textOpposes,
  uniqueIndependentHosts,
  validateSignalOutput,
  watchlistSearchQuery,
} from "@riddlr/domain";
import {
  buildAnalysisPrompt,
  createAnthropicCompatibleProvider,
  createOpenAiCompatibleProvider,
} from "@riddlr/llm";
import {
  createCoinGeckoAdapter,
  createCoinMarketCapAdapter,
  createCryptoComAdapter,
  createDiscordAdapter,
  createSearxngAdapter,
  createXAdapter,
  SourceAdapterRegistry,
} from "@riddlr/source-adapters";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { AppContext } from "../context.js";
import { maybeNotify } from "./notify.js";

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
    const boundSources = sourceRows.map((row) => row.source);
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
    adapters.register(createCoinGeckoAdapter(deps.fetchImpl ?? fetch));
    adapters.register(createCoinMarketCapAdapter(deps.fetchImpl ?? fetch));
    adapters.register(createCryptoComAdapter(deps.fetchImpl ?? fetch));
    const module = ctx.domains.require("crypto");
    const agentContext = await loadAgentScanContext(ctx, scan.agentId);
    let partial = false;
    let sourceFailures = 0;
    let sourceSuccesses = 0;
    const collected = [];

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
      const remaining: number = ctx.config.RIDDLR_SCAN_EVIDENCE_LIMIT - collected.length;
      if (remaining <= 0) {
        break;
      }
      const runtimeConfig: Record<string, unknown> = { ...source.config };
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
      const queryText =
        adapter.family === "market_data"
          ? agentContext.watchlist.map((item) => item.canonicalId).join(" ")
          : watchlistSearchQuery(
              agentContext.watchlist.map((item) => ({
                canonicalId: item.canonicalId,
                symbol: item.symbol,
                name: item.displayName,
              })),
              adapter.id === "searxng"
                ? "cryptocurrency bitcoin ethereum stablecoin news"
                : adapter.id === "x"
                  ? "crypto"
                  : "",
            );
      const requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            sourceId: source.id,
            adapterId: source.adapterId,
            query: queryText,
          }),
        )
        .digest("hex");
      const [fetchRequest] = await ctx.db
        .insert(sourceFetchRequests)
        .values({
          scanId,
          sourceId: source.id,
          adapterId: source.adapterId,
          requestHash,
          status: "running",
        })
        .returning();
      const result = await adapter.fetch(runtimeConfig, {
        query: queryText,
        timeRange: "day",
        limit: remaining,
      });
      if (fetchRequest) {
        await ctx.db
          .update(sourceFetchRequests)
          .set({
            status: result.errors.length && result.evidence.length === 0 ? "failed" : "succeeded",
            errorClass: result.errors[0]?.class,
            finishedAt: new Date(),
            evidenceCount: result.evidence.length,
          })
          .where(eq(sourceFetchRequests.id, fetchRequest.id));
      }
      if (result.partial || result.errors.length > 0) {
        partial = true;
      }
      await ctx.db.insert(scanSourceRuns).values({
        scanId,
        sourceId: source.id,
        status: result.errors.length && result.evidence.length === 0 ? "failed" : "succeeded",
        errorClass: result.errors[0]?.class,
        errorMessage: result.errors.map((item) => item.message).join("; ") || null,
        evidenceCount: result.evidence.length,
      });
      if (result.errors.length && result.evidence.length === 0) {
        sourceFailures += 1;
      } else {
        sourceSuccesses += 1;
      }
      await ctx.db
        .update(sources)
        .set({
          lastHealthOk: result.evidence.length > 0 || result.errors.length === 0,
          lastHealthMessage: result.errors[0]?.message ?? "ok",
          lastHealthAt: new Date(),
        })
        .where(eq(sources.id, source.id));
      collected.push(
        ...takeBounded(result.evidence, remaining).map((item) => ({
          raw: item,
          sourceId: source.id,
          fetchRequestId: fetchRequest?.id,
          family: source.family,
          adapterId: source.adapterId,
          normalized: normalizeEvidence(item),
        })),
      );
    }

    const usedIds: string[] = [];
    const byHash = new Map<string, string>();
    for (const item of collected) {
      const existing = byHash.get(item.normalized.contentHash);
      try {
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
            adapterPayload: item.normalized.adapterPayload,
            sourceFamily: item.family,
            adapterId: item.adapterId,
            externalId: item.normalized.externalId,
            language: item.normalized.language,
            fetchRequestId: item.fetchRequestId,
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

    const evidenceRows =
      usedIds.length > 0
        ? await ctx.db.select().from(evidenceItems).where(inArray(evidenceItems.id, usedIds))
        : [];
    const holdings = await ctx.db.select().from(portfolioHoldings).limit(50);
    const holdingIds = new Set(holdings.map((item) => item.canonicalId));

    const prepared = evidenceRows.map((row) => {
      const normalized = normalizeEvidence({
        sourceFamily: row.sourceFamily ?? "collected",
        adapterId: row.adapterId ?? "pipeline",
        url: row.canonicalUrl ?? undefined,
        title: row.title ?? undefined,
        bodyText: row.bodyText ?? undefined,
        fetchedAt: row.fetchedAt,
        publishedAt: row.publishedAt ?? undefined,
        adapterPayload: row.adapterPayload ?? undefined,
      });
      return {
        id: row.id,
        row,
        normalized,
        hostname: sourceHostname(row.canonicalUrl),
        publishedAt: row.publishedAt ?? undefined,
        sourceFamily: row.sourceFamily ?? undefined,
        assetCanonicalIds: module.extractAssets([normalized]).map((item) => item.canonicalId),
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
      prepared.length > 0 ? clusterEvidence(prepared, MAX_EVENTS_PER_SCAN) : { clusters: [] };
    const clusters = absorbMarketDataClusters(clustered.clusters);

    if (clusters.length === 0) {
      await ctx.db.insert(events).values({
        agentId: scan.agentId,
        scanId,
        title: "No evidence in this scan window",
        status: "empty",
        windowStart: scan.windowStart,
        independentCount: 0,
        derivedCount: 0,
      });
    }

    for (const cluster of clusters) {
      const clusterRows = cluster.map((item) => item.row);
      const clusterNorm = cluster.map((item) => item.normalized);
      const extracted = module.extractAssets(clusterNorm);
      const sourced = takeBounded(
        [
          ...cluster.flatMap((item) =>
            observationsFromMarketPayload(
              item.row.adapterPayload,
              item.row.adapterId ?? item.id,
              item.publishedAt ?? item.row.fetchedAt,
            ),
          ),
          ...module.extractObservations(clusterNorm),
        ],
        MAX_OBSERVATIONS_PER_EVENT,
      );
      const roles = cluster.map((item, index) => {
        const sameDayHost = cluster.some((other, otherIndex) => {
          if (otherIndex >= index) {
            return false;
          }
          const sameHost = item.hostname && item.hostname === other.hostname;
          const dayLeft = item.publishedAt?.toISOString().slice(0, 10);
          const dayRight = other.publishedAt?.toISOString().slice(0, 10);
          return Boolean(sameHost && dayLeft && dayLeft === dayRight);
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
          sameHostnameSameDay: sameDayHost,
          opposingClaims: cluster.some(
            (other, otherIndex) => otherIndex < index && textOpposes(item.text, other.text),
          ),
        });
      });
      const counts = independenceCounts(roles);
      const watchlistIds = new Set(agentContext.watchlist.map((item) => item.canonicalId));
      const watchlistOverlap = extracted.some((item) => watchlistIds.has(item.canonicalId));
      const overlap = extracted.filter((item) => holdingIds.has(item.canonicalId));
      const hostCount = uniqueIndependentHosts(
        cluster.map((item, index) => ({
          hostname: item.hostname,
          role: roles[index] ?? "primary",
        })),
      );
      const fingerprint = eventClusterFingerprint(cluster.map((item) => item.id));
      const context = module.assembleContext({
        evidence: clusterNorm,
        assets: extracted,
        observations: sourced,
        watchlist: agentContext.watchlist,
      });
      const facts = buildEventFacts({
        evidence: cluster.map((item, index) => ({
          hostname: item.hostname,
          sourceFamily: item.sourceFamily ?? item.row.sourceFamily ?? undefined,
          text: item.text,
          publishedAt: item.publishedAt,
          role: roles[index] ?? "primary",
          adapterPayload: item.row.adapterPayload,
        })),
        assets: extracted,
        observations: sourced,
        watchlistOverlap,
        portfolioOverlap: overlap.length > 0,
      });
      const material = isMaterialEvent({
        independentHostCount: hostCount,
        independentFamilyCount: new Set(clusterRows.map((row) => row.sourceFamily ?? row.sourceId))
          .size,
        evidenceCount: clusterRows.length,
        derivedCount: counts.derivedReprintCount,
        watchlistOverlap,
        portfolioOverlap: overlap.length > 0,
        sourcedObservationCount: sourced.length,
        hasAuthoritativePrimary: roles.some((role, index) => {
          const family = clusterRows[index]?.sourceFamily;
          return role === "primary" && (family === "x" || family === "discord");
        }),
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
      const [event] = await ctx.db
        .insert(events)
        .values({
          agentId: scan.agentId,
          scanId,
          title: clusterEventTitle({
            assets: extracted,
            evidenceTitles: clusterRows.map((item) => item.title),
            hostnames: cluster.map((item) => item.hostname ?? "unknown-host"),
          }),
          status,
          windowStart: scan.windowStart,
          independentCount: hostCount,
          derivedCount: counts.derivedReprintCount,
          clusterFingerprint: fingerprint,
          materialityReason: material.reason,
          epistemicStatus: discovery.epistemicStatus,
          candidateKind: discovery.kind,
          discoveryReason: discovery.reason,
        })
        .onConflictDoNothing()
        .returning();
      if (!event) {
        continue;
      }
      for (let index = 0; index < clusterRows.length; index += 1) {
        const evidence = clusterRows[index];
        const role = roles[index] ?? "primary";
        if (evidence) {
          await ctx.db
            .insert(eventEvidence)
            .values({ eventId: event.id, evidenceId: evidence.id, role });
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

      if (material.material) {
        if (ctx.analyzeQueue) {
          await ctx.analyzeQueue.add(
            "analyze",
            { eventId: event.id, scanId, idempotencyKey: `analyze:${event.id}` },
            {
              jobId: `analyze:${event.id}`,
              attempts: 3,
              backoff: { type: "exponential", delay: 5_000 },
            },
          );
        } else {
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
            },
          );
        }
      }
    }

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
  const module = ctx.domains.require("crypto");
  const resolved = items
    .map((item) =>
      module.canonicalizeAsset({
        canonicalId: item.canonicalId,
        symbol: item.symbol ?? undefined,
        name: item.name ?? undefined,
        assetClass: item.assetClass as "cryptocurrency" | "meme_coin" | "stablecoin",
      }),
    )
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  return {
    agent,
    skillPolicies: skillRows.map((row) => ({ slug: row.slug, markdown: row.markdownBody })),
    watchlist: resolved,
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
  },
) {
  const budget = agentContext.agent?.tokenBudget ?? ctx.config.RIDDLR_DEFAULT_TOKEN_BUDGET;
  const dayUtc = new Date().toISOString().slice(0, 10);
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
    eventSummary: hint?.title ?? "Crypto cluster",
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
        eq(analysisCache.schemaVersion, "1"),
        eq(analysisCache.promptHash, promptHash),
        eq(analysisCache.skillHash, skillHash),
        eq(analysisCache.contextHash, contextHash),
      ),
    )
    .limit(1);
  let reservation: { id: string } | undefined;
  if (!cached) {
    const [row] = await ctx.db
      .insert(tokenBudgetReservations)
      .values({
        agentId,
        dayUtc,
        reservedTokens: Math.min(4000, budget),
        status: "open",
      })
      .returning();
    reservation = row;
    const [used] = await ctx.db
      .select({
        tokens: sql<number>`coalesce(sum(${tokenBudgetReservations.reservedTokens}), 0)`,
      })
      .from(tokenBudgetReservations)
      .where(
        and(
          eq(tokenBudgetReservations.agentId, agentId),
          eq(tokenBudgetReservations.dayUtc, dayUtc),
          sql`${tokenBudgetReservations.status} <> 'abandoned'`,
        ),
      );
    if (Number(used?.tokens ?? 0) > budget) {
      if (reservation) {
        await ctx.db
          .update(tokenBudgetReservations)
          .set({ status: "abandoned" })
          .where(eq(tokenBudgetReservations.id, reservation.id));
      }
      ctx.logger.info({ agentId, budget }, "token budget exhausted; analysis skipped");
      return;
    }
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
        schemaVersion: "1",
        promptHash,
        skillHash,
        contextHash,
        rawOutput: completion.parsed as Record<string, unknown>,
      });
    }
    const signal = validateSignalOutput(parsed, allowed);
    const material = hint?.material ?? {
      material: true,
      reason: "independent_hosts",
    };
    const gate = decideSignalGate({
      facts: hint?.facts ?? fallbackFacts(evidenceRows, notes),
      risk: signal.risk,
      confidence: signal.confidence,
      material,
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
        notifyEligible: gate.notifyEligible,
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
      schemaVersion: "1",
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
          proof: signal.proof,
          action: signal.action,
          risk: signal.risk,
          confidence: String(signal.confidence),
          marketContext: signal.marketContext,
          contradictoryEvidence: signal.contradictoryEvidence,
          invalidationConditions: signal.invalidationConditions,
          schemaVersion: "1",
          notifyEligible: gate.notifyEligible,
          epistemicStatus: "signal",
        })
        .onConflictDoNothing()
        .returning();
      saved = inserted[0];
      await ctx.db
        .update(events)
        .set({ status: "analyzed", epistemicStatus: "signal" })
        .where(eq(events.id, eventId));
    } else {
      await ctx.db.update(events).set({ status: "analyzed" }).where(eq(events.id, eventId));
    }
    if (saved && gate.notifyEligible) {
      if (ctx.notifyQueue) {
        await ctx.notifyQueue.add(
          "notify",
          { signalId: saved.id, idempotencyKey: `notify:${saved.id}` },
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
  const agentContext = await loadAgentScanContext(ctx, event.agentId);
  const watchlistIds = new Set(agentContext.watchlist.map((item) => item.canonicalId));
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
    })),
    assets: eventAssetRows.map((item) => ({
      assetClass: item.assetClass,
      canonicalId: item.canonicalId,
    })),
    observations: [
      ...linked.flatMap((row) =>
        observationsFromMarketPayload(row.adapterPayload, row.id, row.publishedAt ?? row.fetchedAt),
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
    evidenceCount: facts.evidenceCount,
    derivedCount: facts.derivedCount,
    watchlistOverlap: facts.watchlistOverlap,
    portfolioOverlap: facts.portfolioOverlap,
    sourcedObservationCount: observationRows.length,
    hasAuthoritativePrimary: facts.hasAuthoritativePrimary,
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
    { facts, material, title: event.title },
  );
}
