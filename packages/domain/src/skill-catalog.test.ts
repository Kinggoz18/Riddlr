import { describe, expect, it } from "vitest";
import {
  buildEventFacts,
  estimatePromptTokens,
  factsToApplicability,
  observationsFromMarketPayload,
  textOpposes,
} from "./analysis-facts.js";
import { decideSignalGate } from "./signal-gate.js";
import {
  SHIPPED_CRYPTO_SKILL_SLUGS,
  SHIPPED_CRYPTO_SKILLS,
  selectApplicableSkills,
  skillOperatorCopy,
} from "./skill-catalog.js";

const ALL_ATTACHED = SHIPPED_CRYPTO_SKILL_SLUGS.map((slug) => ({ slug }));

function facts(
  partial:
    | Parameters<typeof buildEventFacts>[0]["evidence"][number][]
    | Parameters<typeof buildEventFacts>[0],
) {
  if (Array.isArray(partial)) {
    return buildEventFacts({
      evidence: partial,
      assets: [],
      observations: [],
      watchlistOverlap: false,
      portfolioOverlap: false,
      now: new Date("2026-09-11T00:00:00Z"),
    });
  }
  return buildEventFacts(partial);
}

describe("shipped crypto skill catalog", () => {
  it("defines fourteen shipped capabilities including the whale-activity slug", () => {
    expect(SHIPPED_CRYPTO_SKILL_SLUGS).toHaveLength(14);
    expect(SHIPPED_CRYPTO_SKILL_SLUGS).toContain("whale-activity");
    expect(SHIPPED_CRYPTO_SKILL_SLUGS).toContain("candidate-discovery");
    expect(SHIPPED_CRYPTO_SKILL_SLUGS).not.toContain("large-holder-activity");
    expect(SHIPPED_CRYPTO_SKILLS.every((item) => item.description.length > 12)).toBe(true);
    expect(skillOperatorCopy({ slug: "narrative-detection" }).description).toMatch(/narrative/);
  });
});

describe("skill routing", () => {
  it("does not invoke every skill for a stablecoin depeg with market quotes", () => {
    const event = facts({
      evidence: [
        {
          hostname: "reuters.com",
          sourceFamily: "search",
          text: "Tether USDT depeg commentary after redemption pressure",
          role: "primary",
          hasValidatedClaim: true,
          contentCompleteness: "full_document",
        },
        {
          hostname: "coindesk.com",
          sourceFamily: "search",
          text: "USDT trades off peg on one venue",
          role: "primary",
          hasValidatedClaim: true,
          contentCompleteness: "full_document",
        },
      ],
      assets: [{ assetClass: "stablecoin", canonicalId: "coingecko:tether" }],
      observations: [
        {
          kind: "price_change_24h",
          value: -1.2,
          unit: "percent",
          observedAt: new Date(),
          sourceId: "cg",
        },
        {
          kind: "quoted_volume",
          value: 4_000_000_000,
          unit: "usd",
          observedAt: new Date(),
          sourceId: "cg",
        },
      ],
      watchlistOverlap: true,
      portfolioOverlap: false,
    });
    const selection = selectApplicableSkills({
      attached: ALL_ATTACHED,
      facts: factsToApplicability(event),
    });
    const selected = selection.selected.map((item) => item.slug);
    expect(selected).toEqual(
      expect.arrayContaining([
        "candidate-discovery",
        "event-correlation",
        "stablecoin-risk",
        "liquidity-analysis",
        "market-regime-analysis",
        "price-reaction-analysis",
        "contrarian-analysis",
        "materiality-analysis",
        "risk-assessment",
      ]),
    );
    expect(selected).not.toContain("whale-activity");
    expect(selected).not.toContain("regulatory-analysis");
    expect(selection.selected.length).toBeLessThan(14);
    expect(selection.skipped.some((item) => item.slug === "whale-activity")).toBe(true);
  });

  it("routes a regulatory event without large-holder or stablecoin skills", () => {
    const event = facts({
      evidence: [
        {
          hostname: "sec.gov",
          sourceFamily: "search",
          text: "SEC official statement on crypto exchange complaint",
          role: "primary",
        },
        {
          hostname: "reuters.com",
          sourceFamily: "search",
          text: "Reuters reports the SEC filing",
          role: "primary",
        },
      ],
      assets: [{ assetClass: "cryptocurrency", canonicalId: "coingecko:bitcoin" }],
      observations: [
        {
          kind: "price_change_24h",
          value: -2.4,
          unit: "percent",
          observedAt: new Date(),
          sourceId: "cg",
        },
      ],
      watchlistOverlap: true,
      portfolioOverlap: false,
    });
    const selected = selectApplicableSkills({
      attached: ALL_ATTACHED,
      facts: factsToApplicability(event),
    }).selected.map((item) => item.slug);
    expect(selected).toEqual(
      expect.arrayContaining([
        "candidate-discovery",
        "event-correlation",
        "regulatory-analysis",
        "catalyst-analysis",
        "contrarian-analysis",
        "materiality-analysis",
        "risk-assessment",
      ]),
    );
    expect(selected).not.toContain("stablecoin-risk");
    expect(selected).not.toContain("whale-activity");
  });

  it("routes an emerging meme narrative without stablecoin or regulatory skills", () => {
    const event = facts({
      evidence: [
        {
          hostname: "x.com",
          sourceFamily: "x",
          text: "first independent mention of a new meme coin narrative",
          role: "primary",
        },
        {
          hostname: "example.search",
          sourceFamily: "search",
          text: "meme coin attention accelerating on a second host",
          role: "primary",
        },
      ],
      assets: [{ assetClass: "meme_coin", canonicalId: "crypto:meme-narrative" }],
      observations: [
        {
          kind: "price_change_24h",
          value: 7.1,
          unit: "percent",
          observedAt: new Date(),
          sourceId: "cg",
        },
        {
          kind: "quoted_volume",
          value: 12_000_000,
          unit: "usd",
          observedAt: new Date(),
          sourceId: "cg",
        },
      ],
      watchlistOverlap: false,
      portfolioOverlap: false,
    });
    const selected = selectApplicableSkills({
      attached: ALL_ATTACHED,
      facts: factsToApplicability(event),
    }).selected.map((item) => item.slug);
    expect(selected).toEqual(
      expect.arrayContaining([
        "candidate-discovery",
        "event-correlation",
        "early-trend-detection",
        "narrative-detection",
        "price-reaction-analysis",
        "contrarian-analysis",
        "materiality-analysis",
        "risk-assessment",
      ]),
    );
    expect(selected).not.toContain("stablecoin-risk");
    expect(selected).not.toContain("regulatory-analysis");
  });

  it("skips market context skills when quotes are missing", () => {
    const event = facts([
      {
        hostname: "news.example",
        sourceFamily: "search",
        text: "Bitcoin ETF inflows persist according to one desk",
        role: "primary",
      },
    ]);
    const selection = selectApplicableSkills({
      attached: ALL_ATTACHED,
      facts: factsToApplicability(event),
    });
    expect(selection.selected.map((item) => item.slug)).toContain("candidate-discovery");
    const skipped = selection.skipped;
    expect(skipped.map((item) => item.slug)).toEqual(
      expect.arrayContaining([
        "price-reaction-analysis",
        "market-regime-analysis",
        "liquidity-analysis",
      ]),
    );
    expect(skipped.find((item) => item.slug === "liquidity-analysis")?.reason).toBe(
      "liquidity_evidence_unavailable",
    );
  });
});

describe("analysis facts", () => {
  it("treats a social spike on one host as isolated rather than broad persistence", () => {
    const isolated = facts([
      {
        hostname: "x.com",
        sourceFamily: "x",
        text: "everyone is talking about this coin",
        role: "primary",
      },
      {
        hostname: "x.com",
        sourceFamily: "x",
        text: "same host repeating the spike",
        role: "derived",
      },
    ]);
    expect(isolated.independentHostCount).toBe(1);
    expect(isolated.recycledHeadline).toBe(true);
    const broad = facts([
      {
        hostname: "reuters.com",
        sourceFamily: "search",
        text: "independent mention of the same narrative",
        role: "primary",
      },
      {
        hostname: "coindesk.com",
        sourceFamily: "search",
        text: "second independent host continues the story",
        role: "primary",
      },
      {
        hostname: "x.com",
        sourceFamily: "x",
        text: "social confirmation after the news",
        role: "supporting",
      },
    ]);
    expect(broad.independentHostCount).toBeGreaterThanOrEqual(2);
    expect(broad.recycledHeadline).toBe(false);
  });

  it("marks reprints as derived and opposing texts as contradicting", () => {
    expect(textOpposes("USDT depegged on one venue", "USDT remains pegged on the same day")).toBe(
      true,
    );
    const event = facts([
      {
        hostname: "reuters.com",
        sourceFamily: "search",
        text: "primary filing",
        role: "primary",
      },
      {
        hostname: "blog.example",
        sourceFamily: "search",
        text: "copy of reuters",
        role: "derived",
      },
      {
        hostname: "other.example",
        sourceFamily: "search",
        text: "denied, false alarm",
        role: "contradicting",
      },
    ]);
    expect(event.derivedCount).toBe(1);
    expect(event.contradictingCount).toBe(1);
    expect(event.primaryCount).toBe(1);
  });

  it("records stablecoin, liquidity, and regulatory evidence as present or missing", () => {
    const missingReserves = facts({
      evidence: [
        {
          hostname: "news.example",
          sourceFamily: "search",
          text: "USDT depeg mentioned on one venue",
          role: "primary",
        },
      ],
      assets: [{ assetClass: "stablecoin", canonicalId: "coingecko:tether" }],
      observations: [],
      watchlistOverlap: true,
      portfolioOverlap: false,
    });
    expect(missingReserves.pegEvidence).toBe(true);
    expect(missingReserves.reserveEvidence).toBe(false);
    expect(missingReserves.hasLiquidityMetrics).toBe(false);
    const withVolume = facts({
      evidence: [
        {
          hostname: "news.example",
          sourceFamily: "search",
          text: "peg commentary",
          role: "primary",
        },
      ],
      assets: [{ assetClass: "stablecoin", canonicalId: "coingecko:tether" }],
      observations: [
        { kind: "quoted_volume", value: 1, unit: "usd", observedAt: new Date(), sourceId: "cg" },
      ],
      watchlistOverlap: false,
      portfolioOverlap: false,
    });
    expect(withVolume.hasLiquidityMetrics).toBe(true);
    const primaryReg = facts([
      {
        hostname: "sec.gov",
        sourceFamily: "search",
        text: "SEC official statement",
        role: "primary",
      },
    ]);
    expect(primaryReg.regulatoryPrimary).toBe(true);
    const speculation = facts([
      {
        hostname: "blog.example",
        sourceFamily: "search",
        text: "analysts believe the regulator may eventually act",
        role: "primary",
      },
    ]);
    expect(speculation.regulatoryTertiary).toBe(true);
    expect(speculation.regulatoryPrimary).toBe(false);
  });

  it("never treats reported whale claims as verified on-chain activity", () => {
    const event = facts([
      {
        hostname: "news.example",
        sourceFamily: "search",
        text: "a whale moved coins from an unknown wallet",
        role: "primary",
      },
    ]);
    expect(event.holderClaim).toBe(true);
    expect(event.hasOnChainVerification).toBe(false);
  });

  it("distinguishes unavailable, weak, and strong sourced price reactions", () => {
    expect(
      facts({
        evidence: [
          { hostname: "n.example", sourceFamily: "search", text: "event", role: "primary" },
        ],
        assets: [],
        observations: [],
        watchlistOverlap: false,
        portfolioOverlap: false,
      }).marketReaction,
    ).toBe("unavailable");
    expect(
      facts({
        evidence: [
          { hostname: "n.example", sourceFamily: "search", text: "event", role: "primary" },
        ],
        assets: [],
        observations: [
          {
            kind: "price_change_24h",
            value: 0.3,
            unit: "percent",
            observedAt: new Date(),
            sourceId: "cg",
          },
        ],
        watchlistOverlap: false,
        portfolioOverlap: false,
      }).marketReaction,
    ).toBe("weak");
    expect(
      facts({
        evidence: [
          { hostname: "n.example", sourceFamily: "search", text: "event", role: "primary" },
        ],
        assets: [],
        observations: [
          {
            kind: "price_change_24h",
            value: 7.1,
            unit: "percent",
            observedAt: new Date(),
            sourceId: "cg",
          },
        ],
        watchlistOverlap: false,
        portfolioOverlap: false,
      }).marketReaction,
    ).toBe("strong");
  });

  it("extracts sourced market observations from adapter payloads only", () => {
    const rows = observationsFromMarketPayload(
      { canonicalId: "coingecko:bitcoin", priceUsd: 64000, volumeUsd: 1, change24h: 1.5 },
      "coingecko",
      new Date("2026-09-11T00:00:00Z"),
    );
    expect(rows.map((item) => item.kind)).toEqual([
      "quoted_price",
      "quoted_volume",
      "price_change_24h",
    ]);
    expect(observationsFromMarketPayload({}, "x", new Date())).toEqual([]);
  });

  it("estimates prompt tokens from character count", () => {
    expect(estimatePromptTokens(0)).toBe(0);
    expect(estimatePromptTokens(4)).toBe(1);
    expect(estimatePromptTokens(9)).toBe(3);
  });
});

describe("signal gate", () => {
  it("keeps interesting-but-immaterial events on the dashboard", () => {
    const event = facts([
      {
        hostname: "blog.example",
        sourceFamily: "search",
        text: "interesting aside",
        role: "primary",
      },
    ]);
    const gate = decideSignalGate({
      facts: event,
      risk: "low",
      confidence: 0.8,
      material: { material: false, reason: "below_threshold" },
    });
    expect(gate.notifyEligible).toBe(false);
    expect(gate.disposition).toBe("low_priority");
    expect(gate.reason).toBe("interesting_not_material");
  });

  it("notifies corroborated material events according to impact", () => {
    const event = facts({
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
      portfolioOverlap: true,
    });
    const gate = decideSignalGate({
      facts: event,
      risk: "high",
      confidence: 0.92,
      material: { material: true, reason: "independent_hosts" },
      impact: "high",
    });
    expect(gate.notifyEligible).toBe(true);
    expect(gate.disposition).toBe("high");
  });

  it("allows high confidence together with high risk", () => {
    const event = facts([
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
    ]);
    const gate = decideSignalGate({
      facts: event,
      risk: "high",
      confidence: 0.92,
      material: { material: true, reason: "independent_hosts" },
      impact: "high",
    });
    expect(gate.disposition).toBe("high");
    expect(gate.notifyEligible).toBe(true);
  });
});
