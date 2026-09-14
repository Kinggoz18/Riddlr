import { describe, expect, it } from "vitest";
import { buildEventFacts } from "./analysis-facts.js";
import { decideSignalGate } from "./signal-gate.js";

function corroboratedFacts() {
  return buildEventFacts({
    evidence: [
      {
        hostname: "a.example",
        sourceFamily: "search",
        text: "one",
        role: "primary",
        hasValidatedClaim: true,
        contentCompleteness: "full_document",
      },
      {
        hostname: "b.example",
        sourceFamily: "search",
        text: "two",
        role: "primary",
        hasValidatedClaim: true,
        contentCompleteness: "full_document",
      },
    ],
    assets: [{ assetClass: "cryptocurrency", canonicalId: "coingecko:bitcoin" }],
    observations: [],
    watchlistOverlap: true,
    portfolioOverlap: false,
  });
}

describe("signal gate confirmation and shadow", () => {
  it("emits confirmation when a firsthand or single-source event becomes corroborated", () => {
    const gate = decideSignalGate({
      facts: corroboratedFacts(),
      risk: "moderate",
      confidence: 0.7,
      material: { material: true, reason: "independent_origins" },
      reliability: "corroborated",
      impact: "moderate",
      previousReliability: "single_source",
    });
    expect(gate.notifyKind).toBe("confirmation");
    expect(gate.notifyEligible).toBe(true);
  });

  it("does not notify unknown social mentions", () => {
    const facts = buildEventFacts({
      evidence: [
        {
          hostname: "x.com",
          sourceFamily: "x",
          text: "rumor",
          role: "primary",
          contentCompleteness: "native_complete",
        },
      ],
      assets: [],
      observations: [],
      watchlistOverlap: false,
      portfolioOverlap: false,
    });
    const gate = decideSignalGate({
      facts,
      risk: "high",
      confidence: 0.9,
      material: { material: true, reason: "independent_origins" },
      reliability: "mention",
      impact: "high",
    });
    expect(gate.persist).toBe(false);
    expect(gate.notifyEligible).toBe(false);
  });

  it("holds notifications in shadow assessments", () => {
    const gate = decideSignalGate({
      facts: corroboratedFacts(),
      risk: "high",
      confidence: 0.8,
      material: { material: true, reason: "independent_origins" },
      reliability: "corroborated",
      impact: "high",
      shadowAssessments: true,
    });
    expect(gate.persist).toBe(true);
    expect(gate.notifyEligible).toBe(false);
  });

  it("persists typed perp stress as an observed early warning, not a fundamental signal", () => {
    const facts = buildEventFacts({
      evidence: [
        {
          hostname: "unknown-host",
          sourceFamily: "observation",
          text: "market_stress.v1 on coingecko:bitcoin: funding z=4 over 20 samples.",
          role: "primary",
          contentCompleteness: "native_complete",
          hasValidatedClaim: true,
        },
      ],
      assets: [{ assetClass: "cryptocurrency", canonicalId: "coingecko:bitcoin" }],
      observations: [],
      watchlistOverlap: true,
      portfolioOverlap: false,
    });
    const gate = decideSignalGate({
      facts,
      risk: "high",
      confidence: 0.9,
      material: { material: true, reason: "observed_anomaly" },
      reliability: "observed",
      impact: "informational",
      earlyWarningsEnabled: true,
      typed: {
        typedSignalId: "perp_stress",
        persist: true,
        outputKind: "unverified_early_warning",
        anticipated: false,
        notifyAsEarlyWarning: true,
        allowValidatedNotify: false,
        reason: "perp_stress_detector",
        epistemicStatus: "observed",
      },
    });
    expect(gate.persist).toBe(true);
    expect(gate.outputKind).toBe("unverified_early_warning");
    expect(gate.notifyKind).toBe("early_warning");
    expect(gate.epistemicStatus).toBe("observed");
    expect(gate.typedSignalId).toBe("perp_stress");
  });

  it("does not persist a detector observation as a signal", () => {
    const facts = buildEventFacts({
      evidence: [
        {
          hostname: "unknown-host",
          sourceFamily: "observation",
          text: "return_shock.v1 on coingecko:bitcoin: z=4.25 over 20 spot_price samples (threshold 3).",
          role: "primary",
          contentCompleteness: "native_complete",
          hasValidatedClaim: true,
        },
      ],
      assets: [{ assetClass: "cryptocurrency", canonicalId: "coingecko:bitcoin" }],
      observations: [],
      watchlistOverlap: true,
      portfolioOverlap: false,
    });
    const gate = decideSignalGate({
      facts,
      risk: "moderate",
      confidence: 0.9,
      material: { material: true, reason: "observed_anomaly" },
      reliability: "observed",
      impact: "moderate",
    });
    expect(gate.persist).toBe(false);
    expect(gate.notifyEligible).toBe(false);
    expect(gate.reason).toBe("observed_fact_not_signal");
  });
});
