import { describe, expect, it } from "vitest";
import { buildEventFacts } from "./analysis-facts.js";
import { discoverCandidate, formatDiscoveryNotes, nextEventStatus } from "./discovery.js";
import type { MaterialityDecision } from "./materiality.js";

const OBJECTIVES = [
  "general_crypto_intelligence",
  "emerging_narratives",
  "hidden_gems",
  "unusual_market_behaviour",
  "potential_opportunities",
  "risk_signals",
  "asset_specific_changes",
];

function facts(
  input: Parameters<typeof buildEventFacts>[0] | Parameters<typeof buildEventFacts>[0]["evidence"],
) {
  if (Array.isArray(input)) {
    return buildEventFacts({
      evidence: input,
      assets: [],
      observations: [],
      watchlistOverlap: false,
      portfolioOverlap: false,
      now: new Date("2026-09-11T00:00:00Z"),
    });
  }
  return buildEventFacts(input);
}

function belowThreshold(): MaterialityDecision {
  return { material: false, reason: "below_threshold" };
}

describe("discovery candidates", () => {
  it("treats a first independent mention without a claim as a search mention", () => {
    const event = facts([
      {
        hostname: "x.com",
        sourceFamily: "x",
        text: "first independent mention of a new meme rotation",
        role: "primary",
      },
    ]);
    const discovery = discoverCandidate({
      facts: event,
      objectives: OBJECTIVES,
      text: "first independent mention of a new meme rotation",
      material: belowThreshold(),
    });
    expect(discovery.candidate).toBe(true);
    expect(discovery.kind).toBe("search_mention");
    expect(discovery.epistemicStatus).toBe("discovered");
    expect(nextEventStatus({ evidenceCount: 1, discovery, material: belowThreshold() })).toBe(
      "candidate",
    );
    expect(discovery.reason.toLowerCase()).toContain("not a recommendation to buy, sell, or trade");
  });

  it("classifies two reputable-press snippets on a watched asset as a corroborated headline, not a signal", () => {
    const event = facts({
      evidence: [
        {
          hostname: "www.reuters.com",
          sourceFamily: "search",
          text: "US Senate fails to advance sweeping cryptocurrency bill",
          role: "primary",
          contentCompleteness: "snippet",
          trustTier: "reputable_press",
        },
        {
          hostname: "www.coindesk.com",
          sourceFamily: "search",
          text: "Clarity Act odds plunge amid failed Senate procedural vote",
          role: "primary",
          contentCompleteness: "snippet",
          trustTier: "reputable_press",
        },
      ],
      assets: [{ assetClass: "cryptocurrency", canonicalId: "coingecko:bitcoin" }],
      observations: [],
      watchlistOverlap: true,
      portfolioOverlap: false,
    });
    expect(event.reputablePressOriginCount).toBe(2);
    expect(event.contentCompleteness).toBe("snippet");
    const discovery = discoverCandidate({
      facts: event,
      objectives: OBJECTIVES,
      text: "Clarity Act fails Senate vote",
      material: belowThreshold(),
    });
    expect(discovery.candidate).toBe(true);
    expect(discovery.kind).toBe("corroborated_headline");
    expect(discovery.epistemicStatus).not.toBe("signal");
    expect(nextEventStatus({ evidenceCount: 2, discovery, material: belowThreshold() })).toBe(
      "candidate",
    );
    expect(
      nextEventStatus({
        evidenceCount: 2,
        discovery,
        material: { material: true, reason: "independent_origins" },
      }),
    ).toBe("candidate");
  });

  it("classifies a watchlist price move as unusual market behaviour, observed not signal", () => {
    const event = facts({
      evidence: [
        {
          hostname: "coingecko.com",
          sourceFamily: "market",
          text: "BTC 24h change sourced from the market adapter",
          role: "primary",
        },
      ],
      assets: [{ assetClass: "cryptocurrency", canonicalId: "coingecko:bitcoin" }],
      observations: [
        {
          kind: "price_change_24h",
          value: 7.4,
          unit: "percent",
          observedAt: new Date(),
          sourceId: "coingecko",
        },
      ],
      watchlistOverlap: true,
      portfolioOverlap: false,
    });
    const discovery = discoverCandidate({
      facts: event,
      objectives: OBJECTIVES,
      text: "BTC 24h change sourced from the market adapter",
      material: { material: true, reason: "watchlist_observation" },
    });
    expect(discovery.candidate).toBe(true);
    expect(discovery.kind).toBe("unusual_market_behaviour");
    expect(discovery.epistemicStatus).toBe("observed");
    expect(discovery.epistemicStatus).not.toBe("signal");
    expect(
      nextEventStatus({
        evidenceCount: 1,
        discovery,
        material: { material: true, reason: "watchlist_observation" },
      }),
    ).toBe("needs_analysis");
  });

  it("marks independent hosts as confirmed, not inferred", () => {
    const event = facts([
      {
        hostname: "reuters.com",
        sourceFamily: "search",
        text: "exchange is insolvent after a filing",
        role: "primary",
      },
      {
        hostname: "coindesk.com",
        sourceFamily: "search",
        text: "second independent host reports the filing",
        role: "primary",
      },
    ]);
    const discovery = discoverCandidate({
      facts: event,
      objectives: OBJECTIVES,
      text: "exchange is insolvent after a filing",
      material: { material: true, reason: "independent_hosts" },
    });
    expect(discovery.epistemicStatus).toBe("confirmed");
    expect(discovery.kind).toBe("risk");
    expect(discovery.epistemicStatus).not.toBe("inferred");
  });

  it("does not treat reprint-only clusters as candidates", () => {
    const event = facts([
      {
        hostname: "blog.example",
        sourceFamily: "search",
        text: "copy of reuters",
        role: "derived",
      },
      {
        hostname: "mirror.example",
        sourceFamily: "search",
        text: "another copy",
        role: "derived",
      },
    ]);
    const material: MaterialityDecision = { material: false, reason: "reprint_only" };
    const discovery = discoverCandidate({
      facts: event,
      objectives: OBJECTIVES,
      text: "copy of reuters",
      material,
    });
    expect(discovery.candidate).toBe(false);
    expect(discovery.kind).toBeNull();
    expect(nextEventStatus({ evidenceCount: 2, discovery, material })).toBe("immaterial");
  });

  it("never describes an opportunity as a trade", () => {
    const event = facts([
      {
        hostname: "news.example",
        sourceFamily: "search",
        text: "an obscure token is seeing isolated attention",
        role: "primary",
      },
    ]);
    const discovery = discoverCandidate({
      facts: event,
      objectives: ["potential_opportunities"],
      text: "an obscure token is seeing isolated attention",
      material: belowThreshold(),
    });
    const notes = formatDiscoveryNotes(discovery).join("\n").toLowerCase();
    expect(discovery.candidate).toBe(true);
    expect(notes).toContain("further investigation");
    expect(notes).toContain("not a recommendation to buy, sell, or trade");
    expect(notes).not.toMatch(/\b(buy now|sell now|enter a (long|short)|place an order)\b/);
  });

  it("classifies a detector finding as an observed anomaly, not a search mention", () => {
    const event = facts({
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
    const discovery = discoverCandidate({
      facts: event,
      objectives: OBJECTIVES,
      text: "return_shock.v1 on coingecko:bitcoin",
      material: { material: true, reason: "observed_anomaly" },
    });
    expect(discovery.candidate).toBe(true);
    expect(discovery.kind).toBe("anomaly");
    expect(discovery.epistemicStatus).toBe("observed");
    expect(discovery.epistemicStatus).not.toBe("signal");
    expect(
      nextEventStatus({
        evidenceCount: 1,
        discovery,
        material: { material: true, reason: "observed_anomaly" },
      }),
    ).toBe("needs_analysis");
  });
});
