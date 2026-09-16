import { takeBounded } from "./limits.js";

export function aggregateIndependenceByOrigin(
  nodes: ReadonlyArray<{ hostname: string; role: string }>,
): Array<{ hostname: string; count: number; roles: string[] }> {
  const grouped = new Map<string, { count: number; roles: Set<string> }>();
  for (const node of takeBounded(nodes, 100)) {
    const current = grouped.get(node.hostname) ?? { count: 0, roles: new Set<string>() };
    current.count += 1;
    current.roles.add(node.role);
    grouped.set(node.hostname, current);
  }
  return [...grouped.entries()].map(([hostname, value]) => ({
    hostname,
    count: value.count,
    roles: [...value.roles],
  }));
}

export type OriginTrustRow = {
  key: string;
  label: string;
  hostname?: string;
  trustTier: string;
  count: number;
};

export function aggregateTrustByOrigin(
  items: ReadonlyArray<{
    evidenceId: string;
    originKey?: string | null;
    hostname?: string | null;
    displayName?: string | null;
    trustTier: string;
  }>,
): OriginTrustRow[] {
  const grouped = new Map<string, OriginTrustRow>();
  for (const item of takeBounded(items, 100)) {
    const key = item.originKey || item.hostname || item.evidenceId;
    const current = grouped.get(key);
    if (current) {
      current.count += 1;
      continue;
    }
    grouped.set(key, {
      key,
      label: item.displayName || item.hostname || item.originKey || "Unknown source",
      hostname: item.hostname ?? undefined,
      trustTier: item.trustTier,
      count: 1,
    });
  }
  return [...grouped.values()];
}
