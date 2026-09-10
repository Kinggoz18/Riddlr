import { normalizeEvidence } from "@riddlr/domain";
import { describe, expect, it } from "vitest";
import { cryptoDomainModule } from "./module.js";

describe("crypto domain module", () => {
  it("canonicalizes BTC to a coingecko id, not a ticker-only identity", () => {
    expect(cryptoDomainModule.canonicalizeAsset({ symbol: "BTC" })?.canonicalId).toBe(
      "coingecko:bitcoin",
    );
    expect(
      cryptoDomainModule.canonicalizeAsset({ canonicalId: "coingecko:unknown-coin" }),
    ).toBeUndefined();
    expect(
      cryptoDomainModule.canonicalizeAsset({
        canonicalId: "coingecko:unknown-coin",
        name: "Unknown Coin",
      })?.canonicalId,
    ).toBe("coingecko:unknown-coin");
  });

  it("includes watchlist canonical ids in assembled context", () => {
    const context = cryptoDomainModule.assembleContext({
      evidence: [],
      assets: [],
      observations: [],
      watchlist: [
        {
          assetClass: "cryptocurrency",
          canonicalId: "coingecko:bitcoin",
          symbol: "BTC",
        },
      ],
    });
    expect(context.notes.some((note) => note.includes("coingecko:bitcoin"))).toBe(true);
  });

  it("extracts sourced derivatives mentions and does not invent a numeric observation", () => {
    const evidence = [
      normalizeEvidence({
        sourceFamily: "search",
        adapterId: "searxng",
        title: "Bitcoin perpetual funding rate 0.01% after open interest chatter",
        bodyText: "No depeg.",
        fetchedAt: new Date("2026-09-10T00:00:00Z"),
        url: "https://news.example/funding",
      }),
    ];
    const observations = cryptoDomainModule.extractObservations(evidence);
    expect(observations.some((item) => item.kind === "funding_rate" && item.value === 0.01)).toBe(
      true,
    );
    expect(observations.some((item) => item.kind === "open_interest_mentioned")).toBe(true);
    expect(observations.some((item) => item.kind === "derivatives_mentioned")).toBe(true);
    expect(observations.some((item) => item.kind === "stablecoin_depeg_mentioned")).toBe(false);
  });

  it("extracts a quoted price and refuses negated depeg mentions", () => {
    const evidence = [
      normalizeEvidence({
        sourceFamily: "search",
        adapterId: "searxng",
        title: "USDT holds $1.00 with no depeg after rumor",
        bodyText: "Tether trades at USD 1.00.",
        fetchedAt: new Date("2026-09-10T00:00:00Z"),
        url: "https://news.example/usdt",
      }),
    ];
    const observations = cryptoDomainModule.extractObservations(evidence);
    expect(observations.some((item) => item.kind === "quoted_price" && item.value === 1)).toBe(
      true,
    );
    expect(observations.some((item) => item.kind === "stablecoin_depeg_mentioned")).toBe(false);
  });

  it("extracts crypto assets from evidence text", () => {
    const evidence = [
      normalizeEvidence({
        sourceFamily: "search",
        adapterId: "searxng",
        title: "Bitcoin and USDT liquidity",
        bodyText: "ETH follows.",
        fetchedAt: new Date(),
      }),
    ];
    const assets = cryptoDomainModule.extractAssets(evidence);
    expect(assets.map((item) => item.canonicalId).sort()).toEqual([
      "coingecko:bitcoin",
      "coingecko:ethereum",
      "coingecko:tether",
    ]);
  });

  it("ships a real default crypto agent profile", () => {
    const profile = cryptoDomainModule.defaultAgentProfile();
    expect(profile.name).toBe("Riddlr Intelligence Agent");
    expect(profile.assetClasses).toContain("stablecoin");
    expect(cryptoDomainModule.id).toBe("crypto");
  });
});
