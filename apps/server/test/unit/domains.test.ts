import { assertSupportedMarketDomains, UnsupportedMarketDomainError } from "@riddlr/domain";
import { cryptoDomainModule } from "@riddlr/domain-crypto";
import { describe, expect, it } from "vitest";

describe("execution guards", () => {
  it("does not allow coming-soon domains to start work", () => {
    expect(() => assertSupportedMarketDomains(["macro"])).toThrow(UnsupportedMarketDomainError);
  });

  it("binds the default agent profile to crypto", () => {
    expect(cryptoDomainModule.id).toBe("crypto");
    expect(cryptoDomainModule.defaultAgentProfile().name).toBe("Riddlr Intelligence Agent");
  });
});
