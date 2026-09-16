import { describe, expect, it } from "vitest";
import {
  aliasIsWeakProse,
  ENGLISH_RESOLVER_STOPWORDS,
  isEnglishStopword,
} from "./english-stopwords.js";
import { MAX_ENGLISH_STOPWORDS } from "./limits.js";

describe("resolver stopwords", () => {
  it("stays inside the explicit bound and treats CoinGecko prose collisions as weak", () => {
    expect(ENGLISH_RESOLVER_STOPWORDS.size).toBeGreaterThan(100);
    expect(ENGLISH_RESOLVER_STOPWORDS.size).toBeLessThanOrEqual(MAX_ENGLISH_STOPWORDS);
    for (const word of ["data", "cap", "not", "people", "would", "america", "trump", "hype"]) {
      expect(isEnglishStopword(word)).toBe(true);
    }
    expect(isEnglishStopword("bitcoin")).toBe(false);
    expect(aliasIsWeakProse("cap usd")).toBe(true);
    expect(aliasIsWeakProse("bitcoin cash")).toBe(false);
    expect(aliasIsWeakProse("$trump")).toBe(false);
  });
});
