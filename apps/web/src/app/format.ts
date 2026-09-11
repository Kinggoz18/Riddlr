export const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export const money = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export const compactMoney = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export type AssetOption = {
  canonicalId: string;
  symbol: string;
  name: string;
};

export const ASSET_CATALOG: AssetOption[] = [
  { canonicalId: "coingecko:bitcoin", symbol: "BTC", name: "Bitcoin" },
  { canonicalId: "coingecko:ethereum", symbol: "ETH", name: "Ethereum" },
  { canonicalId: "coingecko:solana", symbol: "SOL", name: "Solana" },
  { canonicalId: "coingecko:tether", symbol: "USDT", name: "Tether" },
  { canonicalId: "coingecko:usd-coin", symbol: "USDC", name: "USD Coin" },
  { canonicalId: "coingecko:binancecoin", symbol: "BNB", name: "BNB" },
  { canonicalId: "coingecko:ripple", symbol: "XRP", name: "XRP" },
  { canonicalId: "coingecko:dogecoin", symbol: "DOGE", name: "Dogecoin" },
];

export function assetLabel(canonicalId: string) {
  const known = ASSET_CATALOG.find((item) => item.canonicalId === canonicalId);
  if (known) {
    return `${known.name} · ${known.symbol}`;
  }
  const local = canonicalId.split(":")[1];
  return local ? local.replace(/-/g, " ") : canonicalId;
}

export function resolveAssetInput(raw: string): string | undefined {
  const value = raw.trim().toLowerCase().replace(/^\$/, "");
  if (!value) {
    return undefined;
  }
  const known = ASSET_CATALOG.find(
    (item) =>
      item.canonicalId === value ||
      item.symbol.toLowerCase() === value ||
      item.name.toLowerCase() === value ||
      item.canonicalId.split(":")[1] === value,
  );
  if (known) {
    return known.canonicalId;
  }
  if (/^[a-z][a-z0-9-]{1,32}:[a-z0-9][a-z0-9._-]{0,127}$/.test(value)) {
    return value;
  }
  return undefined;
}

export function eventStatusLabel(status: string) {
  switch (status) {
    case "needs_analysis":
      return "Needs analysis";
    case "analyzed":
      return "Analyzed";
    case "immaterial":
      return "Not material";
    case "empty":
      return "No evidence";
    case "abandoned":
      return "Skipped";
    default:
      return status;
  }
}

export function independenceCopy(independent: number, derived: number) {
  return `${independent} independent source${independent === 1 ? "" : "s"} · ${derived} reprint${derived === 1 ? "" : "s"}`;
}

export function adapterLabel(adapterId: string) {
  switch (adapterId) {
    case "searxng":
      return "SearXNG";
    case "discord":
      return "Discord";
    case "x":
      return "X";
    case "coingecko":
      return "CoinGecko";
    case "coinmarketcap":
      return "CoinMarketCap";
    case "cryptocom":
      return "Crypto.com Exchange";
    default:
      return adapterId;
  }
}

export function marketProviderLabel(provider: string | null | undefined) {
  if (!provider) {
    return "No live market source";
  }
  return adapterLabel(provider);
}

export function channelLabel(id: string) {
  return id.length > 6 ? `Channel · ${id.slice(-4)}` : id;
}

export function handleLabel(value: string) {
  return `@${value.replace(/^@/, "")}`;
}
