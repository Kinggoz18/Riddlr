import { describe, expect, it } from "vitest";
import { parseCryptoComTickers } from "./cryptocom.js";

describe("Crypto.com Exchange public ticker adapter", () => {
  it("parses public/get-tickers last price and volume without treating it as a trade signal", () => {
    const parsed = parseCryptoComTickers(
      {
        id: -1,
        method: "public/get-tickers",
        code: 0,
        result: {
          data: [
            {
              i: "BTC_USD",
              a: "77082.02",
              vv: "366314005.62",
              c: "-0.0157",
              t: 1_789_101_934_681,
            },
          ],
        },
      },
      new Date("2026-09-10T00:00:00Z"),
    );
    expect(parsed.evidence[0]?.adapterPayload?.canonicalId).toBe("coingecko:bitcoin");
    expect(parsed.evidence[0]?.adapterPayload?.priceUsd).toBe(77082.02);
    expect(parsed.evidence[0]?.adapterPayload?.change24h).toBeCloseTo(-1.57);
  });
});
