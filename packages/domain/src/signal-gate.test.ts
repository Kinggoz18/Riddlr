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
});
