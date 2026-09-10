import {
  DEFAULT_AGENT_NAME,
  type DomainModule,
  type ExtractedAsset,
  type MarketObservation,
  type NormalizedEvidence,
  takeBounded,
} from "@riddlr/domain";

const KNOWN: Record<string, ExtractedAsset> = {
  btc: {
    assetClass: "cryptocurrency",
    canonicalId: "coingecko:bitcoin",
    symbol: "BTC",
    displayName: "Bitcoin",
  },
  bitcoin: {
    assetClass: "cryptocurrency",
    canonicalId: "coingecko:bitcoin",
    symbol: "BTC",
    displayName: "Bitcoin",
  },
  eth: {
    assetClass: "cryptocurrency",
    canonicalId: "coingecko:ethereum",
    symbol: "ETH",
    displayName: "Ethereum",
  },
  ethereum: {
    assetClass: "cryptocurrency",
    canonicalId: "coingecko:ethereum",
    symbol: "ETH",
    displayName: "Ethereum",
  },
  sol: {
    assetClass: "cryptocurrency",
    canonicalId: "coingecko:solana",
    symbol: "SOL",
    displayName: "Solana",
  },
  usdt: {
    assetClass: "stablecoin",
    canonicalId: "coingecko:tether",
    symbol: "USDT",
    displayName: "Tether",
  },
  usdc: {
    assetClass: "stablecoin",
    canonicalId: "coingecko:usd-coin",
    symbol: "USDC",
    displayName: "USD Coin",
  },
};

const TOKEN_RE = /\b(bitcoin|ethereum|solana|btc|eth|sol|usdt|usdc|meme coin|stablecoin)\b/gi;
const CRYPTO_ASSET_CLASSES = ["cryptocurrency", "meme_coin", "stablecoin"] as const;

export const cryptoDomainModule: DomainModule = {
  id: "crypto",
  assetClasses: [...CRYPTO_ASSET_CLASSES],
  canonicalizeAsset(input) {
    if (input.canonicalId) {
      const known = Object.values(KNOWN).find((item) => item.canonicalId === input.canonicalId);
      if (known) {
        return known;
      }
      if (!input.name && !input.symbol) {
        return undefined;
      }
      const assetClass =
        CRYPTO_ASSET_CLASSES.find((item) => item === input.assetClass) ?? "cryptocurrency";
      return {
        assetClass,
        canonicalId: input.canonicalId,
        symbol: input.symbol,
        displayName: input.name,
      };
    }
    const key = (input.symbol ?? input.name ?? "").toLowerCase();
    return KNOWN[key];
  },
  extractAssets(evidence: NormalizedEvidence[]) {
    const found = new Map<string, ExtractedAsset>();
    for (const item of evidence) {
      const haystack = `${item.title ?? ""} ${item.bodyText ?? ""}`;
      for (const match of haystack.matchAll(TOKEN_RE)) {
        const key = match[0].toLowerCase();
        const asset =
          KNOWN[key] ??
          (key.includes("meme")
            ? {
                assetClass: "meme_coin" as const,
                canonicalId: "crypto:meme-narrative",
                displayName: "Meme coins",
              }
            : undefined);
        if (asset) {
          found.set(asset.canonicalId, asset);
        }
      }
    }
    return [...found.values()];
  },
  extractObservations(evidence: NormalizedEvidence[]) {
    const observations: MarketObservation[] = [];
    for (const item of evidence) {
      const hay = `${item.title ?? ""} ${item.bodyText ?? ""}`;
      const sourceId = item.canonicalUrl ?? item.externalId ?? item.contentHash;
      const assetCanonicalId = this.extractAssets([item])[0]?.canonicalId;
      const observedAt = item.publishedAt ?? item.fetchedAt;
      const negated =
        /\b(no|not|without|isn't|is not)\b.{0,24}\b(depeg|hack|exploit|insolvent)/i.test(hay);
      const funding = /funding rate\s+(-?\d+(?:\.\d+)?)\s*%/i.exec(hay);
      if (funding?.[1]) {
        observations.push({
          kind: "funding_rate",
          value: Number(funding[1]),
          unit: "percent",
          observedAt,
          sourceId,
          assetCanonicalId,
        });
      }
      const price = /(?:usd|usdt|\$)\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/i.exec(hay);
      if (price?.[1] && assetCanonicalId) {
        observations.push({
          kind: "quoted_price",
          value: Number(price[1].replaceAll(",", "")),
          unit: "usd",
          observedAt,
          sourceId,
          assetCanonicalId,
        });
      }
      if (!negated && /\bdepeg(?:ged|ging)?\b/i.test(hay)) {
        observations.push({
          kind: "stablecoin_depeg_mentioned",
          value: true,
          observedAt,
          sourceId,
          assetCanonicalId,
        });
      }
      if (/\bopen interest\b/i.test(hay)) {
        observations.push({
          kind: "open_interest_mentioned",
          value: true,
          observedAt,
          sourceId,
          assetCanonicalId,
        });
      }
      if (/\bperpetual(?:s)?\b|\bperps?\b/i.test(hay)) {
        observations.push({
          kind: "derivatives_mentioned",
          value: true,
          observedAt,
          sourceId,
          assetCanonicalId,
        });
      }
    }
    return takeBounded(observations, 20);
  },
  assembleContext({ evidence, assets, observations, watchlist = [] }) {
    const notes = [
      `Independent evidence items: ${evidence.length}`,
      `Resolved crypto assets: ${assets.map((item) => item.canonicalId).join(", ") || "none"}`,
      `Watchlist: ${watchlist.map((item) => item.canonicalId).join(", ") || "none"}`,
      `Sourced observations: ${observations.map((item) => item.kind).join(", ") || "none"}`,
    ];
    return {
      domainId: "crypto",
      observations,
      notes,
    };
  },
  defaultAgentProfile() {
    return {
      name: DEFAULT_AGENT_NAME,
      objectives: [
        "general_crypto_intelligence",
        "emerging_narratives",
        "major_events",
        "significant_market_changes",
        "risk_signals",
        "cross_source_corroboration",
      ],
      assetClasses: ["cryptocurrency", "meme_coin", "stablecoin"],
    };
  },
};
