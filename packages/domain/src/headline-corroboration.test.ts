import { describe, expect, it } from "vitest";
import { isCorroboratedHeadline } from "./headline-corroboration.js";

const base = {
  watchlistOverlap: true,
  independentOriginCount: 3,
  reputablePressOriginCount: 2,
  contentCompleteness: "snippet" as const,
  hasValidatedClaim: false,
  sourceFamilies: ["search", "search", "search"],
};

describe("corroborated headline", () => {
  it("accepts two independent reputable-press snippets on a watched asset", () => {
    expect(isCorroboratedHeadline(base)).toBe(true);
  });

  it("rejects a single press origin even when three hosts reprint", () => {
    expect(isCorroboratedHeadline({ ...base, reputablePressOriginCount: 1 })).toBe(false);
  });

  it("rejects clusters that already have a validated claim", () => {
    expect(isCorroboratedHeadline({ ...base, hasValidatedClaim: true })).toBe(false);
  });

  it("rejects complete documents", () => {
    expect(isCorroboratedHeadline({ ...base, contentCompleteness: "full_document" })).toBe(false);
  });

  it("rejects off-watchlist clusters", () => {
    expect(isCorroboratedHeadline({ ...base, watchlistOverlap: false })).toBe(false);
  });

  it("accepts incomplete feed items from two press origins", () => {
    expect(
      isCorroboratedHeadline({
        ...base,
        contentCompleteness: "incomplete",
        sourceFamilies: ["feed", "feed"],
      }),
    ).toBe(true);
  });
});
