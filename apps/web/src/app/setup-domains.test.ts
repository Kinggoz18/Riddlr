import { describe, expect, it } from "vitest";
import {
  completeSetupMarketDomains,
  initialSetupMarketDomains,
  toggleSetupMarketDomain,
} from "./setup-domains.js";

describe("setup market domain selection", () => {
  it("starts with crypto and never drops it", () => {
    expect(initialSetupMarketDomains()).toEqual(["crypto"]);
    expect(toggleSetupMarketDomain(["crypto"], "crypto", true)).toEqual(["crypto"]);
    expect(completeSetupMarketDomains(["equities"])).toEqual(["crypto", "equities"]);
  });

  it("toggles Equities when selectable and ignores coming-soon domains", () => {
    const withEquities = toggleSetupMarketDomain(["crypto"], "equities", true);
    expect(withEquities).toEqual(["crypto", "equities"]);
    expect(toggleSetupMarketDomain(withEquities, "equities", true)).toEqual(["crypto"]);
    expect(toggleSetupMarketDomain(["crypto"], "forex", false)).toEqual(["crypto"]);
  });
});
