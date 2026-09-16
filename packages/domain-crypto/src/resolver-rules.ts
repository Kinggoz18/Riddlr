import { MAX_ASSETS_PER_DOCUMENT, type ResolverRules } from "@riddlr/domain";

export const CRYPTO_HIGH_CONFIDENCE_SYMBOLS = [
  "btc",
  "eth",
  "sol",
  "xrp",
  "usdt",
  "usdc",
  "bnb",
  "ada",
  "ton",
  "avax",
  "dot",
  "atom",
  "ltc",
  "bch",
  "apt",
  "sui",
  "trx",
  "xlm",
] as const;

export const CRYPTO_RESOLVER_RULES: ResolverRules = {
  minAliasLength: 3,
  cashtagMinLength: 2,
  ambiguousSymbols: ["one", "gas", "sun", "ai", "usd", "link"],
  commonWordNames: ["render", "near", "flow", "ordinals"],
  highConfidenceSymbols: CRYPTO_HIGH_CONFIDENCE_SYMBOLS,
  perDocumentCap: MAX_ASSETS_PER_DOCUMENT,
};

const STABLE_SYMBOLS = new Set([
  "usdt",
  "usdc",
  "dai",
  "tusd",
  "usdp",
  "usdd",
  "pyusd",
  "fdusd",
  "busd",
  "gusd",
  "lusd",
]);

export function cryptoAssetClassFor(symbol?: string | null, name?: string | null) {
  const symbolKey = symbol?.trim().toLowerCase() ?? "";
  const nameKey = name?.trim().toLowerCase() ?? "";
  if (STABLE_SYMBOLS.has(symbolKey) || nameKey.includes("usd coin") || nameKey === "tether") {
    return "stablecoin" as const;
  }
  return "cryptocurrency" as const;
}
