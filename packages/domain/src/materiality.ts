export type MaterialityInput = {
  independentHostCount: number;
  independentFamilyCount: number;
  evidenceCount: number;
  derivedCount: number;
  watchlistOverlap: boolean;
  portfolioOverlap: boolean;
  sourcedObservationCount: number;
  hasAuthoritativePrimary: boolean;
};

export type MaterialityDecision = {
  material: boolean;
  reason: string;
};

export function isMaterialEvent(input: MaterialityInput): MaterialityDecision {
  if (input.evidenceCount <= 0) {
    return { material: false, reason: "no_evidence" };
  }
  if (input.derivedCount >= input.evidenceCount) {
    return { material: false, reason: "reprint_only" };
  }
  if (input.independentHostCount >= 2) {
    return { material: true, reason: "independent_hosts" };
  }
  if (input.hasAuthoritativePrimary && input.independentHostCount >= 1) {
    return { material: true, reason: "authoritative_primary" };
  }
  if (input.watchlistOverlap && input.sourcedObservationCount > 0) {
    return { material: true, reason: "watchlist_observation" };
  }
  if (
    input.portfolioOverlap &&
    input.independentFamilyCount >= 1 &&
    input.independentHostCount >= 1
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
    evidenceCount: input.evidenceCount,
    derivedCount: 0,
    watchlistOverlap: false,
    portfolioOverlap: false,
    sourcedObservationCount: 0,
    hasAuthoritativePrimary: false,
  }).material;
}
