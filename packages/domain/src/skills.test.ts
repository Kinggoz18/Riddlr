import { describe, expect, it } from "vitest";
import {
  assertSafeSkillMarkdown,
  assertSkillSlug,
  skillPurposeLine,
  UnsafeSkillError,
} from "./skills.js";

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

  it("extracts the operator Purpose line from skill markdown", () => {
    expect(skillPurposeLine("Purpose: decide whether attention has become a narrative.")).toBe(
      "decide whether attention has become a narrative.",
    );
    expect(skillPurposeLine("# no purpose")).toBeUndefined();
  });
});
