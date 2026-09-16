import { describe, expect, it } from "vitest";
import {
  buildUnderstandingPrompt,
  collectAllowedSubjectIds,
  InvalidUnderstandingError,
  skipUnderstandingForPageClass,
  validateContentUnderstanding,
} from "./understanding.js";

describe("content understanding", () => {
  const content =
    "Bitcoin ETF inflows rose after the latest issuer filing covering US listed products.";

  it("accepts a strict understanding payload with a verbatim excerpt", () => {
    const parsed = validateContentUnderstanding(
      {
        summary: "The article reports ETF inflows.",
        pageClass: "news_report",
        headlineBodyConsistent: true,
        attributedToOtherOrigin: false,
        claims: [
          {
            kind: "listing_or_delisting",
            predicate: "market_move",
            polarity: "asserted",
            modality: "asserted",
            excerpt: "Bitcoin ETF inflows rose",
            subjectCanonicalId: "coingecko:bitcoin",
          },
        ],
      },
      {
        evidenceId: "e1",
        content,
        allowedClaimKinds: ["listing_or_delisting"],
        allowedSubjectIds: ["coingecko:bitcoin"],
      },
    );
    expect(parsed.claims).toHaveLength(1);
  });

  it("rejects a foreign evidence ID", () => {
    expect(() =>
      validateContentUnderstanding(
        {
          evidenceId: "other",
          summary: "The article reports ETF inflows.",
          pageClass: "news_report",
          headlineBodyConsistent: true,
          attributedToOtherOrigin: false,
          claims: [
            {
              kind: "listing_or_delisting",
              predicate: "market_move",
              polarity: "asserted",
              modality: "asserted",
              excerpt: "Bitcoin ETF inflows rose",
            },
          ],
        },
        { evidenceId: "e1", content, allowedClaimKinds: ["listing_or_delisting"] },
      ),
    ).toThrow(InvalidUnderstandingError);
  });

  it("drops unknown kinds, missing excerpts, unknown units, and foreign subject IDs", () => {
    const parsed = validateContentUnderstanding(
      {
        summary: "x",
        pageClass: "news_report",
        headlineBodyConsistent: true,
        attributedToOtherOrigin: false,
        claims: [
          {
            kind: "equities:earnings",
            predicate: "earnings",
            polarity: "asserted",
            modality: "asserted",
            excerpt: "Bitcoin ETF inflows rose",
          },
          {
            kind: "listing_or_delisting",
            predicate: "market_move",
            polarity: "asserted",
            modality: "asserted",
            excerpt: "not in the document",
            subjectCanonicalId: "coingecko:bitcoin",
          },
          {
            kind: "listing_or_delisting",
            predicate: "market_move",
            polarity: "asserted",
            modality: "asserted",
            excerpt: "Bitcoin ETF inflows rose",
            unit: "product_model",
            subjectCanonicalId: "coingecko:bitcoin",
          },
          {
            kind: "listing_or_delisting",
            predicate: "market_move",
            polarity: "asserted",
            modality: "asserted",
            excerpt: "Bitcoin ETF inflows rose",
            subjectCanonicalId: "https://www.bgr.com/phone-case",
          },
        ],
      },
      {
        evidenceId: "e1",
        content,
        allowedClaimKinds: ["listing_or_delisting"],
        allowedSubjectIds: ["coingecko:bitcoin"],
      },
    );
    expect(parsed.claims).toHaveLength(0);
  });

  it("lists allowed subject IDs and requires empty claims when the document is off-domain", () => {
    const prompt = buildUnderstandingPrompt({
      evidenceId: "e1",
      marketDomainId: "crypto",
      claimKinds: ["security_incident"],
      title: "Phone case",
      content: "A phone case review.",
      allowedSubjectIds: collectAllowedSubjectIds({
        watchlistIds: ["coingecko:bitcoin"],
        resolvedIds: ["coingecko:ethereum"],
      }),
    });
    expect(prompt.user).toContain("coingecko:bitcoin");
    expect(prompt.user).toContain("coingecko:ethereum");
    expect(prompt.system).toContain("return claims: []");
    expect(prompt.system).toContain("percent, usd, votes, tokens, bps, iso_date");
  });

  it("skips claim persistence for market_profile, promotion, opinion, and documentation", () => {
    expect(skipUnderstandingForPageClass("market_profile")).toBe(true);
    expect(skipUnderstandingForPageClass("promotion")).toBe(true);
    expect(skipUnderstandingForPageClass("opinion")).toBe(true);
    expect(skipUnderstandingForPageClass("documentation")).toBe(true);
    expect(skipUnderstandingForPageClass("news_report")).toBe(false);
  });
});
