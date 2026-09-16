import { createHash } from "node:crypto";
import { decryptSecretWithKeys } from "@riddlr/crypto";
import {
  aiUsageEvents,
  claimEvidence,
  claims,
  encryptedSecrets,
  evidenceDocuments,
  evidenceItems,
  evidenceUnderstanding,
  hostRobotsCache,
  providerConfigs,
  publisherHostPolicies,
  scans,
  sourceIdentities,
  sourceIdentityPolicies,
  watchlistItems,
  watchlists,
} from "@riddlr/db";
import {
  blockedPublisherHosts,
  buildUnderstandingPrompt,
  CATALYST_KINDS,
  CONTENT_UNDERSTANDING_JSON_SCHEMA,
  CONTENT_UNDERSTANDING_SCHEMA_VERSION,
  claimSatisfiesCatalystContract,
  claimStanceFromExtraction,
  classifyPageHeuristic,
  collectAllowedSubjectIds,
  contentHash,
  DEFAULT_OFFICIAL_FIRSTHAND_HOSTS,
  DEFAULT_PRICE_TRACKER_HOSTS,
  DEFAULT_REPUTABLE_PRESS_HOSTS,
  type DomainModule,
  EXTRACTOR_VERSION,
  enrichmentEligibility,
  excerptHash,
  excerptOffsets,
  excerptPresent,
  hasAssertedClaimCounterpart,
  headlineBodyMismatch,
  hostMatchesPublisherPolicy,
  isEnrichableSourceFamily,
  MAX_ASSETS_PER_DOCUMENT,
  MAX_CATALYST_KINDS,
  MAX_HOST_ROBOTS_CACHE,
  MIN_NATIVE_COMPLETE_CHARS,
  type NormalizedEvidence,
  overlayNormalizedClaimNegation,
  type PageClass,
  preferEvidenceTitle,
  prioritizeEnrichment,
  publisherHostIsBlocked,
  ROBOTS_CACHE_TTL_MS,
  skipUnderstandingForPageClass,
  sourceHostname,
  type TrustTier,
  type TrustUse,
  takeBounded,
  trustAllowsUse,
  validateContentUnderstanding,
} from "@riddlr/domain";
import { createAnthropicCompatibleProvider, createOpenAiCompatibleProvider } from "@riddlr/llm";
import { enrichPublicDocument, pathDisallowedByRobots } from "@riddlr/source-adapters";
import { and, asc, count, eq, gt } from "drizzle-orm";
import type { AppContext } from "../context.js";
import { listRegistryAssets } from "./asset-registry.js";

export async function upsertSourceIdentity(
  ctx: AppContext,
  candidate?: {
    platform: string;
    externalId: string;
    displayName?: string;
    hostname?: string;
    parentExternalId?: string;
    verifiedBadge?: boolean;
  },
): Promise<string | undefined> {
  if (!candidate?.platform || !candidate.externalId) {
    return undefined;
  }
  let parentId: string | undefined;
  if (candidate.parentExternalId && candidate.parentExternalId !== candidate.externalId) {
    parentId = await upsertSourceIdentity(ctx, {
      platform: candidate.platform,
      externalId: candidate.parentExternalId,
      hostname: candidate.hostname,
    });
  }
  const [row] = await ctx.db
    .insert(sourceIdentities)
    .values({
      platform: candidate.platform,
      externalId: candidate.externalId,
      displayName: candidate.displayName,
      hostname: candidate.hostname,
      parentId,
      verifiedBadge: candidate.verifiedBadge ?? false,
    })
    .onConflictDoNothing()
    .returning();
  const persisted =
    row ??
    (
      await ctx.db
        .select()
        .from(sourceIdentities)
        .where(
          and(
            eq(sourceIdentities.platform, candidate.platform),
            eq(sourceIdentities.externalId, candidate.externalId),
          ),
        )
        .limit(1)
    )[0];
  if (persisted) {
    await ctx.db
      .update(sourceIdentities)
      .set({
        lastObservedAt: new Date(),
        displayName: candidate.displayName ?? persisted.displayName,
        parentId: parentId ?? persisted.parentId,
      })
      .where(eq(sourceIdentities.id, persisted.id));
  }
  return persisted?.id;
}

export async function ensureOfficialSecIssuer(
  ctx: AppContext,
  cik: string,
  displayName?: string,
): Promise<void> {
  const identityId = await upsertSourceIdentity(ctx, {
    platform: "sec",
    externalId: cik,
    displayName: displayName ?? cik,
    hostname: "www.sec.gov",
  });
  if (!identityId) {
    return;
  }
  const policies = await ctx.db
    .select()
    .from(sourceIdentityPolicies)
    .where(eq(sourceIdentityPolicies.identityId, identityId))
    .limit(50);
  if (policies.some((row) => row.active)) {
    return;
  }
  const revision = policies.reduce((max, row) => Math.max(max, row.revision), 0) + 1;
  await ctx.db.insert(sourceIdentityPolicies).values({
    identityId,
    revision,
    trustTier: "official_firsthand",
    allowedUses: ["discovery", "analysis", "early_warning", "confirmation"],
    notes: `SEC issuer ${cik}`,
    active: true,
  });
}

export async function ensureOfficialSnapshotSpace(
  ctx: AppContext,
  spaceId: string,
  displayName?: string,
): Promise<void> {
  const identityId = await upsertSourceIdentity(ctx, {
    platform: "snapshot",
    externalId: spaceId,
    displayName: displayName ?? spaceId,
    hostname: "snapshot.box",
  });
  if (!identityId) {
    return;
  }
  const policies = await ctx.db
    .select()
    .from(sourceIdentityPolicies)
    .where(eq(sourceIdentityPolicies.identityId, identityId))
    .limit(50);
  if (policies.some((row) => row.active)) {
    return;
  }
  const revision = policies.reduce((max, row) => Math.max(max, row.revision), 0) + 1;
  await ctx.db.insert(sourceIdentityPolicies).values({
    identityId,
    revision,
    trustTier: "official_firsthand",
    allowedUses: ["discovery", "analysis", "early_warning", "confirmation"],
    notes: `Snapshot space ${spaceId}`,
    active: true,
  });
}

export type TrustSnapshot = {
  revision: number;
  trustTier: TrustTier;
  allowedUses: string[];
  blocked?: boolean;
};

export async function loadTrustMaps(ctx: AppContext) {
  const identityPolicies = await ctx.db
    .select()
    .from(sourceIdentityPolicies)
    .where(eq(sourceIdentityPolicies.active, true))
    .limit(500);
  const identityParents = await ctx.db
    .select({ id: sourceIdentities.id, parentId: sourceIdentities.parentId })
    .from(sourceIdentities)
    .limit(500);
  const parentById = new Map(identityParents.map((row) => [row.id, row.parentId] as const));
  const hosts = await ctx.db.select().from(publisherHostPolicies).limit(256);
  const byIdentity = new Map<string, TrustSnapshot>();
  for (const row of identityPolicies) {
    const current = byIdentity.get(row.identityId);
    if (!current || row.revision > current.revision) {
      byIdentity.set(row.identityId, {
        revision: row.revision,
        trustTier: row.trustTier as TrustTier,
        allowedUses: row.allowedUses ?? ["discovery"],
      });
    }
  }
  const byHost = new Map<string, TrustSnapshot>();
  for (const row of hosts) {
    const current = byHost.get(row.hostname);
    if (!current || row.revision > current.revision) {
      byHost.set(row.hostname, {
        revision: row.revision,
        trustTier: row.trustTier as TrustTier,
        allowedUses: row.allowedUses ?? ["discovery", "analysis"],
        blocked: row.blocked,
      });
    }
  }
  return {
    blockedHosts: blockedPublisherHosts(hosts),
    snapshot(identityId?: string | null, hostname?: string): TrustSnapshot {
      if (identityId) {
        const hit = byIdentity.get(identityId);
        if (hit) {
          return hit;
        }
        const parentId = parentById.get(identityId);
        if (parentId) {
          const parentHit = byIdentity.get(parentId);
          if (parentHit) {
            return parentHit;
          }
        }
      }
      if (hostname) {
        const hostKey = hostname.toLowerCase();
        let host: TrustSnapshot | undefined;
        for (const [pattern, snap] of byHost) {
          if (hostMatchesPublisherPolicy(hostKey, pattern)) {
            host = snap;
            break;
          }
        }
        if (host) {
          return host.blocked ? { ...host, trustTier: "blocked" } : host;
        }
        if (publisherHostIsBlocked(hostKey, hosts)) {
          return {
            revision: 0,
            trustTier: "blocked",
            allowedUses: ["discovery"],
            blocked: true,
          };
        }
      }
      return { revision: 0, trustTier: "unknown", allowedUses: ["discovery", "analysis"] };
    },
    forEvidence(identityId?: string | null, hostname?: string): TrustTier {
      return this.snapshot(identityId, hostname).trustTier;
    },
    allows(
      identityId: string | null | undefined,
      hostname: string | undefined,
      use: TrustUse,
    ): boolean {
      const snap = this.snapshot(identityId, hostname);
      return trustAllowsUse(snap.trustTier, use, snap.allowedUses);
    },
  };
}

export async function ensureDefaultPriceTrackerHostPolicies(ctx: AppContext) {
  for (const hostname of DEFAULT_PRICE_TRACKER_HOSTS) {
    await ctx.db
      .insert(publisherHostPolicies)
      .values({
        hostname,
        revision: 1,
        trustTier: "blocked",
        blocked: true,
        allowedUses: ["discovery"],
        notes:
          "Default price-tracker host. Search hits cannot produce claims. Observation providers for this host still poll.",
      })
      .onConflictDoNothing();
  }
  for (const hostname of DEFAULT_REPUTABLE_PRESS_HOSTS) {
    await ctx.db
      .insert(publisherHostPolicies)
      .values({
        hostname,
        revision: 1,
        trustTier: "reputable_press",
        blocked: false,
        allowedUses: ["discovery", "analysis"],
        notes: "Default reputable press host. Discovery and analysis only.",
      })
      .onConflictDoNothing();
  }
  for (const hostname of DEFAULT_OFFICIAL_FIRSTHAND_HOSTS) {
    await ctx.db
      .insert(publisherHostPolicies)
      .values({
        hostname,
        revision: 1,
        trustTier: "official_firsthand",
        blocked: false,
        allowedUses: ["discovery", "analysis", "early_warning", "confirmation"],
        notes: "Default official firsthand host.",
      })
      .onConflictDoNothing();
  }
}

export async function enrichAndUnderstandScan(input: {
  ctx: AppContext;
  module: DomainModule;
  evidenceRows: Array<typeof evidenceItems.$inferSelect>;
  fetchImpl?: typeof fetch;
  windowStart?: Date;
}): Promise<void> {
  const { ctx, module, fetchImpl } = input;
  const registry = await listRegistryAssets(ctx);
  const trustMaps = await loadTrustMaps(ctx);
  const blocked = trustMaps.blockedHosts;
  const robotsCache = await loadFreshRobotsCache(ctx);
  const eligible = [];
  for (const row of input.evidenceRows) {
    if (!isEnrichableSourceFamily(row.sourceFamily ?? undefined)) {
      continue;
    }
    if (row.contentCompleteness === "native_complete") {
      await persistNativeCompleteDocument(ctx, row);
      continue;
    }
    if (cachedRobotsDeniesUrl(robotsCache, row.canonicalUrl ?? undefined)) {
      ctx.metrics.enrichmentOutcomes.inc({ status: "skipped_robots" });
      continue;
    }
    const check = enrichmentEligibility({
      url: row.canonicalUrl ?? undefined,
      title: row.title ?? undefined,
      publishedAt: row.publishedAt ?? undefined,
      fetchedAt: row.fetchedAt,
      windowStart: input.windowStart,
      blockedHosts: blocked,
    });
    if (check.eligible) {
      eligible.push(row);
    }
  }
  const ranked = prioritizeEnrichment(
    eligible.map((row) => ({
      id: row.id,
      url: row.canonicalUrl ?? undefined,
      title: row.title ?? undefined,
      fetchedAt: row.fetchedAt,
    })),
    ctx.config.RIDDLR_ENRICH_PER_SCAN,
  );
  const eligibleById = new Map(eligible.map((row) => [row.id, row]));
  const perHost = new Map<string, number>();
  for (const rankedRow of ranked) {
    const row = eligibleById.get(rankedRow.id);
    if (!row?.canonicalUrl) {
      continue;
    }
    const host = (() => {
      try {
        return new URL(row.canonicalUrl).hostname.toLowerCase();
      } catch {
        return "unknown";
      }
    })();
    const used = perHost.get(host) ?? 0;
    if (used >= ctx.config.RIDDLR_ENRICH_PER_HOST) {
      continue;
    }
    perHost.set(host, used + 1);
    const origin = (() => {
      try {
        return new URL(row.canonicalUrl).origin;
      } catch {
        return undefined;
      }
    })();
    const cachedRobots = origin ? robotsCache.get(origin) : undefined;
    if (
      cachedRobots &&
      pathDisallowedByRobots(cachedRobots.text, new URL(row.canonicalUrl).pathname)
    ) {
      ctx.metrics.enrichmentOutcomes.inc({ status: "skipped_robots" });
      continue;
    }
    const existing = await ctx.db
      .select()
      .from(evidenceDocuments)
      .where(eq(evidenceDocuments.evidenceId, row.id))
      .limit(1);
    const prior = existing[0];
    const document = await enrichPublicDocument({
      url: row.canonicalUrl,
      fetchImpl,
      skipDns: Boolean(fetchImpl),
      maxBytes: ctx.config.RIDDLR_ENRICH_MAX_BYTES,
      timeoutMs: ctx.config.RIDDLR_ENRICH_TIMEOUT_MS,
      ifNoneMatch: prior?.etag ?? undefined,
      ifModifiedSince: prior?.lastModified ?? undefined,
      cachedRobotsTxt: cachedRobots?.text,
      cachedRobotsStatus: cachedRobots?.status,
      onRobotsTxt: async (loaded) => {
        if (!origin || loaded.fromCache) {
          return;
        }
        robotsCache.set(origin, { text: loaded.text, status: loaded.status });
        await persistRobotsCache(ctx, origin, loaded.text, loaded.status);
      },
    });
    ctx.metrics.enrichmentOutcomes.inc({ status: document.status });
    if (document.status === "not_modified" && prior) {
      continue;
    }
    await ctx.db
      .insert(evidenceDocuments)
      .values({
        evidenceId: row.id,
        requestedUrl: document.requestedUrl,
        finalUrl: document.finalUrl,
        httpStatus: document.httpStatus,
        contentType: document.contentType,
        byteCount: document.byteCount,
        responseHash: document.responseHash,
        cleanedContentHash: document.cleanedContentHash,
        cleanedText: document.cleanedText,
        extractedTitle: document.extractedTitle,
        byline: document.byline,
        language: document.language,
        etag: document.etag,
        lastModified: document.lastModified,
        extractorVersion: document.extractorVersion,
        fetchedAt: document.fetchedAt,
        status: document.status,
        failureReason: document.failureReason,
      })
      .onConflictDoNothing();
    if (document.status === "extracted" && document.cleanedText.length >= 40) {
      const payload = {
        ...(row.adapterPayload ?? {}),
        outboundUrls: document.outboundUrls,
      };
      await ctx.db
        .update(evidenceItems)
        .set({
          bodyText: document.cleanedText,
          title: preferEvidenceTitle(row.title ?? undefined, document.extractedTitle) ?? row.title,
          contentCompleteness: "full_document",
          language: document.language ?? row.language,
          contentHash: document.cleanedContentHash,
          adapterPayload: payload,
        })
        .where(eq(evidenceItems.id, row.id));
    } else if (document.failureReason) {
      await ctx.db
        .update(evidenceItems)
        .set({ contentCompleteness: document.completeness })
        .where(eq(evidenceItems.id, row.id));
    }
  }

  for (const original of input.evidenceRows) {
    const [row] = await ctx.db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.id, original.id))
      .limit(1);
    await persistClaimsForEvidence(ctx, module, row ?? original, fetchImpl, registry, trustMaps);
  }
}

async function persistNativeCompleteDocument(
  ctx: AppContext,
  row: typeof evidenceItems.$inferSelect,
): Promise<void> {
  const text = row.bodyText ?? "";
  if (text.length < MIN_NATIVE_COMPLETE_CHARS) {
    return;
  }
  const existing = await ctx.db
    .select({ id: evidenceDocuments.id })
    .from(evidenceDocuments)
    .where(eq(evidenceDocuments.evidenceId, row.id))
    .limit(1);
  if (existing[0]) {
    return;
  }
  const hash = contentHash(text);
  await ctx.db
    .insert(evidenceDocuments)
    .values({
      evidenceId: row.id,
      requestedUrl: row.canonicalUrl ?? "",
      finalUrl: row.canonicalUrl ?? undefined,
      byteCount: Buffer.byteLength(text),
      responseHash: hash,
      cleanedContentHash: hash,
      cleanedText: text,
      extractedTitle: row.title,
      extractorVersion: EXTRACTOR_VERSION,
      fetchedAt: row.fetchedAt,
      status: "extracted",
    })
    .onConflictDoNothing();
  ctx.metrics.enrichmentOutcomes.inc({ status: "native" });
}

type CachedRobots = { text: string; status: number };

function cachedRobotsDeniesUrl(
  cache: ReadonlyMap<string, CachedRobots>,
  url: string | undefined,
): boolean {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    const cached = cache.get(parsed.origin);
    return Boolean(cached && pathDisallowedByRobots(cached.text, parsed.pathname));
  } catch {
    return false;
  }
}

async function loadFreshRobotsCache(ctx: AppContext): Promise<Map<string, CachedRobots>> {
  const cutoff = new Date(Date.now() - ROBOTS_CACHE_TTL_MS);
  const rows = await ctx.db
    .select()
    .from(hostRobotsCache)
    .where(gt(hostRobotsCache.fetchedAt, cutoff))
    .limit(MAX_HOST_ROBOTS_CACHE);
  const cache = new Map<string, CachedRobots>();
  for (const row of rows) {
    cache.set(row.origin, { text: row.robotsTxt, status: row.httpStatus ?? 200 });
  }
  return cache;
}

async function persistRobotsCache(
  ctx: AppContext,
  origin: string,
  text: string,
  status: number,
): Promise<void> {
  await ctx.db
    .insert(hostRobotsCache)
    .values({
      origin,
      robotsTxt: text,
      httpStatus: status,
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: hostRobotsCache.origin,
      set: {
        robotsTxt: text,
        httpStatus: status,
        fetchedAt: new Date(),
      },
    });
  const [total] = await ctx.db.select({ value: count() }).from(hostRobotsCache);
  const extra = Number(total?.value ?? 0) - MAX_HOST_ROBOTS_CACHE;
  if (extra <= 0) {
    return;
  }
  const oldest = await ctx.db
    .select({ origin: hostRobotsCache.origin })
    .from(hostRobotsCache)
    .orderBy(asc(hostRobotsCache.fetchedAt))
    .limit(extra);
  for (const row of oldest) {
    await ctx.db.delete(hostRobotsCache).where(eq(hostRobotsCache.origin, row.origin));
  }
}

async function persistClaimsForEvidence(
  ctx: AppContext,
  module: DomainModule,
  row: typeof evidenceItems.$inferSelect,
  fetchImpl: typeof fetch | undefined,
  registry: Awaited<ReturnType<typeof listRegistryAssets>>,
  trustMaps: Awaited<ReturnType<typeof loadTrustMaps>>,
) {
  const hostname = row.canonicalUrl ? sourceHostname(row.canonicalUrl) : undefined;
  if (
    hostname &&
    hostname !== "unknown-host" &&
    !trustMaps.allows(row.sourceIdentityId, hostname, "analysis")
  ) {
    ctx.metrics.claims.inc({ result: "none" });
    return;
  }
  const payload = row.adapterPayload ?? {};
  const outboundUrls = Array.isArray(payload.outboundUrls)
    ? payload.outboundUrls.filter((item): item is string => typeof item === "string")
    : undefined;
  const normalized: NormalizedEvidence = {
    sourceFamily: row.sourceFamily ?? "collected",
    adapterId: row.adapterId ?? "pipeline",
    url: row.canonicalUrl ?? undefined,
    canonicalUrl: row.canonicalUrl ?? undefined,
    title: row.title ?? undefined,
    bodyText: row.bodyText ?? undefined,
    fetchedAt: row.fetchedAt,
    publishedAt: row.publishedAt ?? undefined,
    adapterPayload: payload,
    contentCompleteness:
      (row.contentCompleteness as NormalizedEvidence["contentCompleteness"]) ?? "snippet",
    contentHash: row.contentHash,
    fingerprint: row.fingerprint,
    normalizedTitle: (row.title ?? "").toLowerCase(),
    normalizedText: (row.bodyText ?? "").toLowerCase(),
    originKey: row.originKey ?? undefined,
    outboundUrls,
  };
  let extracted = module.extractClaims([normalized], registry);
  let attributedToOtherOrigin = false;
  let attributedOrigin: string | undefined;
  let retracting = false;
  let extractionVersion = "domain-extract-1";
  const complete =
    normalized.contentCompleteness === "full_document" ||
    normalized.contentCompleteness === "native_complete";
  if (
    complete &&
    !skipUnderstandingForPageClass(
      classifyPageHeuristic({
        url: row.canonicalUrl ?? undefined,
        title: row.title ?? undefined,
        bodyText: row.bodyText ?? undefined,
      }),
    ) &&
    !headlineBodyMismatch(row.title ?? undefined, row.bodyText ?? "")
  ) {
    const understood = await understandEvidence(ctx, module, row, normalized, fetchImpl, registry);
    if (understood.pageClass && skipUnderstandingForPageClass(understood.pageClass)) {
      extracted = [];
    } else if (understood.claims.length > 0) {
      extracted = overlayNormalizedClaimNegation(understood.claims, extracted, (kind) =>
        module.mapClaimKindToCatalyst(kind),
      );
      attributedToOtherOrigin = understood.attributedToOtherOrigin;
      attributedOrigin = understood.attributedOrigin;
      retracting = understood.retracting;
      extractionVersion = "understanding-taxonomy-1";
    } else {
      extracted = extracted.filter((claim) =>
        claimSatisfiesCatalystContract({
          catalystKind: module.mapClaimKindToCatalyst(claim.kind),
          subjectCanonicalId: claim.subjectCanonicalId,
          value: claim.value,
          unit: claim.unit,
        }),
      );
    }
  } else {
    extracted = extracted.filter((claim) =>
      claimSatisfiesCatalystContract({
        catalystKind: module.mapClaimKindToCatalyst(claim.kind),
        subjectCanonicalId: claim.subjectCanonicalId,
        value: claim.value,
        unit: claim.unit,
      }),
    );
  }
  const content = `${row.title ?? ""}\n${row.bodyText ?? ""}`;
  retracting = retracting || /\b(retract|retraction|we were wrong|correction:)\b/i.test(content);
  if (extracted.length === 0) {
    ctx.metrics.claims.inc({ result: "none" });
    return;
  }
  for (const claim of takeBounded(extracted, 8)) {
    const excerpt =
      "excerpt" in claim && typeof claim.excerpt === "string"
        ? claim.excerpt
        : content.slice(0, 180);
    if (!excerptPresent(excerpt, content) && excerpt.length > 0) {
      ctx.metrics.claims.inc({ result: "rejected" });
      continue;
    }
    const offsets = excerptOffsets(excerpt, content);
    const effectiveStart = row.publishedAt ?? row.fetchedAt;
    const [saved] = await ctx.db
      .insert(claims)
      .values({
        marketDomainId: claim.marketDomainId,
        kind: claim.kind,
        subjectCanonicalId: claim.subjectCanonicalId,
        predicate: claim.predicate,
        objectText: claim.objectText,
        value: claim.value ?? null,
        unit: claim.unit,
        polarity: claim.polarity,
        modality: claim.modality,
        fingerprint: claim.fingerprint,
        title: claim.title,
        policyVersion: module.id,
        extractionVersion,
        effectiveStart,
      })
      .onConflictDoNothing()
      .returning();
    const persisted =
      saved ??
      (
        await ctx.db.select().from(claims).where(eq(claims.fingerprint, claim.fingerprint)).limit(1)
      )[0];
    if (!persisted) {
      ctx.metrics.claims.inc({ result: "rejected" });
      continue;
    }
    const stance = claimStanceFromExtraction({
      polarity: claim.polarity as "asserted" | "negated",
      modality: claim.modality as "asserted" | "alleged" | "forecast" | "denied",
      attributedToOtherOrigin,
      attributedOrigin,
      retracting,
      hasAssertedCounterpart: hasAssertedClaimCounterpart(
        {
          kind: claim.kind,
          subjectCanonicalId: claim.subjectCanonicalId,
          polarity: claim.polarity as "asserted" | "negated",
        },
        extracted.map((item) => ({
          kind: item.kind,
          subjectCanonicalId: item.subjectCanonicalId,
          polarity: item.polarity as "asserted" | "negated",
        })),
      ),
    });
    await ctx.db
      .insert(claimEvidence)
      .values({
        claimId: persisted.id,
        evidenceId: row.id,
        stance,
        excerpt,
        excerptHash: excerptHash(excerpt),
        excerptStart: offsets.start,
        excerptEnd: offsets.end,
        sourceIdentityId: row.sourceIdentityId,
      })
      .onConflictDoNothing();
    ctx.metrics.claims.inc({ result: "accepted" });
  }
}

async function scanAgentContext(
  ctx: AppContext,
  scanId: string | null,
): Promise<{ agentId?: string; watchlistIds: string[] }> {
  if (!scanId) {
    return { watchlistIds: [] };
  }
  const [scan] = await ctx.db
    .select({ agentId: scans.agentId })
    .from(scans)
    .where(eq(scans.id, scanId))
    .limit(1);
  if (!scan?.agentId) {
    return { watchlistIds: [] };
  }
  const [watchlist] = await ctx.db
    .select({ id: watchlists.id })
    .from(watchlists)
    .where(eq(watchlists.agentId, scan.agentId))
    .limit(1);
  if (!watchlist) {
    return { agentId: scan.agentId, watchlistIds: [] };
  }
  const items = await ctx.db
    .select({ canonicalId: watchlistItems.canonicalId })
    .from(watchlistItems)
    .where(eq(watchlistItems.watchlistId, watchlist.id))
    .limit(MAX_ASSETS_PER_DOCUMENT);
  return {
    agentId: scan.agentId,
    watchlistIds: items.map((item) => item.canonicalId),
  };
}

async function understandEvidence(
  ctx: AppContext,
  module: DomainModule,
  row: typeof evidenceItems.$inferSelect,
  normalized: NormalizedEvidence,
  fetchImpl: typeof fetch | undefined,
  registry: Awaited<ReturnType<typeof listRegistryAssets>>,
): Promise<{
  claims: ReturnType<DomainModule["extractClaims"]>;
  attributedToOtherOrigin: boolean;
  attributedOrigin?: string;
  retracting: boolean;
  pageClass?: PageClass;
}> {
  const empty = {
    claims: [] as ReturnType<DomainModule["extractClaims"]>,
    attributedToOtherOrigin: false,
    retracting: false,
  };
  const content = `${row.title ?? ""}\n${row.bodyText ?? ""}`;
  const [document] = await ctx.db
    .select()
    .from(evidenceDocuments)
    .where(eq(evidenceDocuments.evidenceId, row.id))
    .limit(1);
  const cleanedHash = document?.cleanedContentHash ?? row.contentHash;
  const { agentId, watchlistIds } = await scanAgentContext(ctx, row.scanId);
  const resolvedIds = module
    .extractAssets([normalized], registry, {
      preferredCanonicalIds: watchlistIds,
    })
    .map((asset) => asset.canonicalId);
  const allowedSubjectIds = collectAllowedSubjectIds({
    watchlistIds,
    resolvedIds,
    limit: MAX_ASSETS_PER_DOCUMENT,
  });
  const prompt = buildUnderstandingPrompt({
    evidenceId: row.id,
    marketDomainId: module.id,
    claimKinds: takeBounded([...CATALYST_KINDS], MAX_CATALYST_KINDS),
    title: row.title ?? undefined,
    content,
    url: row.canonicalUrl ?? undefined,
    allowedSubjectIds,
  });
  const promptHash = createHash("sha256").update(`${prompt.system}\n${prompt.user}`).digest("hex");
  const [cached] = await ctx.db
    .select()
    .from(evidenceUnderstanding)
    .where(
      and(
        eq(evidenceUnderstanding.cleanedContentHash, cleanedHash),
        eq(evidenceUnderstanding.schemaVersion, CONTENT_UNDERSTANDING_SCHEMA_VERSION),
        eq(evidenceUnderstanding.promptHash, promptHash),
        eq(evidenceUnderstanding.extractorVersion, EXTRACTOR_VERSION),
      ),
    )
    .limit(1);
  const toClaims = (raw: Record<string, unknown>) => {
    const parsed = validateContentUnderstanding(raw, {
      evidenceId: row.id,
      content,
      allowedClaimKinds: [...CATALYST_KINDS],
      allowedSubjectIds,
    });
    if (headlineBodyMismatch(row.title ?? undefined, content)) {
      parsed.headlineBodyConsistent = false;
    }
    const skipClaims = skipUnderstandingForPageClass(parsed.pageClass);
    return {
      claims: skipClaims
        ? []
        : parsed.claims
            .map((candidate) =>
              module.normalizeClaim(candidate, normalized, registry, allowedSubjectIds),
            )
            .filter((item): item is NonNullable<typeof item> => Boolean(item))
            .map((item) => ({
              ...item,
              excerpt: parsed.claims.find((candidate) => candidate.kind === item.kind)?.excerpt,
            })),
      attributedToOtherOrigin: parsed.attributedToOtherOrigin,
      attributedOrigin: parsed.attributedOrigin,
      retracting: false,
      pageClass: parsed.pageClass,
      parsed,
    };
  };
  if (cached?.rawOutput) {
    try {
      ctx.metrics.aiCalls.inc({ provider: "understanding", result: "cache_hit" });
      const result = toClaims(cached.rawOutput);
      return {
        claims: result.claims,
        attributedToOtherOrigin: result.attributedToOtherOrigin,
        attributedOrigin: result.attributedOrigin,
        retracting: result.retracting,
        pageClass: result.pageClass,
      };
    } catch {
      return empty;
    }
  }
  const providers = await ctx.db.select().from(providerConfigs).limit(8);
  const llm = providers.find(
    (item) =>
      item.kind.includes("compatible") ||
      item.kind.includes("openai") ||
      item.kind.includes("anthropic"),
  );
  if (!llm?.secretId) {
    return empty;
  }
  const [secret] = await ctx.db
    .select()
    .from(encryptedSecrets)
    .where(eq(encryptedSecrets.id, llm.secretId))
    .limit(1);
  if (!secret) {
    return empty;
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
  try {
    const completion = await provider.completeStructured({
      model: String(settings.model ?? "gpt-4.1-mini"),
      system: prompt.system,
      user: prompt.user,
      jsonSchema: CONTENT_UNDERSTANDING_JSON_SCHEMA,
      schemaName: "content_understanding",
      timeoutMs: 30_000,
    });
    await ctx.db.insert(aiUsageEvents).values({
      ...(agentId ? { agentId } : {}),
      provider: provider.kind,
      model: String(settings.model ?? "unknown"),
      promptTokens: completion.usage?.promptTokens,
      completionTokens: completion.usage?.completionTokens,
      completionTotal:
        (completion.usage?.promptTokens ?? 0) + (completion.usage?.completionTokens ?? 0),
      latencyMs: completion.latencyMs,
      providerRequestId: completion.providerRequestId,
      cacheHit: false,
      status: "recorded",
    });
    const parsed = validateContentUnderstanding(completion.parsed, {
      evidenceId: row.id,
      content,
      allowedClaimKinds: [...CATALYST_KINDS],
      allowedSubjectIds,
    });
    ctx.metrics.aiCalls.inc({ provider: provider.kind, result: "ok" });
    await ctx.db.insert(evidenceUnderstanding).values({
      evidenceId: row.id,
      documentId: document?.id,
      cleanedContentHash: cleanedHash,
      model: String(settings.model ?? "unknown"),
      schemaVersion: CONTENT_UNDERSTANDING_SCHEMA_VERSION,
      promptHash,
      extractorVersion: EXTRACTOR_VERSION,
      summary: parsed.summary,
      rawOutput: parsed as unknown as Record<string, unknown>,
      pageClass: parsed.pageClass,
      status: "ok",
      promptTokens: completion.usage?.promptTokens,
      completionTokens: completion.usage?.completionTokens,
    });
    const result = toClaims(parsed as unknown as Record<string, unknown>);
    return {
      claims: result.claims,
      attributedToOtherOrigin: result.attributedToOtherOrigin,
      attributedOrigin: result.attributedOrigin,
      retracting: result.retracting,
      pageClass: result.pageClass,
    };
  } catch (error) {
    ctx.logger.warn({ err: error }, "content understanding failed closed");
    return empty;
  }
}
