import { normalizeEvidence, type RegistryAsset } from "@riddlr/domain";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EQUITIES_WATCHLIST,
  equitiesDomainModule,
  mapEightKItemToClaim,
} from "./module.js";

function apple(): RegistryAsset {
  return {
    assetClass: "stock",
    canonicalId: "sec:0000320193",
    symbol: "AAPL",
    name: "Apple Inc.",
    aliases: ["aapl", "apple inc.", "$aapl", "0000320193"],
    externalIds: { cik: "0000320193", ticker: "AAPL", figi: "BBG000B9XRY4" },
    marketCapRank: 2,
    status: "active",
  };
}

describe("equities domain module", () => {
  it("maps 8-K items onto catalyst kinds", () => {
    expect(mapEightKItemToClaim("2.02")?.kind).toBe("equities:earnings");
    expect(equitiesDomainModule.mapClaimKindToCatalyst("equities:earnings")).toBe(
      "earnings_or_guidance",
    );
    expect(mapEightKItemToClaim("1.03")?.kind).toBe("equities:insolvency");
    expect(mapEightKItemToClaim("5.02")?.predicate).toBe("officer_change");
    expect(DEFAULT_EQUITIES_WATCHLIST[0]?.canonicalId).toBe("sec:0000320193");
  });

  it("maps 8-K 5.02 to officer_change at high impact", () => {
    const evidence = [
      normalizeEvidence({
        sourceFamily: "filing",
        adapterId: "edgar",
        title: "8-K - CIMG Inc. (0001527613) (Filer)",
        bodyText: "Item 5.02 Departure of Directors or Certain Officers",
        fetchedAt: new Date("2026-09-14T20:50:18.000Z"),
        publishedAt: new Date("2026-09-14T20:50:18.000Z"),
        contentCompleteness: "native_complete",
        adapterPayload: {
          form: "8-K",
          items: ["5.02", "9.01"],
          cik: "0001527613",
          subjectCanonicalId: "sec:0001527613",
        },
      }),
    ];
    const claims = equitiesDomainModule.extractClaims(evidence, [
      {
        assetClass: "stock",
        canonicalId: "sec:0001527613",
        symbol: "IMG",
        name: "CIMG Inc.",
        aliases: ["img", "cimg inc."],
        externalIds: { cik: "0001527613", ticker: "IMG" },
        marketCapRank: null,
        status: "active",
      },
    ]);
    expect(claims.some((item) => item.kind === "equities:officer_change")).toBe(true);
    expect(claims[0]?.predicate).toBe("officer_change");
    const impact = equitiesDomainModule.assessImpact({
      claims,
      assets: [{ assetClass: "stock", canonicalId: "sec:0001527613" }],
      observations: [],
      watchlistOverlap: true,
      portfolioOverlap: false,
      hasTrustedFirsthand: true,
      stale: false,
      contradicted: false,
      retracted: false,
    });
    expect(impact.level).toBe("high");
    expect(impact.reason).toBe("officer_change");
  });

  it("extracts an 8-K 2.02 earnings claim from official filing payload", () => {
    const evidence = [
      normalizeEvidence({
        sourceFamily: "filing",
        adapterId: "edgar",
        title: "8-K - Apple Inc. (0000320193) (Filer)",
        bodyText: "Item 2.02 Results of Operations and Financial Condition",
        fetchedAt: new Date("2026-07-30T20:30:28.000Z"),
        publishedAt: new Date("2026-07-30T20:30:28.000Z"),
        contentCompleteness: "native_complete",
        adapterPayload: {
          form: "8-K",
          items: ["2.02", "9.01"],
          cik: "0000320193",
          subjectCanonicalId: "sec:0000320193",
        },
      }),
    ];
    const claims = equitiesDomainModule.extractClaims(evidence, [apple()]);
    expect(claims.some((item) => item.kind === "equities:earnings")).toBe(true);
    const impact = equitiesDomainModule.assessImpact({
      claims,
      assets: [{ assetClass: "stock", canonicalId: "sec:0000320193", symbol: "AAPL" }],
      observations: [],
      watchlistOverlap: true,
      portfolioOverlap: false,
      hasTrustedFirsthand: true,
      stale: false,
      contradicted: false,
      retracted: false,
    });
    expect(impact.level).toBe("high");
    expect(impact.reason).toBe("earnings_or_guidance");
  });

  it("keeps Form 4 officer transactions low impact even with official identity", () => {
    const evidence = [
      normalizeEvidence({
        sourceFamily: "filing",
        adapterId: "edgar",
        title: "4 - Apple Inc. (0000320193) (Reporting)",
        bodyText: "Form 4 sale of common stock",
        fetchedAt: new Date("2026-09-10T22:30:31.000Z"),
        publishedAt: new Date("2026-09-10T22:30:31.000Z"),
        contentCompleteness: "native_complete",
        adapterPayload: {
          form: "4",
          cik: "0000320193",
          subjectCanonicalId: "sec:0000320193",
          transactionCode: "S",
          shares: 1438,
          price: 317.23,
          officer: true,
          transactionDate: "2026-09-08",
        },
      }),
    ];
    const claims = equitiesDomainModule.extractClaims(evidence, [apple()]);
    expect(claims[0]?.kind).toBe("equities:insider_transaction");
    expect(claims[0]?.value).toBeCloseTo(1438 * 317.23);
    expect(claims[0]?.unit).toBe("usd");
    const impact = equitiesDomainModule.assessImpact({
      claims,
      assets: [{ assetClass: "stock", canonicalId: "sec:0000320193" }],
      observations: [],
      watchlistOverlap: true,
      portfolioOverlap: false,
      hasTrustedFirsthand: true,
      stale: false,
      contradicted: false,
      retracted: false,
    });
    expect(impact.level).toBe("low");
  });

  it("does not canonicalize an unknown ticker when two issuers collide", () => {
    const left = apple();
    const right: RegistryAsset = {
      ...apple(),
      canonicalId: "sec:0001018724",
      name: "Amazon.com Inc.",
      symbol: "AMZN",
      aliases: ["aapl"],
      externalIds: { cik: "0001018724", ticker: "AAPL" },
    };
    expect(
      equitiesDomainModule.canonicalizeAsset({ symbol: "AAPL" }, [left, right]),
    ).toBeUndefined();
    expect(
      equitiesDomainModule.canonicalizeAsset({ canonicalId: "sec:0000320193" }, [left, right])
        ?.canonicalId,
    ).toBe("sec:0000320193");
  });

  it("returns empty source queries for EDGAR polls", () => {
    expect(
      equitiesDomainModule.sourceQueries({
        adapterId: "edgar",
        watchlist: DEFAULT_EQUITIES_WATCHLIST,
      }),
    ).toEqual([""]);
  });
});
