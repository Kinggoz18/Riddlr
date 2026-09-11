import { takeBounded } from "@riddlr/domain";

export const MAX_MARKET_IDS = 16;

export const USD_SPOT_INSTRUMENTS: Record<string, string> = {
  bitcoin: "BTC_USD",
  ethereum: "ETH_USD",
  solana: "SOL_USD",
  tether: "USDT_USD",
  "usd-coin": "USDC_USD",
};

export function geckoSlug(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith("coingecko:")) {
    const slug = trimmed.slice("coingecko:".length);
    return slug.length >= 2 ? slug : undefined;
  }
  if (trimmed.includes(":")) {
    return undefined;
  }
  return trimmed.length >= 2 ? trimmed : undefined;
}

export function marketSlugs(config: Record<string, unknown>, query: string): string[] {
  const fromConfig = Array.isArray(config.assetIds)
    ? config.assetIds.map((item) => geckoSlug(String(item))).filter(Boolean)
    : [];
  const fromQuery = query
    .split(/[,\s|]+/)
    .map((item) => geckoSlug(item))
    .filter(Boolean);
  return takeBounded([...new Set([...fromConfig, ...fromQuery])] as string[], MAX_MARKET_IDS);
}

export function usdSpotInstrument(slug: string): string | undefined {
  return USD_SPOT_INSTRUMENTS[slug];
}
