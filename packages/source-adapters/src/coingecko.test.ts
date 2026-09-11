import { describe, expect, it } from "vitest";
import { parseCoinGeckoMarkets } from "./coingecko.js";

describe("CoinGecko market-data adapter", () => {
  it("parses official markets rows with price, volume, and market cap", () => {
    const parsed = parseCoinGeckoMarkets(
      [
        {
          id: "bitcoin",
          symbol: "btc",
          name: "Bitcoin",
          current_price: 64000,
          market_cap: 1,
          total_volume: 2,
          last_updated: "2026-09-10T00:00:00.000Z",
        },
      ],
      new Date("2026-09-10T00:00:00Z"),
    );
    expect(parsed.evidence[0]?.adapterPayload?.canonicalId).toBe("coingecko:bitcoin");
    expect(parsed.evidence[0]?.adapterPayload?.priceUsd).toBe(64000);
    expect(parsed.evidence[0]?.bodyText).toContain("USD 64000");
  });
});
