import { describe, expect, it } from "vitest";
import { type DomainModule, DomainModuleRegistry } from "./domain-module.js";
import { normalizeEvidence } from "./evidence.js";

function createTestOnlyModule(): DomainModule {
  return {
    id: "crypto",
    assetClasses: ["cryptocurrency"],
    canonicalizeAsset(input) {
      const key = (input.canonicalId ?? input.symbol ?? "test").toLowerCase();
      return {
        assetClass: "cryptocurrency",
        canonicalId: `test:${key}`,
        symbol: input.symbol,
        displayName: input.name ?? key,
      };
    },
    extractAssets(evidence) {
      return evidence.flatMap((item) =>
        item.title?.includes("TESTCOIN")
          ? [
              {
                assetClass: "cryptocurrency" as const,
                canonicalId: "test:testcoin",
                symbol: "TEST",
              },
            ]
          : [],
      );
    },
    extractObservations() {
      return [];
    },
    assembleContext({ evidence, assets, observations }) {
      return {
        domainId: "crypto",
        observations,
        notes: [`test-only:${evidence.length}:${assets.length}`],
      };
    },
    defaultAgentProfile() {
      return {
        name: "Test-only module agent",
        objectives: ["contract_coverage"],
        assetClasses: ["cryptocurrency"],
      };
    },
  };
}

describe("domain module contract", () => {
  it("invokes a test-only implementation without a product domain package", () => {
    const registry = new DomainModuleRegistry();
    const module = createTestOnlyModule();
    registry.register(module);
    const evidence = [
      normalizeEvidence({
        sourceFamily: "search",
        adapterId: "fixture",
        title: "TESTCOIN listing",
        fetchedAt: new Date("2026-09-10T00:00:00Z"),
      }),
    ];
    const assets = registry.require("crypto").extractAssets(evidence);
    const context = module.assembleContext({ evidence, assets, observations: [] });
    expect(module.canonicalizeAsset({ symbol: "TEST" })?.canonicalId).toBe("test:test");
    expect(assets[0]?.canonicalId).toBe("test:testcoin");
    expect(context.notes[0]).toBe("test-only:1:1");
    expect(module.defaultAgentProfile().name).toContain("Test-only");
  });

  it("fails closed when a domain module is not registered", () => {
    expect(() => new DomainModuleRegistry().require("equities")).toThrow(/No domain module/);
  });
});
