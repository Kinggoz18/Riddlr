export const CONTENT_COMPLETENESS = [
  "snippet",
  "full_document",
  "native_complete",
  "incomplete",
  "unsupported",
] as const;
export type ContentCompleteness = (typeof CONTENT_COMPLETENESS)[number];

export const TRUST_TIERS = [
  "unknown",
  "community",
  "known_analyst",
  "official_firsthand",
  "blocked",
] as const;
export type TrustTier = (typeof TRUST_TIERS)[number];

export const TRUST_USES = ["discovery", "analysis", "early_warning", "confirmation"] as const;
export type TrustUse = (typeof TRUST_USES)[number];

export const RELIABILITY_STATUSES = [
  "mention",
  "single_source",
  "corroborated",
  "primary_confirmed",
  "disputed",
  "retracted",
  "legacy_unassessed",
] as const;
export type ReliabilityStatus = (typeof RELIABILITY_STATUSES)[number];

export const IMPACT_LEVELS = ["informational", "low", "moderate", "high", "critical"] as const;
export type ImpactLevel = (typeof IMPACT_LEVELS)[number];

export const PAGE_CLASSES = [
  "news_report",
  "official_statement",
  "market_profile",
  "opinion",
  "promotion",
  "documentation",
  "social_post",
  "unknown",
] as const;
export type PageClass = (typeof PAGE_CLASSES)[number];

export const CLAIM_POLARITIES = ["asserted", "negated"] as const;
export type ClaimPolarity = (typeof CLAIM_POLARITIES)[number];

export const CLAIM_MODALITIES = ["asserted", "alleged", "forecast", "denied"] as const;
export type ClaimModality = (typeof CLAIM_MODALITIES)[number];

export const CLAIM_STANCES = [
  "supports",
  "contradicts",
  "retracts",
  "updates",
  "quotes",
  "derived_from",
] as const;
export type ClaimStance = (typeof CLAIM_STANCES)[number];

export const SIGNAL_OUTPUT_KINDS = ["signal", "unverified_early_warning"] as const;
export type SignalOutputKind = (typeof SIGNAL_OUTPUT_KINDS)[number];

export const NOTIFY_KINDS = [
  "signal",
  "early_warning",
  "confirmation",
  "dispute",
  "retraction",
] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

export type SourceIdentityCandidate = {
  platform: string;
  externalId: string;
  displayName?: string;
  hostname?: string;
  parentExternalId?: string;
  verifiedBadge?: boolean;
};

export type ImpactAssessment = {
  level: ImpactLevel;
  reason: string;
  reasonCodes: string[];
};

export function originKey(input: {
  platform: string;
  externalId?: string;
  hostname?: string;
  referencedOriginKey?: string;
}): string {
  if (input.referencedOriginKey) {
    return input.referencedOriginKey;
  }
  if (input.externalId) {
    return `${input.platform}:${input.externalId}`;
  }
  if (input.hostname) {
    return `host:${input.hostname.toLowerCase()}`;
  }
  return `${input.platform}:unknown`;
}

export function uniqueKeys(values: Array<string | undefined>): number {
  return new Set(values.filter((item): item is string => Boolean(item && item.length > 0))).size;
}

export function capConfidence(status: ReliabilityStatus, confidence: number): number {
  const ceiling =
    status === "corroborated"
      ? 1
      : status === "primary_confirmed"
        ? 0.55
        : status === "single_source"
          ? 0.5
          : status === "disputed"
            ? 0.4
            : 0.3;
  const bounded = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
  return Math.min(bounded, ceiling);
}

export function assessReliability(input: {
  contentCompleteness: ContentCompleteness;
  independentOriginCount: number;
  supportingCount: number;
  contradictingCount: number;
  retractingCount: number;
  hasTrustedFirsthand: boolean;
  hasValidatedClaim: boolean;
  headlineMismatch?: boolean;
}): { status: ReliabilityStatus; reason: string } {
  if (input.retractingCount > 0 && input.supportingCount === 0) {
    return { status: "retracted", reason: "origin_retracted" };
  }
  if (input.contradictingCount > 0 && input.supportingCount > 0) {
    return { status: "disputed", reason: "support_and_contradiction" };
  }
  if (!input.hasValidatedClaim || input.contentCompleteness === "snippet") {
    return { status: "mention", reason: "incomplete_or_unclaimed" };
  }
  if (input.contentCompleteness === "incomplete" || input.contentCompleteness === "unsupported") {
    return { status: "mention", reason: "incomplete_content" };
  }
  if (input.headlineMismatch && input.independentOriginCount < 2) {
    return { status: "mention", reason: "headline_body_mismatch" };
  }
  if (input.independentOriginCount >= 2) {
    return { status: "corroborated", reason: "independent_origins" };
  }
  if (input.hasTrustedFirsthand) {
    return { status: "primary_confirmed", reason: "trusted_firsthand" };
  }
  if (input.independentOriginCount === 1) {
    return { status: "single_source", reason: "single_complete_source" };
  }
  return { status: "mention", reason: "below_reliability" };
}
