import { MAX_SEARXNG_QUERY_CHARS } from "./limits.js";

export function quoteSearchTerm(value: string): string {
  const cleaned = value.replaceAll('"', "").replace(/\s+/g, " ").trim().slice(0, 80);
  return cleaned ? `"${cleaned}"` : "";
}

export function buildAssetNewsQuery(input: {
  name?: string | null;
  symbol?: string | null;
  canonicalId: string;
  keywords: readonly string[];
}): string {
  const name = quoteSearchTerm(input.name ?? "");
  const symbol = quoteSearchTerm(input.symbol ?? "");
  const local = quoteSearchTerm((input.canonicalId.split(":")[1] ?? "").replaceAll("-", " "));
  const identity = [...new Set([name, symbol].filter(Boolean))];
  if (identity.length === 0 && local) {
    identity.push(local);
  }
  const keywords = input.keywords.map((item) => item.replaceAll('"', "").trim()).filter(Boolean);
  const keywordClause = keywords.join(" OR ");
  const identityClause = identity.join(" OR ");
  const query = keywordClause ? `${identityClause} (${keywordClause})` : identityClause;
  return query.slice(0, MAX_SEARXNG_QUERY_CHARS);
}

export function buildDomainGeneralNewsQuery(fallback: string, keywords: readonly string[]): string {
  const keywordClause = keywords
    .map((item) => item.replaceAll('"', "").trim())
    .filter(Boolean)
    .join(" OR ");
  const cleaned = fallback.replaceAll('"', "").replace(/\s+/g, " ").trim();
  const query = keywordClause ? `${cleaned} (${keywordClause})` : cleaned;
  return query.slice(0, MAX_SEARXNG_QUERY_CHARS);
}
