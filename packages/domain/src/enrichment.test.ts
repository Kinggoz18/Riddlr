import { describe, expect, it } from "vitest";
import {
  classifyPageHeuristic,
  enrichmentEligibility,
  isEnrichableSourceFamily,
  prioritizeEnrichment,
  trustAllowsUse,
} from "./enrichment.js";

describe("enrichment eligibility", () => {
  const fetchedAt = new Date("2026-09-13T00:00:00Z");

  it("rejects navigation pages, blocked hosts, and generic titles", () => {
    expect(
      enrichmentEligibility({
        url: "https://news.example.com/tag/bitcoin",
        title: "Bitcoin filing",
        fetchedAt,
      }).reason,
    ).toBe("navigation_page");
    expect(
      enrichmentEligibility({
        url: "https://evil.example/story",
        title: "Bitcoin filing details today",
        fetchedAt,
        blockedHosts: ["example"],
      }).reason,
    ).toBe("blocked_host");
    expect(
      enrichmentEligibility({ url: "https://news.example.com/", title: "Home", fetchedAt }).reason,
    ).toBe("generic_title");
  });

  it("allows a specific public article and deprioritizes price pages", () => {
    expect(
      enrichmentEligibility({
        url: "https://example.com/bitcoin-etf",
        title: "Bitcoin ETF inflows accelerate after filing",
        fetchedAt,
      }).eligible,
    ).toBe(true);
    expect(classifyPageHeuristic({ url: "https://www.coinbase.com/price/bitcoin" })).toBe(
      "market_profile",
    );
    const ranked = prioritizeEnrichment([
      { url: "https://www.coinbase.com/price/bitcoin", title: "Bitcoin price", fetchedAt },
      {
        url: "https://example.com/bitcoin-etf",
        title: "Bitcoin ETF inflows accelerate after filing",
        fetchedAt,
      },
    ]);
    expect(ranked[0]?.url).toBe("https://example.com/bitcoin-etf");
  });

  it("requires firsthand trust for early warning", () => {
    expect(trustAllowsUse("unknown", "discovery")).toBe(true);
    expect(trustAllowsUse("community", "early_warning")).toBe(false);
    expect(trustAllowsUse("official_firsthand", "early_warning")).toBe(true);
    expect(trustAllowsUse("known_analyst", "early_warning")).toBe(true);
    expect(trustAllowsUse("known_analyst", "confirmation")).toBe(false);
    expect(trustAllowsUse("reputable_press", "analysis")).toBe(true);
    expect(trustAllowsUse("reputable_press", "early_warning")).toBe(false);
    expect(trustAllowsUse("blocked", "analysis")).toBe(false);
    expect(trustAllowsUse("community", "analysis", ["discovery"])).toBe(false);
    expect(trustAllowsUse("community", "analysis", ["discovery", "analysis"])).toBe(true);
  });

  it("enriches search and feed families only", () => {
    expect(isEnrichableSourceFamily("search")).toBe(true);
    expect(isEnrichableSourceFamily("feed")).toBe(true);
    expect(isEnrichableSourceFamily("market_data")).toBe(false);
    expect(isEnrichableSourceFamily("x")).toBe(false);
  });
});
