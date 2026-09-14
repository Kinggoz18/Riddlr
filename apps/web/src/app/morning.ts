export const MORNING_LAST_VISIT_KEY = "riddlr.morning.lastVisit";

export function assetPagePath(canonicalId: string) {
  return `/assets/${encodeURIComponent(canonicalId)}`;
}

export function readMorningSince(storage: Pick<Storage, "getItem">): string | undefined {
  try {
    const value = storage.getItem(MORNING_LAST_VISIT_KEY);
    return value || undefined;
  } catch {
    return undefined;
  }
}

export function stampMorningVisit(storage: Pick<Storage, "setItem">, now = new Date()) {
  try {
    storage.setItem(MORNING_LAST_VISIT_KEY, now.toISOString());
  } catch {
    return;
  }
}
