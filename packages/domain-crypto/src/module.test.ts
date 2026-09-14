import { normalizeEvidence, type RegistryAsset } from "@riddlr/domain";
import { describe, expect, it } from "vitest";
import {
  cryptoDomainModule,
  DEFAULT_CRYPTO_WATCHLIST,
  snapshotSpacesForWatchlist,
} from "./module.js";

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

  it("extracts a listing-or-delisting claim from a complete document", () => {
    const claims = cryptoDomainModule.extractClaims(
      [
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
      ],
      CRYPTO_REGISTRY,
    );
    expect(claims.some((item) => item.kind === "crypto:listing_or_delisting")).toBe(true);
    expect(cryptoDomainModule.mapClaimKindToCatalyst("crypto:listing_or_delisting")).toBe(
      "listing_or_delisting",
    );
  });

  it("extracts a governance proposal with votes from native-complete Snapshot evidence", () => {
    const claims = cryptoDomainModule.extractClaims(
      [
        normalizeEvidence({
          sourceFamily: "governance",
          adapterId: "snapshot",
          title: "Snapshot vote in Grove",
          bodyText:
            "Snapshot vote in Grove (grovefinance.eth). Governance proposal state active. 12 votes. A proposal body.",
          fetchedAt: new Date("2026-09-14T00:00:00Z"),
          url: "https://snapshot.box/#/s:grovefinance.eth/proposal/0xabc",
          contentCompleteness: "native_complete",
        }),
      ],
      CRYPTO_REGISTRY,
    );
    const gov = claims.find((item) => item.kind === "crypto:governance_proposal");
    expect(gov?.value).toBe(12);
    expect(gov?.unit).toBe("votes");
    expect(cryptoDomainModule.mapClaimKindToCatalyst("crypto:governance_proposal")).toBe(
      "governance_proposal",
    );
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
    expect(
      cryptoDomainModule.assessImpact({
        claims: [
          {
            marketDomainId: "crypto",
            kind: "crypto:observed_spot_price_anomaly",
            predicate: "return_shock",
            polarity: "asserted",
            modality: "asserted",
            fingerprint: "obs",
            title: "bitcoin 4.25σ spot price return shock (v1, threshold 3σ)",
          },
        ],
        assets: [{ assetClass: "cryptocurrency", canonicalId: "coingecko:bitcoin" }],
        observations: [],
        watchlistOverlap: true,
        portfolioOverlap: false,
        hasTrustedFirsthand: false,
        stale: false,
        contradicted: false,
        retracted: false,
      }).level,
    ).toBe("moderate");
  });

  it("keeps crypto search fallbacks on the domain module", () => {
    expect(cryptoDomainModule.sourceQuery({ adapterId: "searxng", watchlist: [] })).toContain(
      "cryptocurrency bitcoin ethereum stablecoin news",
    );
    expect(cryptoDomainModule.sourceQueries({ adapterId: "searxng", watchlist: [] })).toEqual([
      "cryptocurrency bitcoin ethereum stablecoin news (hack OR exploit OR depeg OR listing OR SEC OR lawsuit OR outage OR unlock)",
    ]);
    expect(
      cryptoDomainModule.sourceQueries({
        adapterId: "searxng",
        watchlist: DEFAULT_CRYPTO_WATCHLIST,
      }),
    ).toEqual([
      '"Bitcoin" OR "BTC" (hack OR exploit OR depeg OR listing OR SEC OR lawsuit OR outage OR unlock)',
      '"Ethereum" OR "ETH" (hack OR exploit OR depeg OR listing OR SEC OR lawsuit OR outage OR unlock)',
      '"Tether" OR "USDT" (hack OR exploit OR depeg OR listing OR SEC OR lawsuit OR outage OR unlock)',
      "cryptocurrency bitcoin ethereum stablecoin news (hack OR exploit OR depeg OR listing OR SEC OR lawsuit OR outage OR unlock)",
    ]);
    expect(
      cryptoDomainModule.sourceQueries({
        adapterId: "searxng",
        watchlist: Array.from({ length: 15 }, (_, index) => ({
          assetClass: "cryptocurrency" as const,
          canonicalId: `coingecko:asset-${index}`,
          symbol: `A${index}`,
          displayName: `Asset ${index}`,
        })),
      }),
    ).toHaveLength(13);
    expect(cryptoDomainModule.sourceQuery({ adapterId: "x", watchlist: [] })).toBe("crypto");
    expect(cryptoDomainModule.sourceQuery({ adapterId: "feeds", watchlist: [] })).toBe("");
    expect(cryptoDomainModule.sourceQuery({ adapterId: "defillama", watchlist: [] })).toBe("");
    expect(cryptoDomainModule.sourceQuery({ adapterId: "hyperliquid", watchlist: [] })).toBe("");
    expect(cryptoDomainModule.sourceQuery({ adapterId: "polymarket", watchlist: [] })).toBe("");
    expect(cryptoDomainModule.sourceQuery({ adapterId: "kalshi", watchlist: [] })).toBe("");
    expect(cryptoDomainModule.sourceQuery({ adapterId: "snapshot", watchlist: [] })).toBe("");
    expect(cryptoDomainModule.sourceQuery({ adapterId: "alchemy", watchlist: [] })).toBe("");
    expect(cryptoDomainModule.sourceQuery({ adapterId: "helius", watchlist: [] })).toBe("");
  });

  it("maps Snapshot spaces from the watchlist and registry external ids", () => {
    const derived = snapshotSpacesForWatchlist(
      [{ canonicalId: "coingecko:aave" }, { canonicalId: "coingecko:bitcoin" }],
      [
        {
          ...registryAsset("bitcoin", "BTC", "Bitcoin"),
          externalIds: { coingeckoId: "bitcoin", snapshotSpaces: ["customdao.eth"] },
        },
      ],
    );
    expect(derived.spaces).toEqual(["aave.eth", "customdao.eth"]);
    expect(derived.spaceAssets["aave.eth"]).toBe("coingecko:aave");
    expect(derived.spaceAssets["customdao.eth"]).toBe("coingecko:bitcoin");
  });

  it("keeps odds_jump impact low unless both venues agree on a watched asset", () => {
    const claim = {
      marketDomainId: "crypto" as const,
      kind: "crypto:macro_policy_decision",
      predicate: "odds_jump",
      polarity: "asserted" as const,
      modality: "asserted" as const,
      fingerprint: "odds",
      title: "fed rate hike in 2026 16.00 pp odds jump in 1h (v1, threshold 15 pp)",
      objectText: "up z=16.00",
    };
    const base = {
      claims: [claim],
      assets: [{ assetClass: "cryptocurrency" as const, canonicalId: "coingecko:bitcoin" }],
      observations: [],
      watchlistOverlap: true,
      portfolioOverlap: false,
      hasTrustedFirsthand: false,
      stale: false,
      contradicted: false,
      retracted: false,
    };
    expect(cryptoDomainModule.assessImpact(base).level).toBe("low");
    expect(cryptoDomainModule.assessImpact(base).reason).toBe("odds_jump");
    expect(
      cryptoDomainModule.assessImpact({
        ...base,
        claims: [{ ...claim, objectText: "up z=16.00 agreed" }],
      }).level,
    ).toBe("moderate");
    expect(
      cryptoDomainModule.assessImpact({
        ...base,
        claims: [{ ...claim, objectText: "up z=16.00 agreed" }],
      }).reason,
    ).toBe("odds_jump_agreed");
    expect(
      cryptoDomainModule.assessImpact({
        ...base,
        watchlistOverlap: false,
        claims: [{ ...claim, objectText: "up z=16.00 agreed" }],
      }).level,
    ).toBe("low");
  });

  it("keeps Snapshot governance impact moderate unless the title is treasury-scale", () => {
    const claim = {
      marketDomainId: "crypto" as const,
      kind: "crypto:governance_proposal",
      predicate: "governance_proposal",
      polarity: "asserted" as const,
      modality: "asserted" as const,
      fingerprint: "gov",
      title: "Snapshot vote in Grove",
      objectText: "governance proposal",
    };
    expect(
      cryptoDomainModule.assessImpact({
        claims: [claim],
        assets: [],
        observations: [],
        watchlistOverlap: true,
        portfolioOverlap: false,
        hasTrustedFirsthand: true,
        stale: false,
        contradicted: false,
        retracted: false,
      }).level,
    ).toBe("moderate");
    expect(
      cryptoDomainModule.assessImpact({
        claims: [{ ...claim, title: "Treasury emission upgrade and fee-switch" }],
        assets: [],
        observations: [],
        watchlistOverlap: true,
        portfolioOverlap: false,
        hasTrustedFirsthand: true,
        stale: false,
        contradicted: false,
        retracted: false,
      }).level,
    ).toBe("high");
  });

  it("keeps exchange inflows low and unlabeled large transfers moderate", () => {
    const base = {
      marketDomainId: "crypto" as const,
      kind: "crypto:large_transfer",
      predicate: "large_transfer",
      polarity: "asserted" as const,
      modality: "asserted" as const,
      fingerprint: "xfer",
      title: "USDC transfer",
      objectText: "0xabc → 0xdef",
      value: 1_000_000,
      unit: "usd",
    };
    expect(
      cryptoDomainModule.assessImpact({
        claims: [{ ...base, objectText: "Binance 14 → labeled exchange_inflow" }],
        assets: [],
        observations: [],
        watchlistOverlap: true,
        portfolioOverlap: false,
        hasTrustedFirsthand: true,
        stale: false,
        contradicted: false,
        retracted: false,
      }).level,
    ).toBe("low");
    expect(
      cryptoDomainModule.assessImpact({
        claims: [base],
        assets: [],
        observations: [],
        watchlistOverlap: true,
        portfolioOverlap: false,
        hasTrustedFirsthand: true,
        stale: false,
        contradicted: false,
        retracted: false,
      }).level,
    ).toBe("moderate");
    expect(
      cryptoDomainModule.assessImpact({
        claims: [{ ...base, objectText: "treasury → unknown treasury_outflow", value: 2_000_000 }],
        assets: [],
        observations: [],
        watchlistOverlap: true,
        portfolioOverlap: false,
        hasTrustedFirsthand: true,
        stale: false,
        contradicted: false,
        retracted: false,
      }).level,
    ).toBe("high");
    expect(
      cryptoDomainModule.assessImpact({
        claims: [{ ...base, objectText: "unknown → unknown", value: 10_000_000 }],
        assets: [],
        observations: [],
        watchlistOverlap: true,
        portfolioOverlap: false,
        hasTrustedFirsthand: true,
        stale: false,
        contradicted: false,
        retracted: false,
      }).level,
    ).toBe("high");
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
      cryptoDomainModule.normalizeClaim(
        {
          kind: "crypto:observed_tvl_anomaly",
          predicate: "tvl_drawdown",
          polarity: "asserted",
          modality: "asserted",
          excerpt: "TVL down 20% in 24h",
        },
        evidence,
      ),
    ).toBeUndefined();
    expect(
      cryptoDomainModule.normalizeClaim(
        {
          kind: "observed_anomaly",
          predicate: "return_shock",
          polarity: "asserted",
          modality: "asserted",
          excerpt: "z=4.25 over 20 spot_price samples",
          value: 4.25,
          unit: "sigma",
          subjectCanonicalId: "coingecko:bitcoin",
        },
        evidence,
        CRYPTO_REGISTRY,
      ),
    ).toBeUndefined();
    expect(
      cryptoDomainModule.normalizeClaim(
        {
          kind: "peg_deviation",
          predicate: "peg_change",
          polarity: "asserted",
          modality: "asserted",
          excerpt: "Tether depegged from the dollar",
          subjectCanonicalId: "coingecko:tether",
        },
        evidence,
        CRYPTO_REGISTRY,
      ),
    ).toBeUndefined();
    const peg = cryptoDomainModule.normalizeClaim(
      {
        kind: "peg_deviation",
        predicate: "peg_change",
        polarity: "asserted",
        modality: "asserted",
        excerpt: "Tether depegged from the dollar",
        subjectCanonicalId: "coingecko:tether",
        value: 0.92,
        unit: "usd",
      },
      evidence,
      CRYPTO_REGISTRY,
    );
    expect(peg?.kind).toBe("crypto:stablecoin_peg_change");
    expect(peg?.value).toBe(0.92);
    expect(peg?.unit).toBe("usd");
    const listing = cryptoDomainModule.normalizeClaim(
      {
        kind: "listing_or_delisting",
        predicate: "listing_or_delisting",
        polarity: "asserted",
        modality: "asserted",
        excerpt: "A model said return_shock.v1 fired at z=4.25 over 20 spot_price samples.",
        subjectCanonicalId: "coingecko:bitcoin",
      },
      evidence,
      CRYPTO_REGISTRY,
    );
    expect(listing?.kind).toBe("crypto:listing_or_delisting");
    const macro = cryptoDomainModule.normalizeClaim(
      {
        kind: "macro_policy_decision",
        predicate: "macro_policy_decision",
        polarity: "asserted",
        modality: "asserted",
        excerpt: "A model said return_shock.v1 fired at z=4.25 over 20 spot_price samples.",
      },
      evidence,
    );
    expect(macro?.kind).toBe("crypto:macro_policy_decision");
    expect(macro?.subjectCanonicalId).toBeUndefined();
    expect(
      cryptoDomainModule.normalizeClaim(
        {
          kind: "security_incident",
          predicate: "security_incident",
          polarity: "asserted",
          modality: "asserted",
          excerpt: "A model said return_shock.v1 fired at z=4.25 over 20 spot_price samples.",
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
