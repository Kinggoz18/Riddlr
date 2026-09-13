import { describe, expect, it } from "vitest";
import {
  claimCandidateSchema,
  claimStanceFromExtraction,
  claimsCompatible,
  excerptOffsets,
  excerptPresent,
  fingerprintClaim,
  weakClaimObject,
} from "./claims.js";

describe("claims", () => {
  it("fingerprints by subject, kind, polarity, and time bucket", () => {
    const left = fingerprintClaim({
      marketDomainId: "crypto",
      kind: "crypto:market_move",
      subjectCanonicalId: "coingecko:bitcoin",
      polarity: "asserted",
      objectText: "etf inflows",
      timeBucket: "2026-09-13",
    });
    const right = fingerprintClaim({
      marketDomainId: "crypto",
      kind: "crypto:market_move",
      subjectCanonicalId: "coingecko:bitcoin",
      polarity: "asserted",
      objectText: "etf inflows",
      timeBucket: "2026-09-13",
    });
    const denied = fingerprintClaim({
      marketDomainId: "crypto",
      kind: "crypto:market_move",
      subjectCanonicalId: "coingecko:bitcoin",
      polarity: "negated",
      objectText: "etf inflows",
      timeBucket: "2026-09-13",
    });
    expect(left).toBe(right);
    expect(left).not.toBe(denied);
  });

  it("requires excerpts to exist in the source text", () => {
    expect(excerptPresent("ETF inflows rose", "Bitcoin ETF inflows rose after a filing")).toBe(
      true,
    );
    expect(excerptPresent("secret payload", "Bitcoin ETF inflows rose")).toBe(false);
  });

  it("rejects unknown fields on claim candidates", () => {
    expect(
      claimCandidateSchema.safeParse({
        kind: "crypto:market_move",
        predicate: "market_move",
        polarity: "asserted",
        modality: "asserted",
        excerpt: "ETF inflows rose",
        notify: true,
      }).success,
    ).toBe(false);
  });

  it("treats compatible claims as the same proposition", () => {
    const left = {
      marketDomainId: "crypto" as const,
      kind: "crypto:market_move",
      subjectCanonicalId: "coingecko:bitcoin",
      predicate: "market_move",
      objectText: "etf inflows",
      polarity: "asserted" as const,
      modality: "asserted" as const,
      fingerprint: "a",
      title: "bitcoin: market_move etf inflows",
    };
    const right = { ...left, fingerprint: "b" };
    expect(claimsCompatible(left, right)).toBe(true);
    expect(claimsCompatible(left, { ...right, objectText: "24 hours", fingerprint: "c" })).toBe(
      false,
    );
    expect(claimsCompatible(left, { ...right, kind: "crypto:insolvency" })).toBe(false);
  });

  it("rejects time-window claim objects as too weak", () => {
    expect(weakClaimObject("24 hours")).toBe(true);
    expect(weakClaimObject("etf inflows")).toBe(false);
    expect(weakClaimObject("hack")).toBe(false);
  });

  it("records excerpt offsets and retraction stance", () => {
    expect(excerptOffsets("ETF inflows rose", "Bitcoin ETF inflows rose after a filing")).toEqual({
      start: 8,
      end: 24,
    });
    expect(
      claimStanceFromExtraction({ polarity: "asserted", modality: "asserted", retracting: true }),
    ).toBe("retracts");
    expect(
      claimStanceFromExtraction({
        polarity: "negated",
        modality: "asserted",
      }),
    ).toBe("contradicts");
  });
});
