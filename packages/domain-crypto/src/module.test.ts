import { normalizeEvidence, type RegistryAsset } from "@riddlr/domain";
import { describe, expect, it } from "vitest";
import { cryptoDomainModule } from "./module.js";

function registryAsset(
  id: string,
  symbol: string,
  name: string,
  assetClass: RegistryAsset["assetClass"] = "cryptocurrency",
): RegistryAsset {
  return {
    assetClass,
    canonicalId: `coingecko:${id}`,
    symbol,
    name,
    aliases: [symbol.toLowerCase(), name.toLowerCase(), `$${symbol.toLowerCase()}`, id],
    externalIds: { coingeckoId: id },
    marketCapRank: 1,
    status: "active",
  };
}

const CRYPTO_REGISTRY: RegistryAsset[] = [
  registryAsset("bitcoin", "BTC", "Bitcoin"),
  registryAsset("ethereum", "ETH", "Ethereum"),
  registryAsset("tether", "USDT", "Tether", "stablecoin"),
  registryAsset("solana", "SOL", "Solana"),
];

describe("crypto domain module", () => {
  it("canonicalizes BTC to a coingecko id, not a ticker-only identity", () => {
    expect(
      cryptoDomainModule.canonicalizeAsset({ symbol: "BTC" }, CRYPTO_REGISTRY)?.canonicalId,
    ).toBe("coingecko:bitcoin");
    expect(
      cryptoDomainModule.canonicalizeAsset(
        { canonicalId: "coingecko:unknown-coin" },
        CRYPTO_REGISTRY,
      ),
    ).toBeUndefined();
    expect(
      cryptoDomainModule.canonicalizeAsset(
        {
          canonicalId: "coingecko:unknown-coin",
          name: "Unknown Coin",
        },
        CRYPTO_REGISTRY,
      ),
    ).toBeUndefined();
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
    const observations = cryptoDomainModule.extractObservations(evidence, CRYPTO_REGISTRY);
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
    const observations = cryptoDomainModule.extractObservations(evidence, CRYPTO_REGISTRY);
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
    const assets = cryptoDomainModule.extractAssets(evidence, CRYPTO_REGISTRY);
    expect(assets.map((item) => item.canonicalId).sort()).toEqual([
      "coingecko:bitcoin",
      "coingecko:ethereum",
      "coingecko:tether",
    ]);
  });

  it("ships a real default crypto agent profile", () => {
    const profile = cryptoDomainModule.defaultAgentProfile();
    expect(profile.name).toBe("Riddlr Intelligence Agent");
    expect(profile.description.length).toBeGreaterThan(20);
    expect(profile.description).toMatch(/candidate is not a trade/i);
    expect(profile.assetClasses).toContain("stablecoin");
    expect(profile.objectives).toEqual(
      expect.arrayContaining([
        "potential_opportunities",
        "hidden_gems",
        "unusual_market_behaviour",
        "anomalies",
        "asset_specific_changes",
        "general_market_trends",
      ]),
    );
    expect(cryptoDomainModule.id).toBe("crypto");
  });

  it("skips snippet mentions when extracting claims", () => {
    const claims = cryptoDomainModule.extractClaims([
      normalizeEvidence({
        sourceFamily: "search",
        adapterId: "searxng",
        title: "Bitcoin ETF inflows accelerate",
        bodyText: "Bitcoin demand rose after reported ETF inflows covering US listed products.",
        fetchedAt: new Date("2026-09-13T00:00:00Z"),
        url: "https://example.com/bitcoin-etf",
        contentCompleteness: "snippet",
      }),
    ]);
    expect(claims).toEqual([]);
  });

  it("extracts a market-move claim from a complete document", () => {
    const claims = cryptoDomainModule.extractClaims([
      normalizeEvidence({
        sourceFamily: "search",
        adapterId: "searxng",
        title: "Bitcoin ETF inflows accelerate",
        bodyText:
          "Bitcoin demand rose after reported ETF inflows covering US listed products in the latest issuer filing.",
        fetchedAt: new Date("2026-09-13T00:00:00Z"),
        url: "https://example.com/bitcoin-etf",
        contentCompleteness: "full_document",
      }),
    ]);
    expect(claims.some((item) => item.kind === "crypto:market_move")).toBe(true);
  });

  it("does not treat a custody story and an ETF inflow story as the same claim", () => {
    const inflows = cryptoDomainModule.extractClaims([
      normalizeEvidence({
        sourceFamily: "search",
        adapterId: "searxng",
        title: "Bitcoin ETF inflows accelerate",
        bodyText:
          "Bitcoin demand rose after reported ETF inflows covering US listed products in the latest issuer filing.",
        fetchedAt: new Date("2026-09-13T00:00:00Z"),
        url: "https://example.com/bitcoin-etf",
        contentCompleteness: "full_document",
      }),
    ]);
    const custody = cryptoDomainModule.extractClaims([
      normalizeEvidence({
        sourceFamily: "search",
        adapterId: "searxng",
        title: "Bank of America custody",
        bodyText: "Bank of America announced a bitcoin custody mandate after a filing.",
        fetchedAt: new Date("2026-09-13T00:00:00Z"),
        url: "https://example.com/custody",
        contentCompleteness: "full_document",
      }),
    ]);
    expect(inflows[0]?.fingerprint).toBeDefined();
    expect(custody.some((item) => item.fingerprint === inflows[0]?.fingerprint)).toBe(false);
  });

  it("does not emit a generic report for a market profile page", () => {
    const claims = cryptoDomainModule.extractClaims([
      normalizeEvidence({
        sourceFamily: "search",
        adapterId: "searxng",
        title: "Bitcoin price",
        bodyText: "Live bitcoin price on Coinbase with charts and converter.",
        fetchedAt: new Date("2026-09-13T00:00:00Z"),
        url: "https://www.coinbase.com/price/bitcoin",
        contentCompleteness: "full_document",
      }),
    ]);
    expect(claims).toEqual([]);
    expect(claims.some((item) => item.kind === "crypto:general_report")).toBe(false);
  });

  it("computes critical impact for security, insolvency, and peg claims", () => {
    const evidence = normalizeEvidence({
      sourceFamily: "search",
      adapterId: "searxng",
      title: "Exchange hack",
      bodyText: "Hot wallet compromised after exploit.",
      fetchedAt: new Date("2026-09-13T00:00:00Z"),
      url: "https://example.com/hack",
      contentCompleteness: "full_document",
    });
    const security = cryptoDomainModule.extractClaims([evidence]);
    expect(
      cryptoDomainModule.assessImpact({
        claims: security,
        assets: [],
        observations: [],
        watchlistOverlap: false,
        portfolioOverlap: false,
        hasTrustedFirsthand: false,
        stale: false,
        contradicted: false,
        retracted: false,
      }).level,
    ).toBe("critical");
    const peg = cryptoDomainModule.extractClaims([
      normalizeEvidence({
        sourceFamily: "search",
        adapterId: "searxng",
        title: "USDT depeg",
        bodyText: "Tether depegged from the dollar after a reserve scare.",
        fetchedAt: new Date("2026-09-13T00:00:00Z"),
        url: "https://example.com/peg",
        contentCompleteness: "full_document",
      }),
    ]);
    expect(
      cryptoDomainModule.assessImpact({
        claims: peg,
        assets: [],
        observations: [],
        watchlistOverlap: false,
        portfolioOverlap: false,
        hasTrustedFirsthand: false,
        stale: false,
        contradicted: false,
        retracted: false,
      }).level,
    ).toBe("critical");
    expect(
      cryptoDomainModule.assessImpact({
        claims: cryptoDomainModule.extractClaims([
          normalizeEvidence({
            sourceFamily: "search",
            adapterId: "searxng",
            title: "Exchange insolvent",
            bodyText: "The venue is insolvent and halted withdrawals.",
            fetchedAt: new Date("2026-09-13T00:00:00Z"),
            url: "https://example.com/insolvent",
            contentCompleteness: "full_document",
          }),
        ]),
        assets: [],
        observations: [],
        watchlistOverlap: false,
        portfolioOverlap: false,
        hasTrustedFirsthand: false,
        stale: false,
        contradicted: false,
        retracted: false,
      }).level,
    ).toBe("critical");
  });

  it("keeps crypto search fallbacks on the domain module", () => {
    expect(cryptoDomainModule.sourceQuery({ adapterId: "searxng", watchlist: [] })).toContain(
      "cryptocurrency bitcoin ethereum stablecoin news",
    );
    expect(cryptoDomainModule.sourceQuery({ adapterId: "x", watchlist: [] })).toBe("crypto");
  });

  it("rejects observed-anomaly kinds on the document claim path", () => {
    const evidence = normalizeEvidence({
      sourceFamily: "search",
      adapterId: "searxng",
      title: "Bitcoin jumped",
      bodyText: "A model said return_shock.v1 fired at z=4.25 over 20 spot_price samples.",
      fetchedAt: new Date("2026-09-13T00:00:00Z"),
      url: "https://example.com/model",
      contentCompleteness: "full_document",
    });
    expect(
      cryptoDomainModule.normalizeClaim(
        {
          kind: "crypto:observed_spot_price_anomaly",
          predicate: "return_shock",
          polarity: "asserted",
          modality: "asserted",
          excerpt: "z=4.25 over 20 spot_price samples",
        },
        evidence,
      ),
    ).toBeUndefined();
    expect(
      cryptoDomainModule.normalizeClaim(
        {
          kind: "crypto:observed_quoted_volume_anomaly",
          predicate: "volume_anomaly",
          polarity: "asserted",
          modality: "asserted",
          excerpt: "z=4.25 over 20 quoted_volume samples",
        },
        evidence,
      ),
    ).toBeUndefined();
    expect(
      cryptoDomainModule
        .extractClaims([evidence])
        .some((item) => item.kind.startsWith("crypto:observed_")),
    ).toBe(false);
  });

  it("has no hardcoded token list and extracts a registry-only asset", () => {
    const evidence = [
      normalizeEvidence({
        sourceFamily: "search",
        adapterId: "searxng",
        title: "Solana outage",
        bodyText: "SOL validators halted.",
        fetchedAt: new Date(),
      }),
    ];
    expect(cryptoDomainModule.extractAssets(evidence).map((item) => item.canonicalId)).toEqual([]);
    expect(
      cryptoDomainModule.extractAssets(evidence, CRYPTO_REGISTRY).map((item) => item.canonicalId),
    ).toEqual(["coingecko:solana"]);
  });
});
