import type { ContentCompleteness, TrustTier } from "./reliability.js";

export const HEADLINE_PRESS_TIERS: readonly TrustTier[] = ["reputable_press", "official_firsthand"];

export function isHeadlinePressTier(tier: string | undefined): boolean {
  return HEADLINE_PRESS_TIERS.includes(tier as TrustTier);
}

export function isCorroboratedHeadline(input: {
  watchlistOverlap: boolean;
  independentOriginCount: number;
  reputablePressOriginCount: number;
  contentCompleteness: ContentCompleteness;
  hasValidatedClaim: boolean;
  sourceFamilies: readonly string[];
}): boolean {
  if (!input.watchlistOverlap || input.hasValidatedClaim) {
    return false;
  }
  if (input.independentOriginCount < 2 || input.reputablePressOriginCount < 2) {
    return false;
  }
  if (input.contentCompleteness !== "snippet" && input.contentCompleteness !== "incomplete") {
    return false;
  }
  return input.sourceFamilies.some((family) => family === "search" || family === "feed");
}
