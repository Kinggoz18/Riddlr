import { MAX_ASSETS_PER_DOCUMENT, type ResolverRules } from "@riddlr/domain";

export const EQUITIES_RESOLVER_RULES: ResolverRules = {
  minAliasLength: 2,
  cashtagMinLength: 1,
  ambiguousSymbols: ["a", "i", "on", "it", "for", "all", "one"],
  commonWordNames: ["apple", "target", "visa", "meta", "block"],
  perDocumentCap: MAX_ASSETS_PER_DOCUMENT,
};

export function equitiesAssetClassFor(title?: string | null): "stock" | "etf" {
  if (title && /\betf\b/i.test(title)) {
    return "etf";
  }
  return "stock";
}
