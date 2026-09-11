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
