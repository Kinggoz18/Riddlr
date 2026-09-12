import { describe, expect, it } from "vitest";
import { assetClassLabel, assetDisplayName, assetTicker } from "./format.js";
import {
  previewWatchlist,
  summarizeWatchlistLabels,
  WATCHLIST_PREVIEW_LIMIT,
} from "./watchlist-view.js";

describe("watchlist preview", () => {
  it("keeps the first eight assets and counts the rest", () => {
    const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    expect(previewWatchlist(items)).toEqual({
      shown: [0, 1, 2, 3, 4, 5, 6, 7],
      remaining: 12,
    });
    expect(WATCHLIST_PREVIEW_LIMIT).toBe(8);
  });

  it("does not invent leftover items when the list fits", () => {
    expect(previewWatchlist(["btc", "eth"])).toEqual({
      shown: ["btc", "eth"],
      remaining: 0,
    });
  });

  it("summarizes agent list labels without dumping the full set", () => {
    expect(summarizeWatchlistLabels([])).toBe("empty watchlist");
    expect(summarizeWatchlistLabels(["Bitcoin · BTC", "Ethereum · ETH"])).toBe(
      "Bitcoin · BTC · Ethereum · ETH",
    );
    expect(
      summarizeWatchlistLabels([
        "Bitcoin · BTC",
        "Ethereum · ETH",
        "Tether · USDT",
        "Solana · SOL",
      ]),
    ).toBe("Bitcoin · BTC · Ethereum · ETH · Tether · USDT · +1 more");
  });
});

describe("watchlist asset labels", () => {
  it("prefers stored symbol and name over the catalog", () => {
    expect(assetTicker("coingecko:bitcoin", { symbol: "xbt" })).toBe("XBT");
    expect(assetDisplayName("coingecko:bitcoin", { name: "BTC" })).toBe("BTC");
  });

  it("falls back to the named catalog then the canonical slug", () => {
    expect(assetTicker("coingecko:ethereum")).toBe("ETH");
    expect(assetDisplayName("coingecko:ethereum")).toBe("Ethereum");
    expect(assetTicker("coingecko:pepe")).toBe("PEPE");
    expect(assetDisplayName("coingecko:wrapped-bitcoin")).toBe("wrapped bitcoin");
    expect(assetClassLabel("meme_coin")).toBe("Meme coin");
    expect(assetClassLabel("stablecoin")).toBe("Stablecoin");
  });
});
