export const WATCHLIST_PREVIEW_LIMIT = 8;
export const WATCHLIST_TILE_LIMIT = 4;

export type WatchlistAsset = {
  canonicalId: string;
  assetClass?: string | null;
  symbol?: string | null;
  name?: string | null;
  lastQuote?: { value: number; unit: string; observedAt: string; provider: string };
};

export type WatchlistSummary = {
  id: string;
  name: string;
  agentId: string;
  agentName: string;
  items?: WatchlistAsset[];
};

export function previewWatchlist<T>(items: T[], limit = WATCHLIST_PREVIEW_LIMIT) {
  return {
    shown: items.slice(0, limit),
    remaining: Math.max(0, items.length - limit),
  };
}

export function summarizeWatchlistLabels(labels: string[], preview = 3) {
  if (labels.length === 0) {
    return "empty watchlist";
  }
  const shown = labels.slice(0, preview);
  const remaining = labels.length - preview;
  return remaining > 0 ? `${shown.join(" · ")} · +${remaining} more` : shown.join(" · ");
}
