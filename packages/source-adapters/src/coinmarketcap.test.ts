import { describe, expect, it } from "vitest";
import { parseCoinMarketCapQuotes } from "./coinmarketcap.js";

describe("CoinMarketCap quotes adapter", () => {
  it("parses v3 quotes keyed as an array and keeps coingecko canonical ids", () => {
    const parsed = parseCoinMarketCapQuotes(
      {
        status: { error_code: 0 },
        data: [
          {
            id: 1,
            name: "Bitcoin",
            symbol: "BTC",
            slug: "bitcoin",
            last_updated: "2026-09-10T00:00:00.000Z",
            quote: {
              USD: {
                price: 64000,
                volume_24h: 2,
                market_cap: 1,
                percent_change_24h: 1.5,
              },
            },
          },
        ],
      },
      new Date("2026-09-10T00:00:00Z"),
    );
    expect(parsed.evidence[0]?.adapterPayload?.canonicalId).toBe("coingecko:bitcoin");
    expect(parsed.evidence[0]?.adapterPayload?.priceUsd).toBe(64000);
    expect(parsed.evidence[0]?.adapterPayload?.change24h).toBe(1.5);
  });

  it("parses v3 quotes keyed by CMC id", () => {
    const parsed = parseCoinMarketCapQuotes(
      {
        data: {
          "1": {
            id: 1,
            name: "Bitcoin",
            symbol: "BTC",
            slug: "bitcoin",
            quote: { USD: { price: 64000, percent_change_24h: 2 } },
          },
        },
      },
      new Date("2026-09-10T00:00:00Z"),
    );
    expect(parsed.evidence[0]?.adapterPayload?.canonicalId).toBe("coingecko:bitcoin");
    expect(parsed.evidence[0]?.adapterPayload?.change24h).toBe(2);
  });
});
