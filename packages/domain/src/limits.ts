export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_SCAN_EVIDENCE_LIMIT = 50;
export const DEFAULT_ANALYSIS_EVIDENCE_LIMIT = 20;
export const DEFAULT_WORKER_CONCURRENCY = 2;
export const DEFAULT_SCAN_SOURCE_LIMIT = 16;
export const MAX_WORKER_CONCURRENCY = 8;
export const MAX_EVENTS_PER_SCAN = 8;
export const MAX_OBSERVATIONS_PER_EVENT = 20;
export const MAX_PORTFOLIOS = 8;
export const MAX_PORTFOLIO_WALLETS = 16;
export const MAX_PORTFOLIO_HOLDINGS = 50;
export const DEFAULT_REGISTRY_TOP_N = 1_000;
export const MAX_REGISTRY_TOP_N = 2_000;
export const MAX_REGISTRY_ASSETS = 4_000;
export const MAX_ALIASES_PER_ASSET = 32;
export const MAX_CAIP19_PER_ASSET = 16;
export const MAX_ASSETS_PER_DOCUMENT = 12;
export const MAX_ASSET_SEARCH_RESULTS = 20;
export const MAX_REGISTRY_LIST_BYTES = 8_000_000;
export const MAX_REGISTRY_MARKETS_PAGES = 8;
export const COINGECKO_MARKETS_PER_PAGE = 250;
export const DEFAULT_REGISTRY_SEED_INTERVAL_HOURS = 24;
export const MAX_REGISTRY_SEED_INTERVAL_HOURS = 168;
export const DEFAULT_OBSERVE_CONCURRENCY = 2;
export const MAX_OBSERVE_CONCURRENCY = 4;
export const DEFAULT_OBSERVE_BATCH_SIZE = 100;
export const MAX_OBSERVE_BATCH_SIZE = 100;
export const DEFAULT_OBSERVE_MAX_SUBJECTS = 1_000;
export const MAX_OBSERVE_SUBJECTS = 4_000;
export const DEFAULT_OBSERVE_RETENTION_DAYS = 90;
export const MIN_OBSERVE_RETENTION_DAYS = 14;
export const MAX_OBSERVE_RETENTION_DAYS = 365;
export const DEFAULT_OBSERVE_PRICE_INTERVAL_SECONDS = 60;
export const MIN_OBSERVE_PRICE_INTERVAL_SECONDS = 60;
export const MAX_OBSERVE_PRICE_INTERVAL_SECONDS = 300;
export const MAX_OBSERVE_PINS = 100;
export const MAX_SERIES_WINDOW = 512;
export const DEFAULT_DETECTOR_WINDOW = 20;
export const DEFAULT_DETECTOR_ABS_Z = 3;
export const MAX_RETENTION_DELETE_BATCH = 5_000;
export const MAX_RETENTION_LOOPS = 40;
export const OBSERVE_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const MAX_OBSERVE_BODY_BYTES = 1_000_000;

export function clampPageSize(value: unknown, fallback = DEFAULT_PAGE_SIZE): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(parsed)));
}

export function clampPositiveInt(
  value: unknown,
  fallback: number,
  max: number = Number.MAX_SAFE_INTEGER,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

export function takeBounded<T>(items: readonly T[], limit: number): T[] {
  return items.slice(0, Math.max(0, limit));
}

export function parsePageCursor(before?: string): Date | undefined {
  if (!before) {
    return undefined;
  }
  const value = new Date(before);
  return Number.isNaN(value.getTime()) ? undefined : value;
}
