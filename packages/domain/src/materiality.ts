import type { ContentCompleteness } from "./reliability.js";

export type MaterialityInput = {
  independentHostCount: number;
  independentFamilyCount: number;
  independentOriginCount?: number;
  evidenceCount: number;
  derivedCount: number;
  watchlistOverlap: boolean;
  portfolioOverlap: boolean;
  sourcedObservationCount: number;
  hasAuthoritativePrimary: boolean;
  hasTrustedFirsthand?: boolean;
  contentCompleteness?: ContentCompleteness;
  hasValidatedClaim?: boolean;
  observedAnomaly?: boolean;
  communitySocialOnly?: boolean;
};

export type MaterialityDecision = {
  material: boolean;
  reason: string;
};

function complete(input: MaterialityInput): boolean {
  if (!input.contentCompleteness) {
    return true;
  }
  return (
    input.contentCompleteness === "full_document" || input.contentCompleteness === "native_complete"
  );
}

export function isMaterialEvent(input: MaterialityInput): MaterialityDecision {
  if (input.evidenceCount <= 0) {
    return { material: false, reason: "no_evidence" };
  }
  if (input.derivedCount >= input.evidenceCount) {
    return { material: false, reason: "reprint_only" };
  }
  const origins = input.independentOriginCount ?? input.independentHostCount;
  if (
    !input.communitySocialOnly &&
    origins >= 2 &&
    complete(input) &&
    input.hasValidatedClaim !== false
  ) {
    return { material: true, reason: "independent_origins" };
  }
  if ((input.hasTrustedFirsthand || input.hasAuthoritativePrimary) && complete(input)) {
    return { material: true, reason: "early_warning_candidate" };
  }
  if (
    input.watchlistOverlap &&
    input.observedAnomaly &&
    complete(input) &&
    input.hasValidatedClaim
  ) {
    return { material: true, reason: "observed_anomaly" };
  }
  if (input.watchlistOverlap && input.sourcedObservationCount > 0 && complete(input)) {
    if (input.hasValidatedClaim) {
      return { material: true, reason: "watchlist_observation" };
    }
  }
  if (
    !input.communitySocialOnly &&
    input.portfolioOverlap &&
    input.independentFamilyCount >= 1 &&
    origins >= 1 &&
    complete(input)
  ) {
    return { material: true, reason: "portfolio_overlap" };
  }
  return { material: false, reason: "below_threshold" };
}

export function isMaterial(input: {
  independentSourceCount: number;
  evidenceCount: number;
}): boolean {
  return isMaterialEvent({
    independentHostCount: input.independentSourceCount,
    independentFamilyCount: input.independentSourceCount,
    independentOriginCount: input.independentSourceCount,
    evidenceCount: input.evidenceCount,
    derivedCount: 0,
    watchlistOverlap: false,
    portfolioOverlap: false,
    sourcedObservationCount: 0,
    hasAuthoritativePrimary: false,
    contentCompleteness: "full_document",
    hasValidatedClaim: true,
  }).material;
}
