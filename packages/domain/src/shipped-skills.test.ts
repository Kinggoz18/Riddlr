import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHIPPED_CRYPTO_SKILL_SLUGS } from "./skill-catalog.js";

const REQUIRED: Record<string, string[]> = {
  "candidate-discovery": ["candidate", "not a recommendation", "DISCOVERED", "INFERRED", "SIGNAL"],
  "narrative-detection": ["isolated attention", "acceleration", "breadth", "persistence"],
  "event-correlation": ["independent confirmation", "reprint", "contradict"],
  "early-trend-detection": ["first independent", "recycled headline", "narrative-detection"],
  "catalyst-analysis": ["potential catalyst", "cause"],
  "market-regime-analysis": ["cannot be confidently assessed", "risk-on"],
  "price-reaction-analysis": ["no market data", "weak market", "strong"],
  "liquidity-analysis": ["tradeability", "Liquidity evidence unavailable"],
  "stablecoin-risk": ["reserve", "inventing", "redemption"],
  "whale-activity": ["on-chain scanning", "reported large-holder"],
  "regulatory-analysis": ["Primary", "Secondary", "Tertiary"],
  "contrarian-analysis": ["invalidating", "missing confirmation", "contradict"],
  "risk-assessment": ["confidence", "risk", "separate"],
  "materiality-analysis": ["interesting", "material", "interrupt"],
};

describe("shipped skill files", () => {
  it("has fourteen concise markdown bodies with required distinctions", () => {
    expect(SHIPPED_CRYPTO_SKILL_SLUGS).toHaveLength(14);
    for (const slug of SHIPPED_CRYPTO_SKILL_SLUGS) {
      const body = readFileSync(join(process.cwd(), "skills/crypto", `${slug}.md`), "utf8");
      const words = body.trim().split(/\s+/).length;
      expect(words).toBeGreaterThan(80);
      expect(words).toBeLessThan(350);
      expect(body).toContain("origin: shipped");
      expect(body).toContain('version: "1"');
      for (const needle of REQUIRED[slug] ?? []) {
        expect(body.toLowerCase()).toContain(needle.toLowerCase());
      }
    }
  });
});
