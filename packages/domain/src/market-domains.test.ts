import { describe, expect, it } from "vitest";
import {
  ASSET_CLASS_DOMAIN,
  assertSupportedMarketDomains,
  DEFAULT_MARKET_DOMAIN,
  MARKET_DOMAIN_REGISTRY,
  ONBOARDING_STEP_COUNT,
  SETUP_STEPS,
  UnsupportedMarketDomainError,
} from "./index.js";

describe("market domain registry", () => {
  it("contains five domains and supports crypto and equities", () => {
    expect(MARKET_DOMAIN_REGISTRY).toHaveLength(5);
    expect(MARKET_DOMAIN_REGISTRY.map((item) => item.id)).toEqual([
      "crypto",
      "equities",
      "forex",
      "commodities",
      "macro",
    ]);
    expect(MARKET_DOMAIN_REGISTRY.filter((item) => item.supported).map((item) => item.id)).toEqual([
      "crypto",
      "equities",
    ]);
    const equities = MARKET_DOMAIN_REGISTRY.find((item) => item.id === "equities");
    expect(equities?.comingSoon).toBe(false);
    expect(equities?.selectable).toBe(true);
    expect(equities?.status).toBe("supported");
    for (const id of ["forex", "commodities", "macro"] as const) {
      const row = MARKET_DOMAIN_REGISTRY.find((item) => item.id === id);
      expect(row?.comingSoon).toBe(true);
      expect(row?.selectable).toBe(false);
      expect(row?.status).toBe("coming_soon");
    }
  });

  it("treats asset class as independent from market domain", () => {
    expect(ASSET_CLASS_DOMAIN.cryptocurrency).toBe("crypto");
    expect(ASSET_CLASS_DOMAIN.stock).toBe("equities");
    expect(ASSET_CLASS_DOMAIN.forex_pair).toBe("forex");
    expect(ASSET_CLASS_DOMAIN.commodity).toBe("commodities");
    expect(DEFAULT_MARKET_DOMAIN).toBe("crypto");
  });

  it("rejects coming-soon domains for execution", () => {
    expect(() => assertSupportedMarketDomains(["forex"])).toThrow(UnsupportedMarketDomainError);
    expect(() => assertSupportedMarketDomains(["commodities"])).toThrow(
      UnsupportedMarketDomainError,
    );
    expect(() => assertSupportedMarketDomains(["macro"])).toThrow(UnsupportedMarketDomainError);
    expect(assertSupportedMarketDomains(["crypto"])).toEqual(["crypto"]);
    expect(assertSupportedMarketDomains(["equities"])).toEqual(["equities"]);
  });

  it("keeps onboarding to four steps", () => {
    expect(SETUP_STEPS).toHaveLength(4);
    expect(ONBOARDING_STEP_COUNT).toBe(4);
  });
});
