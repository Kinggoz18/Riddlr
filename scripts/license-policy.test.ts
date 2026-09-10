import { describe, expect, it } from "vitest";
import { licenseAllowed } from "./license-policy.mjs";

describe("license expressions", () => {
  it("requires every term in SPDX AND and rejects GPL/AGPL/UNKNOWN", () => {
    expect(licenseAllowed("MIT")).toBe(true);
    expect(licenseAllowed("MIT AND Apache-2.0")).toBe(true);
    expect(licenseAllowed("MIT AND GPL-3.0")).toBe(false);
    expect(licenseAllowed("GPL-3.0 OR MIT")).toBe(true);
    expect(licenseAllowed("GPL-3.0")).toBe(false);
    expect(licenseAllowed("AGPL-3.0")).toBe(false);
    expect(licenseAllowed("UNKNOWN")).toBe(false);
    expect(licenseAllowed("")).toBe(false);
    expect(licenseAllowed("MIT AND")).toBe(false);
  });
});
