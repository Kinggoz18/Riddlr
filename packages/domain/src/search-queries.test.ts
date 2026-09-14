import { describe, expect, it } from "vitest";
import { MAX_SEARXNG_ASSET_QUERIES, MAX_SEARXNG_QUERY_CHARS } from "./limits.js";
import {
  buildAssetNewsQuery,
  buildDomainGeneralNewsQuery,
  quoteSearchTerm,
} from "./search-queries.js";

const KEYWORDS = [
  "hack",
  "exploit",
  "depeg",
  "listing",
  "SEC",
  "lawsuit",
  "outage",
  "unlock",
] as const;

describe("SearXNG per-asset news queries", () => {
  it("quotes name and symbol and appends the catalyst keyword set from section 8.15", () => {
    expect(
      buildAssetNewsQuery({
        name: "Bitcoin",
        symbol: "BTC",
        canonicalId: "coingecko:bitcoin",
        keywords: KEYWORDS,
      }),
    ).toBe(
      '"Bitcoin" OR "BTC" (hack OR exploit OR depeg OR listing OR SEC OR lawsuit OR outage OR unlock)',
    );
    expect(MAX_SEARXNG_ASSET_QUERIES).toBe(12);
    expect(MAX_SEARXNG_QUERY_CHARS).toBe(512);
  });

  it("strips embedded quotes and falls back to the canonical local id", () => {
    expect(quoteSearchTerm('Bit"coin')).toBe('"Bitcoin"');
    expect(
      buildAssetNewsQuery({
        name: null,
        symbol: null,
        canonicalId: "coingecko:wrapped-bitcoin",
        keywords: KEYWORDS,
      }),
    ).toBe(
      '"wrapped bitcoin" (hack OR exploit OR depeg OR listing OR SEC OR lawsuit OR outage OR unlock)',
    );
  });

  it("keeps the domain-general query off the per-asset OR dump", () => {
    expect(
      buildDomainGeneralNewsQuery("cryptocurrency bitcoin ethereum stablecoin news", KEYWORDS),
    ).toBe(
      "cryptocurrency bitcoin ethereum stablecoin news (hack OR exploit OR depeg OR listing OR SEC OR lawsuit OR outage OR unlock)",
    );
  });
});
