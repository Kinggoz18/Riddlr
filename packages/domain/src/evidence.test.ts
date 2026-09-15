import { describe, expect, it } from "vitest";
import {
  canonicalizeUrl,
  classifyReprint,
  independenceCounts,
  normalizeEvidence,
} from "./evidence.js";

describe("evidence provenance", () => {
  it("strips tracking parameters from canonical URLs", () => {
    expect(canonicalizeUrl("https://News.Example.com/story/?utm_source=x&id=1")).toBe(
      "https://news.example.com/story?id=1",
    );
  });

  it("keeps hash-routed Snapshot proposal identity and strips in-page fragments", () => {
    expect(
      canonicalizeUrl(
        "https://snapshot.box/#/s:grovefinance.eth/proposal/0x1a95608718c0fa345422e19fffce5f7e93f3af6d5a7e8318f567d11cfe545335",
      ),
    ).toBe(
      "https://snapshot.box/#/s:grovefinance.eth/proposal/0x1a95608718c0fa345422e19fffce5f7e93f3af6d5a7e8318f567d11cfe545335",
    );
    expect(canonicalizeUrl("https://example.com/story#comments")).toBe("https://example.com/story");
  });

  it("collapses reprints by URL or content hash", () => {
    expect(classifyReprint({ sameCanonicalUrl: true, sameContentHash: false })).toBe("derived");
    expect(classifyReprint({ sameCanonicalUrl: false, sameContentHash: true })).toBe("derived");
    expect(classifyReprint({ sameCanonicalUrl: false, sameContentHash: false })).toBe("primary");
    expect(
      classifyReprint({
        sameCanonicalUrl: false,
        sameContentHash: false,
        nearDuplicate: true,
      }),
    ).toBe("derived");
    expect(
      classifyReprint({
        sameCanonicalUrl: false,
        sameContentHash: false,
        sameOrigin: true,
      }),
    ).toBe("derived");
    expect(independenceCounts(["primary", "derived", "derived", "supporting"])).toEqual({
      independentSourceCount: 2,
      derivedReprintCount: 2,
      contradictingCount: 0,
    });
    expect(
      classifyReprint({
        sameCanonicalUrl: false,
        sameContentHash: false,
        snippetOnly: true,
      }),
    ).toBe("supporting");
    expect(
      classifyReprint({
        sameCanonicalUrl: false,
        sameContentHash: false,
        opposingClaims: true,
      }),
    ).toBe("contradicting");
  });

  it("fingerprints normalized evidence stably", () => {
    const first = normalizeEvidence({
      sourceFamily: "search",
      adapterId: "searxng",
      url: "https://example.com/a?utm_campaign=1",
      title: "Bitcoin ETF inflows",
      bodyText: "Inflows rose.",
      fetchedAt: new Date("2026-09-10T00:00:00Z"),
      publishedAt: new Date("2026-09-10T00:00:00Z"),
    });
    const second = normalizeEvidence({
      sourceFamily: "search",
      adapterId: "searxng",
      url: "https://example.com/a",
      title: "Bitcoin ETF inflows",
      bodyText: "Inflows rose.",
      fetchedAt: new Date("2026-09-10T00:00:00Z"),
      publishedAt: new Date("2026-09-10T00:00:00Z"),
    });
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.contentHash).toBe(second.contentHash);
  });
});
