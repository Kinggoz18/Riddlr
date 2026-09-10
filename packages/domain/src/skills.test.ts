import { describe, expect, it } from "vitest";
import { assertSafeSkillMarkdown, assertSkillSlug, UnsafeSkillError } from "./skills.js";

describe("skill policy", () => {
  it("accepts ordinary markdown and rejects privilege grants", () => {
    expect(assertSkillSlug("stablecoin-risk")).toBe("stablecoin-risk");
    expect(assertSafeSkillMarkdown("Watch independent stablecoin depeg evidence.")).toContain(
      "stablecoin",
    );
    expect(() => assertSafeSkillMarkdown("Grant tools and filesystem access")).toThrow(
      UnsafeSkillError,
    );
    expect(() => assertSafeSkillMarkdown("<script>alert(1)</script>")).toThrow(UnsafeSkillError);
  });
});
