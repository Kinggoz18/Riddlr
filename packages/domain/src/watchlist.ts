import { takeBounded } from "./limits.js";

export const MAX_WATCHLIST_ITEMS = 50;
export const CANONICAL_ASSET_ID_RE = /^[a-z][a-z0-9-]{1,32}:[a-z0-9][a-z0-9._-]{0,127}$/;

export class InvalidWatchlistItemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWatchlistItemError";
  }
}

export function assertCanonicalAssetId(value: string): string {
  if (!CANONICAL_ASSET_ID_RE.test(value)) {
    throw new InvalidWatchlistItemError(
      "Watchlist items require a canonical id such as coingecko:bitcoin, not a bare ticker.",
    );
  }
  return value;
}

export function watchlistSearchQuery(
  items: Array<{ symbol?: string | null; name?: string | null; canonicalId: string }>,
  fallback: string,
): string {
  const terms: string[] = [];
  for (const item of takeBounded(items, 12)) {
    if (item.symbol) {
      terms.push(item.symbol);
    }
    if (item.name) {
      terms.push(item.name);
    }
    const local = item.canonicalId.split(":")[1];
    if (local) {
      terms.push(local.replace(/-/g, " "));
    }
  }
  const unique = [...new Set(terms.map((term) => term.trim().toLowerCase()).filter(Boolean))];
  return unique.length > 0 ? takeBounded(unique, 8).join(" ") : fallback;
}
