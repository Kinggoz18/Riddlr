import type { MarketObservation } from "./domain-module.js";
import { type EvidenceRole, lineageOriginKey } from "./evidence.js";
import { takeBounded } from "./limits.js";
import type { ContentCompleteness, ReliabilityStatus, TrustTier } from "./reliability.js";
import type { SkillApplicabilityFacts, SkillDataKind } from "./skill-catalog.js";

export type MarketReaction = "unavailable" | "weak" | "strong";

export type EventFacts = {
  evidenceCount: number;
  independentHostCount: number;
  independentFamilyCount: number;
  primaryCount: number;
  derivedCount: number;
  contradictingCount: number;
  hostnames: string[];
  sourceFamilies: string[];
  assetClasses: string[];
  assetIds: string[];
  watchlistOverlap: boolean;
  portfolioOverlap: boolean;
  hasAuthoritativePrimary: boolean;
  hasTrustedFirsthand: boolean;
  independentOriginCount: number;
  independentActorCount: number;
  retractingCount?: number;
  contentCompleteness: ContentCompleteness;
  hasValidatedClaim: boolean;
  headlineMismatch?: boolean;
  reliabilityStatus?: ReliabilityStatus;
  priceChangePct?: number;
  volumeUsd?: number;
  marketCapUsd?: number;
  marketReaction: MarketReaction;
  hasLiquidityMetrics: boolean;
  hasOpenInterest: boolean;
  hasOnChainVerification: false;
  stablecoinMentioned: boolean;
  pegEvidence: boolean;
  reserveEvidence: boolean;
  regulatoryPrimary: boolean;
  regulatorySecondary: boolean;
  regulatoryTertiary: boolean;
  holderClaim: boolean;
  recycledHeadline: boolean;
  firstIndependentMention: boolean;
  oldestAgeMs?: number;
  newestAgeMs?: number;
};

const REGULATORY_PRIMARY =
  /\b(sec|cftc|doj|ofac|court filing|complaint|consent order|gazette|federal register|official statement)\b/i;
const REGULATORY_SECONDARY = /\b(reuters|bloomberg|associated press|financial times)\b/i;
const REGULATORY_TERTIARY = /\b(analysts? (say|believe|expect)|may eventually|rumou?r)\b/i;
const HOLDER_CLAIM =
  /\b(whale|large holder|large transfer|wallet (moved|sent)|otc desk|treasury wallet)\b/i;
const STABLECOIN = /\b(stablecoin|usdt|usdc|dai|depeg|tether)\b/i;
const PEG = /\b(depeg(?:ged|ging)?|lost (its )?peg|broke (the )?peg|repeg)\b/i;
const RESERVE = /\b(reserves?|attestation|backing|redemption)\b/i;

export function textOpposes(left: string, right: string): boolean {
  const pairs: Array<[RegExp, RegExp]> = [
    [/\bdepeg/, /\b(repeg|holding (the )?peg|still pegged|remains? pegged)/],
    [/\b(hack|exploit|breach)\b/, /\b(denied|false alarm|debunked|no exploit)\b/],
    [/\binsolvent\b/, /\b(solvent|fully backed|reserves intact)\b/],
  ];
  return pairs.some(
    ([first, second]) =>
      (first.test(left) && second.test(right)) || (first.test(right) && second.test(left)),
  );
}

export function observationsFromMarketPayload(
  payload: Record<string, unknown> | null | undefined,
  sourceId: string,
  observedAt: Date,
): MarketObservation[] {
  if (!payload) {
    return [];
  }
  const canonicalId = typeof payload.canonicalId === "string" ? payload.canonicalId : undefined;
  const out: MarketObservation[] = [];
  if (typeof payload.priceUsd === "number") {
    out.push({
      kind: "quoted_price",
      value: payload.priceUsd,
      unit: "usd",
      observedAt,
      sourceId,
      assetCanonicalId: canonicalId,
    });
  }
  if (typeof payload.volumeUsd === "number") {
    out.push({
      kind: "quoted_volume",
      value: payload.volumeUsd,
      unit: "usd",
      observedAt,
      sourceId,
      assetCanonicalId: canonicalId,
    });
  }
  if (typeof payload.marketCapUsd === "number") {
    out.push({
      kind: "quoted_market_cap",
      value: payload.marketCapUsd,
      unit: "usd",
      observedAt,
      sourceId,
      assetCanonicalId: canonicalId,
    });
  }
  if (typeof payload.change24h === "number") {
    out.push({
      kind: "price_change_24h",
      value: payload.change24h,
      unit: "percent",
      observedAt,
      sourceId,
      assetCanonicalId: canonicalId,
    });
  }
  return takeBounded(out, 8);
}

export function observationsFromDetectorPayload(
  payload: Record<string, unknown> | null | undefined,
  sourceId: string,
  fallbackObservedAt: Date,
): MarketObservation[] {
  if (!payload || typeof payload.detector !== "string") {
    return [];
  }
  const metric = typeof payload.metric === "string" ? payload.metric : "";
  const series = Array.isArray(payload.series) ? payload.series : [];
  const last = series.at(-1);
  if (!last || typeof last !== "object") {
    return [];
  }
  const row = last as { observedAt?: unknown; value?: unknown };
  const value = typeof row.value === "number" ? row.value : Number(row.value);
  if (!Number.isFinite(value)) {
    return [];
  }
  const observedAt =
    typeof row.observedAt === "string" || row.observedAt instanceof Date
      ? new Date(row.observedAt)
      : fallbackObservedAt;
  if (Number.isNaN(observedAt.getTime())) {
    return [];
  }
  const kind =
    metric === "spot_price"
      ? "quoted_price"
      : metric === "quoted_volume"
        ? "quoted_volume"
        : metric;
  if (!kind) {
    return [];
  }
  const assetCanonicalId =
    typeof payload.subjectCanonicalId === "string" ? payload.subjectCanonicalId : undefined;
  return [
    {
      kind,
      value,
      unit: typeof payload.unit === "string" ? payload.unit : "usd",
      observedAt,
      sourceId,
      assetCanonicalId,
    },
  ];
}

export function buildEventFacts(input: {
  evidence: Array<{
    hostname?: string;
    sourceFamily?: string;
    text: string;
    publishedAt?: Date;
    role: EvidenceRole;
    adapterPayload?: Record<string, unknown> | null;
    originKey?: string;
    actorKey?: string;
    outboundUrls?: string[];
    attributedOrigin?: string;
    referencedOriginKey?: string;
    trustTier?: TrustTier;
    contentCompleteness?: ContentCompleteness;
    hasValidatedClaim?: boolean;
    headlineMismatch?: boolean;
    retracting?: boolean;
  }>;
  assets: Array<{ assetClass: string; canonicalId: string }>;
  observations: MarketObservation[];
  watchlistOverlap: boolean;
  portfolioOverlap: boolean;
  now?: Date;
}): EventFacts {
  const now = input.now ?? new Date();
  const hostnames = [
    ...new Set(
      input.evidence.map((item) => item.hostname).filter((item): item is string => Boolean(item)),
    ),
  ];
  const families = [
    ...new Set(
      input.evidence
        .map((item) => item.sourceFamily)
        .filter((item): item is string => Boolean(item)),
    ),
  ];
  const independent = input.evidence.filter(
    (item) =>
      (item.role === "primary" || item.role === "supporting") &&
      item.sourceFamily !== "market_data",
  );
  const independentHosts = new Set(independent.map((item) => item.hostname ?? "unknown-host"));
  const independentOrigins = new Set(
    independent.map((item) =>
      lineageOriginKey({
        originKey: item.originKey,
        referencedOriginKey: item.referencedOriginKey,
        outboundUrls: item.outboundUrls,
        attributedOrigin: item.attributedOrigin,
        hostname: item.hostname,
      }),
    ),
  );
  const actorKeys = new Set(
    independent.map((item) => item.actorKey).filter((item): item is string => Boolean(item)),
  );
  const completeness: ContentCompleteness = input.evidence.some(
    (item) =>
      item.contentCompleteness === "full_document" ||
      item.contentCompleteness === "native_complete",
  )
    ? input.evidence.some((item) => item.contentCompleteness === "full_document")
      ? "full_document"
      : "native_complete"
    : (input.evidence[0]?.contentCompleteness ?? "native_complete");
  const hasValidatedClaim = input.evidence.some((item) => item.hasValidatedClaim);
  const headlineMismatch = input.evidence.some((item) => item.headlineMismatch);
  const retractingCount = input.evidence.filter((item) => item.retracting).length;
  const hasTrustedFirsthand = independent.some((item) => item.trustTier === "official_firsthand");
  const text = input.evidence.map((item) => item.text).join("\n");
  const change = numberObservation(input.observations, "price_change_24h");
  const volume = numberObservation(input.observations, "quoted_volume");
  const marketCap = numberObservation(input.observations, "quoted_market_cap");
  const ages = input.evidence
    .map((item) => item.publishedAt)
    .filter((item): item is Date => Boolean(item))
    .map((item) => now.getTime() - item.getTime());
  const derived = input.evidence.filter((item) => item.role === "derived").length;
  const primary = input.evidence.filter((item) => item.role === "primary").length;
  const firstIndependentMention = primary === 1 && derived === 0 && independentHosts.size === 1;
  return {
    evidenceCount: input.evidence.length,
    independentHostCount: independentHosts.size,
    independentOriginCount: independentOrigins.size || independentHosts.size,
    independentActorCount: actorKeys.size,
    independentFamilyCount: new Set(independent.map((item) => item.sourceFamily ?? "unknown")).size,
    primaryCount: primary,
    derivedCount: derived,
    contradictingCount: input.evidence.filter((item) => item.role === "contradicting").length,
    retractingCount,
    headlineMismatch,
    hostnames,
    sourceFamilies: families,
    assetClasses: [...new Set(input.assets.map((item) => item.assetClass))],
    assetIds: input.assets.map((item) => item.canonicalId),
    watchlistOverlap: input.watchlistOverlap,
    portfolioOverlap: input.portfolioOverlap,
    hasAuthoritativePrimary: hasTrustedFirsthand,
    hasTrustedFirsthand,
    contentCompleteness: completeness,
    hasValidatedClaim,
    priceChangePct: change,
    volumeUsd: volume,
    marketCapUsd: marketCap,
    marketReaction: marketReaction(change, volume !== undefined),
    hasLiquidityMetrics: volume !== undefined,
    hasOpenInterest: input.observations.some((item) => item.kind === "open_interest_mentioned"),
    hasOnChainVerification: false,
    stablecoinMentioned:
      STABLECOIN.test(text) || input.assets.some((item) => item.assetClass === "stablecoin"),
    pegEvidence: PEG.test(text),
    reserveEvidence: RESERVE.test(text),
    regulatoryPrimary: REGULATORY_PRIMARY.test(text),
    regulatorySecondary: REGULATORY_SECONDARY.test(text),
    regulatoryTertiary: REGULATORY_TERTIARY.test(text),
    holderClaim: HOLDER_CLAIM.test(text),
    recycledHeadline: derived > 0 && primary <= 1 && independentHosts.size <= 1,
    firstIndependentMention,
    oldestAgeMs: ages.length > 0 ? Math.max(...ages) : undefined,
    newestAgeMs: ages.length > 0 ? Math.min(...ages) : undefined,
  };
}

function numberObservation(observations: MarketObservation[], kind: string): number | undefined {
  const row = observations.find((item) => item.kind === kind && typeof item.value === "number");
  return typeof row?.value === "number" ? row.value : undefined;
}

function marketReaction(changePct: number | undefined, hasVolume: boolean): MarketReaction {
  if (changePct === undefined && !hasVolume) {
    return "unavailable";
  }
  if (changePct === undefined) {
    return "unavailable";
  }
  if (Math.abs(changePct) >= 3) {
    return "strong";
  }
  if (Math.abs(changePct) < 1) {
    return "weak";
  }
  return "weak";
}

export function factsToApplicability(facts: EventFacts): SkillApplicabilityFacts {
  const newsOrSocial = facts.sourceFamilies.some(
    (family) => family === "search" || family === "x" || family === "discord",
  );
  const present: Partial<Record<SkillDataKind, boolean>> = {
    independent_evidence: facts.evidenceCount > 0,
    news_or_social: newsOrSocial,
    market_quotes: facts.priceChangePct !== undefined || facts.volumeUsd !== undefined,
    liquidity_metrics: facts.hasLiquidityMetrics,
    stablecoin_exposure: facts.stablecoinMentioned,
    regulatory_claims:
      facts.regulatoryPrimary || facts.regulatorySecondary || facts.regulatoryTertiary,
    holder_claims: facts.holderClaim,
  };
  return { present };
}

export function formatAnalysisFacts(facts: EventFacts): string[] {
  return [
    `Independent origins: ${facts.independentOriginCount}`,
    `Content completeness: ${facts.contentCompleteness}`,
    `Validated claim: ${facts.hasValidatedClaim ? "yes" : "none"}`,
    `Trusted firsthand: ${facts.hasTrustedFirsthand ? "yes" : "no"}`,
    `Primary evidence: ${facts.primaryCount}`,
    `Derived reprints: ${facts.derivedCount}`,
    `Contradicting evidence: ${facts.contradictingCount}`,
    `Watchlist overlap: ${facts.watchlistOverlap ? "yes" : "none"}`,
    `Portfolio overlap: ${facts.portfolioOverlap ? "yes" : "none"}`,
    `Price change 24h: ${facts.priceChangePct === undefined ? "unavailable" : `${facts.priceChangePct}%`}`,
    `Volume: ${facts.volumeUsd === undefined ? "unavailable" : `USD ${facts.volumeUsd}`}`,
    `Market cap: ${facts.marketCapUsd === undefined ? "unavailable" : `USD ${facts.marketCapUsd}`}`,
    `Open interest: ${facts.hasOpenInterest ? "mentioned in sourced text" : "unavailable"}`,
    `Liquidity depth / spread: unavailable`,
    `Market reaction: ${facts.marketReaction}`,
    `On-chain wallet flows: unavailable (native on-chain scanning is not implemented)`,
    `Peg evidence in text: ${facts.pegEvidence ? "present" : "none"}`,
    `Reserve evidence in text: ${facts.reserveEvidence ? "present" : "none"}`,
    `Regulatory hierarchy: ${
      facts.regulatoryPrimary
        ? "primary"
        : facts.regulatorySecondary
          ? "secondary"
          : facts.regulatoryTertiary
            ? "tertiary"
            : "none"
    }`,
    `Reported large-holder activity: ${facts.holderClaim ? "reported, not chain-verified" : "none"}`,
    `Recycled headline: ${facts.recycledHeadline ? "yes" : "no"}`,
    `First independent mention: ${facts.firstIndependentMention ? "possible" : "no"}`,
  ];
}

export function estimatePromptTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4);
}
