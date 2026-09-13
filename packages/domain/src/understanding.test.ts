import { describe, expect, it } from "vitest";
import { InvalidUnderstandingError, validateContentUnderstanding } from "./understanding.js";

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
            kind: "crypto:market_move",
            predicate: "market_move",
            polarity: "asserted",
            modality: "asserted",
            excerpt: "Bitcoin ETF inflows rose",
          },
        ],
      },
      {
        evidenceId: "e1",
        content,
        allowedClaimKinds: ["crypto:market_move"],
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
              kind: "crypto:market_move",
              predicate: "market_move",
              polarity: "asserted",
              modality: "asserted",
              excerpt: "Bitcoin ETF inflows rose",
            },
          ],
        },
        { evidenceId: "e1", content, allowedClaimKinds: ["crypto:market_move"] },
      ),
    ).toThrow(InvalidUnderstandingError);
  });

  it("rejects unknown claim kinds, missing excerpts, and extra fields", () => {
    expect(() =>
      validateContentUnderstanding(
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
          ],
        },
        { evidenceId: "e1", content, allowedClaimKinds: ["crypto:market_move"] },
      ),
    ).toThrow(InvalidUnderstandingError);
    expect(() =>
      validateContentUnderstanding(
        {
          summary: "x",
          pageClass: "news_report",
          headlineBodyConsistent: true,
          attributedToOtherOrigin: false,
          claims: [
            {
              kind: "crypto:market_move",
              predicate: "market_move",
              polarity: "asserted",
              modality: "asserted",
              excerpt: "not in the document",
            },
          ],
        },
        { evidenceId: "e1", content, allowedClaimKinds: ["crypto:market_move"] },
      ),
    ).toThrow(/excerpt/);
  });
});
