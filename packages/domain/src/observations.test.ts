import { describe, expect, it } from "vitest";
import {
  oddsChangePercentagePoints,
  predictionMarketCatalystKind,
  resolvePredictionSubject,
} from "./observations.js";

describe("prediction market subject mapping", () => {
  it("maps unique watched asset names in the question onto the registry id", () => {
    expect(
      resolvePredictionSubject({
        text: "Will Bitcoin spot ETF inflows continue?",
        nativeCanonicalId: "polymarket:bitcoin-etf",
        watched: new Set(["coingecko:bitcoin", "coingecko:ethereum"]),
        hints: [
          { canonicalId: "coingecko:bitcoin", symbol: "BTC", name: "Bitcoin" },
          { canonicalId: "coingecko:ethereum", symbol: "ETH", name: "Ethereum" },
        ],
      }),
    ).toBe("coingecko:bitcoin");
  });

  it("keeps the native id when two watched assets match", () => {
    expect(
      resolvePredictionSubject({
        text: "Bitcoin versus Ethereum market cap",
        nativeCanonicalId: "polymarket:btc-eth",
        watched: new Set(["coingecko:bitcoin", "coingecko:ethereum"]),
        hints: [
          { canonicalId: "coingecko:bitcoin", symbol: "BTC", name: "Bitcoin" },
          { canonicalId: "coingecko:ethereum", symbol: "ETH", name: "Ethereum" },
        ],
      }),
    ).toBe("polymarket:btc-eth");
  });

  it("classifies SEC text as regulatory and Fed text as macro", () => {
    expect(predictionMarketCatalystKind("SEC lawsuit over a token listing")).toBe(
      "regulatory_or_legal_action",
    );
    expect(predictionMarketCatalystKind("Fed rate hike in 2026?")).toBe("macro_policy_decision");
  });

  it("measures odds change in percentage points, not percent of the prior odds", () => {
    expect(oddsChangePercentagePoints(0.5, 0.65)).toBeCloseTo(15, 10);
    expect(oddsChangePercentagePoints(0.905, 0.655)).toBeCloseTo(-25, 10);
  });
});
