import { describe, expect, it } from "vitest";
import { isMaterial, isMaterialEvent } from "./materiality.js";

describe("materiality", () => {
  it("rejects empty, reprint-only, and single-host clusters without an exception", () => {
    expect(
      isMaterialEvent({
        independentHostCount: 0,
        independentFamilyCount: 0,
        evidenceCount: 4,
        derivedCount: 0,
        watchlistOverlap: false,
        portfolioOverlap: false,
        sourcedObservationCount: 0,
        hasAuthoritativePrimary: false,
      }).material,
    ).toBe(false);
    expect(
      isMaterialEvent({
        independentHostCount: 1,
        independentFamilyCount: 1,
        evidenceCount: 3,
        derivedCount: 3,
        watchlistOverlap: false,
        portfolioOverlap: false,
        sourcedObservationCount: 0,
        hasAuthoritativePrimary: false,
      }).reason,
    ).toBe("reprint_only");
    expect(
      isMaterialEvent({
        independentHostCount: 1,
        independentFamilyCount: 1,
        evidenceCount: 2,
        derivedCount: 0,
        watchlistOverlap: false,
        portfolioOverlap: false,
        sourcedObservationCount: 0,
        hasAuthoritativePrimary: false,
      }).material,
    ).toBe(false);
  });

  it("accepts independent hosts, authoritative primaries, and scoped watchlist observations", () => {
    expect(
      isMaterialEvent({
        independentHostCount: 2,
        independentFamilyCount: 2,
        evidenceCount: 2,
        derivedCount: 0,
        watchlistOverlap: false,
        portfolioOverlap: false,
        sourcedObservationCount: 0,
        hasAuthoritativePrimary: false,
      }).reason,
    ).toBe("independent_origins");
    expect(
      isMaterialEvent({
        independentHostCount: 1,
        independentFamilyCount: 1,
        evidenceCount: 1,
        derivedCount: 0,
        watchlistOverlap: false,
        portfolioOverlap: false,
        sourcedObservationCount: 0,
        hasAuthoritativePrimary: true,
      }).reason,
    ).toBe("early_warning_candidate");
    expect(
      isMaterialEvent({
        independentHostCount: 1,
        independentFamilyCount: 1,
        evidenceCount: 1,
        derivedCount: 0,
        watchlistOverlap: true,
        portfolioOverlap: false,
        sourcedObservationCount: 1,
        hasAuthoritativePrimary: false,
        contentCompleteness: "full_document",
        hasValidatedClaim: true,
      }).reason,
    ).toBe("watchlist_observation");
    expect(
      isMaterialEvent({
        independentHostCount: 1,
        independentFamilyCount: 1,
        evidenceCount: 1,
        derivedCount: 0,
        watchlistOverlap: true,
        portfolioOverlap: false,
        sourcedObservationCount: 1,
        hasAuthoritativePrimary: false,
        contentCompleteness: "full_document",
        hasValidatedClaim: false,
      }).material,
    ).toBe(false);
    expect(
      isMaterialEvent({
        independentHostCount: 2,
        independentFamilyCount: 1,
        independentOriginCount: 2,
        evidenceCount: 2,
        derivedCount: 0,
        watchlistOverlap: false,
        portfolioOverlap: false,
        sourcedObservationCount: 0,
        hasAuthoritativePrimary: false,
        communitySocialOnly: true,
      }).material,
    ).toBe(false);
    expect(
      isMaterialEvent({
        independentHostCount: 1,
        independentFamilyCount: 1,
        evidenceCount: 1,
        derivedCount: 0,
        watchlistOverlap: false,
        portfolioOverlap: false,
        sourcedObservationCount: 0,
        hasAuthoritativePrimary: true,
        hasTrustedFirsthand: false,
        communitySocialOnly: false,
      }).reason,
    ).toBe("early_warning_candidate");
    expect(isMaterial({ independentSourceCount: 0, evidenceCount: 4 })).toBe(false);
  });

  it("accepts a watched detector claim as an observed anomaly without sourced quotes", () => {
    expect(
      isMaterialEvent({
        independentHostCount: 1,
        independentFamilyCount: 1,
        evidenceCount: 1,
        derivedCount: 0,
        watchlistOverlap: true,
        portfolioOverlap: false,
        sourcedObservationCount: 0,
        hasAuthoritativePrimary: false,
        contentCompleteness: "native_complete",
        hasValidatedClaim: true,
        observedAnomaly: true,
      }).reason,
    ).toBe("observed_anomaly");
    expect(
      isMaterialEvent({
        independentHostCount: 1,
        independentFamilyCount: 1,
        evidenceCount: 1,
        derivedCount: 0,
        watchlistOverlap: false,
        portfolioOverlap: false,
        sourcedObservationCount: 0,
        hasAuthoritativePrimary: false,
        contentCompleteness: "native_complete",
        hasValidatedClaim: true,
        observedAnomaly: true,
      }).material,
    ).toBe(false);
  });
});
