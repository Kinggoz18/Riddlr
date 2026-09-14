export const MARKET_DOMAIN_IDS = ["crypto", "equities", "forex", "commodities", "macro"] as const;

export type MarketDomainId = (typeof MARKET_DOMAIN_IDS)[number];

export const DOMAIN_STATUSES = ["supported", "coming_soon"] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

export const ASSET_CLASSES = [
  "cryptocurrency",
  "meme_coin",
  "stablecoin",
  "fiat_currency",
  "forex_pair",
  "stock",
  "etf",
  "commodity",
  "index",
] as const;

export type AssetClass = (typeof ASSET_CLASSES)[number];

export const ASSET_CLASS_DOMAIN: Record<AssetClass, MarketDomainId> = {
  cryptocurrency: "crypto",
  meme_coin: "crypto",
  stablecoin: "crypto",
  fiat_currency: "forex",
  forex_pair: "forex",
  stock: "equities",
  etf: "equities",
  commodity: "commodities",
  index: "equities",
};

export type MarketDomainDefinition = {
  id: MarketDomainId;
  name: string;
  description: string;
  status: DomainStatus;
  supported: boolean;
  comingSoon: boolean;
  selectable: boolean;
  availableAssetClasses: AssetClass[];
  availableSourceFamilies: string[];
  documentationReference: string;
};

export const MARKET_DOMAIN_REGISTRY: readonly MarketDomainDefinition[] = [
  {
    id: "crypto",
    name: "Crypto",
    description:
      "Cryptocurrencies, meme coins, stablecoins, crypto narratives, and crypto market events.",
    status: "supported",
    supported: true,
    comingSoon: false,
    selectable: true,
    availableAssetClasses: ["cryptocurrency", "meme_coin", "stablecoin"],
    availableSourceFamilies: ["search", "discord", "x", "market", "filing"],
    documentationReference: "/docs/market-domains.md",
  },
  {
    id: "equities",
    name: "Equities",
    description: "Stocks, ETFs, and indexes. SEC EDGAR filings and OpenFIGI identifiers.",
    status: "supported",
    supported: true,
    comingSoon: false,
    selectable: true,
    availableAssetClasses: ["stock", "etf", "index"],
    availableSourceFamilies: ["filing", "feed", "search"],
    documentationReference: "/docs/market-domains.md",
  },
  {
    id: "forex",
    name: "Forex",
    description: "Fiat currencies and FX pairs. Planned domain — not executable.",
    status: "coming_soon",
    supported: false,
    comingSoon: true,
    selectable: false,
    availableAssetClasses: ["fiat_currency", "forex_pair"],
    availableSourceFamilies: ["search"],
    documentationReference: "/docs/market-domains.md",
  },
  {
    id: "commodities",
    name: "Commodities",
    description: "Commodity markets. Planned domain — not executable.",
    status: "coming_soon",
    supported: false,
    comingSoon: true,
    selectable: false,
    availableAssetClasses: ["commodity"],
    availableSourceFamilies: ["search"],
    documentationReference: "/docs/market-domains.md",
  },
  {
    id: "macro",
    name: "Macro",
    description:
      "Inflation, rates, employment, and policy context. Planned domain — not executable.",
    status: "coming_soon",
    supported: false,
    comingSoon: true,
    selectable: false,
    availableAssetClasses: ["fiat_currency", "index"],
    availableSourceFamilies: ["search"],
    documentationReference: "/docs/market-domains.md",
  },
] as const;

export function getMarketDomain(id: MarketDomainId): MarketDomainDefinition {
  const found = MARKET_DOMAIN_REGISTRY.find((item) => item.id === id);
  if (!found) {
    throw new Error(`Unknown market domain: ${id}`);
  }
  return found;
}

export function isSupportedMarketDomain(id: string): id is MarketDomainId {
  return MARKET_DOMAIN_REGISTRY.some((item) => item.id === id && item.supported);
}

export class UnsupportedMarketDomainError extends Error {
  readonly domainId: string;

  constructor(domainId: string) {
    super(`Market domain '${domainId}' is not supported and cannot execute.`);
    this.name = "UnsupportedMarketDomainError";
    this.domainId = domainId;
  }
}

export function assertSupportedMarketDomains(ids: string[]): MarketDomainId[] {
  const supported: MarketDomainId[] = [];
  for (const id of ids) {
    if (!isSupportedMarketDomain(id)) {
      throw new UnsupportedMarketDomainError(id);
    }
    supported.push(id);
  }
  if (supported.length === 0) {
    throw new UnsupportedMarketDomainError("(none)");
  }
  return supported;
}

export const DEFAULT_MARKET_DOMAIN: MarketDomainId = "crypto";
