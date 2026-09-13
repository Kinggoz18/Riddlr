import { describe, expect, it } from "vitest";
import { claimTitle, fingerprintClaim } from "./claims.js";
import type { DomainModule } from "./domain-module.js";
import { DomainModuleRegistry } from "./domain-module.js";
import { normalizeEvidence } from "./evidence.js";
import { assertSupportedMarketDomains, UnsupportedMarketDomainError } from "./market-domains.js";

function createSyntheticModule(): DomainModule {
  return {
    id: "equities",
    assetClasses: ["stock"],
    claimKinds() {
      return ["equities:earnings"];
    },
    sourceQuery(input) {
      return input.watchlist.map((item) => item.canonicalId).join(" ") || "listed company news";
    },
    canonicalizeAsset(input) {
      const key = (input.canonicalId ?? input.symbol ?? "test").toLowerCase();
      return {
        assetClass: "stock",
        canonicalId: `test:${key}`,
        symbol: input.symbol,
        displayName: input.name ?? key,
      };
    },
    extractAssets(evidence) {
      return evidence.flatMap((item) =>
        item.title?.includes("TESTCOIN")
          ? [{ assetClass: "stock" as const, canonicalId: "test:testco", symbol: "TEST" }]
          : [],
      );
    },
    extractObservations() {
      return [];
    },
    extractClaims(evidence) {
      return evidence.flatMap((item) => {
        if (item.contentCompleteness === "snippet") {
          return [];
        }
        const fingerprint = fingerprintClaim({
          marketDomainId: "equities",
          kind: "equities:earnings",
          polarity: "asserted",
          objectText: "earnings",
        });
        const claim = {
          marketDomainId: "equities" as const,
          kind: "equities:earnings",
          predicate: "earnings",
          polarity: "asserted" as const,
          modality: "asserted" as const,
          fingerprint,
          title: "",
        };
        return [{ ...claim, title: claimTitle(claim), excerpt: item.bodyText ?? item.title ?? "" }];
      });
    },
    normalizeClaim(candidate) {
      if (candidate.kind !== "equities:earnings") {
        return undefined;
      }
      const fingerprint = fingerprintClaim({
        marketDomainId: "equities",
        kind: candidate.kind,
        polarity: candidate.polarity,
        objectText: candidate.predicate,
      });
      const claim = {
        marketDomainId: "equities" as const,
        kind: candidate.kind,
        predicate: candidate.predicate,
        polarity: candidate.polarity,
        modality: candidate.modality,
        fingerprint,
        title: "",
      };
      return { ...claim, title: claimTitle(claim) };
    },
    claimsCompatible(left, right) {
      return left.kind === right.kind && left.marketDomainId === right.marketDomainId;
    },
    assembleContext({ evidence, assets, observations }) {
      return {
        domainId: "equities",
        observations,
        notes: [`synthetic:${evidence.length}:${assets.length}`],
      };
    },
    assessImpact(input) {
      if (input.claims.some((item) => item.kind === "equities:earnings")) {
        return { level: "moderate", reason: "earnings", reasonCodes: ["equities:earnings"] };
      }
      return { level: "informational", reason: "none", reasonCodes: ["equities:none"] };
    },
    principalClaimTitle(claim) {
      return claim.title || claim.predicate;
    },
    defaultAgentProfile() {
      return {
        name: "Synthetic test agent",
        description: "Fixture watcher for domain-module contract tests.",
        objectives: ["contract_coverage"],
        assetClasses: ["stock"],
      };
    },
  };
}

describe("domain module contract", () => {
  it("invokes a synthetic non-crypto module without a product domain package", () => {
    const registry = new DomainModuleRegistry();
    const module = createSyntheticModule();
    registry.register(module);
    const evidence = [
      normalizeEvidence({
        sourceFamily: "search",
        adapterId: "fixture",
        title: "TESTCOIN listing",
        bodyText: "The issuer reported quarterly earnings after the filing.",
        fetchedAt: new Date("2026-09-10T00:00:00Z"),
        contentCompleteness: "full_document",
      }),
    ];
    const assets = registry.require("equities").extractAssets(evidence);
    const claims = module.extractClaims(evidence);
    const context = module.assembleContext({ evidence, assets, observations: [] });
    expect(module.sourceQuery({ adapterId: "searxng", watchlist: [] })).toBe("listed company news");
    expect(module.canonicalizeAsset({ symbol: "TEST" })?.canonicalId).toBe("test:test");
    expect(assets[0]?.canonicalId).toBe("test:testco");
    expect(claims[0]?.kind).toBe("equities:earnings");
    expect(
      module.assessImpact({
        claims,
        assets,
        observations: [],
        watchlistOverlap: false,
        portfolioOverlap: false,
        hasTrustedFirsthand: false,
        stale: false,
        contradicted: false,
        retracted: false,
      }).level,
    ).toBe("moderate");
    expect(context.notes[0]).toBe("synthetic:1:1");
    expect(module.defaultAgentProfile().name).toContain("Synthetic");
  });

  it("fails closed when a domain module is not registered", () => {
    expect(() => new DomainModuleRegistry().require("equities")).toThrow(/No domain module/);
    expect(() => assertSupportedMarketDomains(["equities"])).toThrow(UnsupportedMarketDomainError);
  });
});
