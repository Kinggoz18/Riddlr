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
        sameHostnameSameDay: true,
      }),
    ).toBe("derived");
    expect(independenceCounts(["primary", "derived", "derived", "supporting"])).toEqual({
      independentSourceCount: 2,
      derivedReprintCount: 2,
    });
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
