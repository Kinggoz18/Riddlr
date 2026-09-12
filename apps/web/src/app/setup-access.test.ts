import { needsSetupCode } from "@riddlr/domain/web";
import { describe, expect, it } from "vitest";

describe("setup wizard gate", () => {
  it("shows the setup-code card only when this browser cannot continue", () => {
    expect(needsSetupCode({ setupAccess: "code", canContinue: false })).toBe(true);
    expect(needsSetupCode({ setupAccess: "code", canContinue: true })).toBe(false);
    expect(needsSetupCode({ setupAccess: "local", canContinue: true })).toBe(false);
    expect(needsSetupCode({})).toBe(false);
  });
});
