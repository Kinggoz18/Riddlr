import { describe, expect, it } from "vitest";
import {
  assertCanonicalAssetId,
  InvalidWatchlistItemError,
  watchlistSearchQuery,
} from "./watchlist.js";

describe("watchlist identity", () => {
  it("requires a canonical id and rejects a bare ticker", () => {
    expect(assertCanonicalAssetId("coingecko:bitcoin")).toBe("coingecko:bitcoin");
    expect(() => assertCanonicalAssetId("BTC")).toThrow(InvalidWatchlistItemError);
    expect(() => assertCanonicalAssetId("bitcoin")).toThrow(InvalidWatchlistItemError);
  });

  it("builds a bounded search query from canonical ids", () => {
    expect(watchlistSearchQuery([], "cryptocurrency bitcoin ethereum")).toBe(
      "cryptocurrency bitcoin ethereum",
    );
    expect(
      watchlistSearchQuery(
        [{ canonicalId: "coingecko:bitcoin", symbol: "BTC", name: "Bitcoin" }],
        "fallback",
      ),
    ).toContain("bitcoin");
  });
});
