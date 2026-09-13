import { createHash } from "node:crypto";
import type { EvidenceRole } from "./evidence.js";
import { normalizeText } from "./evidence.js";
import { takeBounded } from "./limits.js";

export const NEAR_DUPLICATE_THRESHOLD = 0.82;
export const CLUSTER_SIMILARITY_THRESHOLD = 0.45;
export const SHINGLE_SIZE = 5;
export const MAX_SHINGLE_STARTS = 2048;
export const MAX_EVIDENCE_CLUSTERS = 8;
export const MAX_CLUSTER_INPUT = 200;
export const CLUSTER_WINDOW_MS = 24 * 60 * 60 * 1000;

export function characterShingles(text: string, size = SHINGLE_SIZE): Set<string> {
  const normalized = normalizeText(text);
  if (normalized.length === 0) {
    return new Set();
  }
  if (normalized.length < size) {
    return new Set([normalized]);
  }
  const out = new Set<string>();
  const lastStart = Math.min(normalized.length - size, MAX_SHINGLE_STARTS);
  for (let index = 0; index <= lastStart; index += 1) {
    out.add(normalized.slice(index, index + size));
  }
  return out;
}

export function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) {
    return 1;
  }
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  let intersection = 0;
  for (const item of smaller) {
    if (larger.has(item)) {
      intersection += 1;
    }
  }
  return intersection / (left.size + right.size - intersection);
}

export function isNearDuplicate(
  left: string,
  right: string,
  threshold = NEAR_DUPLICATE_THRESHOLD,
): boolean {
  return jaccardSimilarity(characterShingles(left), characterShingles(right)) >= threshold;
}

export function sourceHostname(url?: string | null): string {
  if (!url) {
    return "unknown-host";
  }
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "unknown-host";
  }
}

export type ClusterableEvidence = {
  id: string;
  assetCanonicalIds: string[];
  text: string;
  publishedAt?: Date;
  hostname?: string;
  sourceFamily?: string;
  originKey?: string;
  claimFingerprints?: string[];
  claimGroupKeys?: string[];
  marketDomainId?: string;
};

function inTimeWindow(left?: Date, right?: Date): boolean {
  if (!left || !right) {
    return true;
  }
  return Math.abs(left.getTime() - right.getTime()) <= CLUSTER_WINDOW_MS;
}

export function clusterEvidence<T extends ClusterableEvidence>(
  items: readonly T[],
  maxClusters = MAX_EVIDENCE_CLUSTERS,
): { clusters: T[][]; remainder: T[] } {
  const bounded = takeBounded(items, MAX_CLUSTER_INPUT);
  const clusters: T[][] = [];
  const remainder: T[] = [];
  for (const item of bounded) {
    let assigned = false;
    for (const cluster of clusters) {
      const similarToCluster = cluster.some((member) => {
        if (!inTimeWindow(item.publishedAt, member.publishedAt)) {
          return false;
        }
        if (
          item.marketDomainId &&
          member.marketDomainId &&
          item.marketDomainId !== member.marketDomainId
        ) {
          return false;
        }
        const sharedClaim =
          item.claimFingerprints &&
          member.claimFingerprints &&
          item.claimFingerprints.some((fingerprint) =>
            member.claimFingerprints?.includes(fingerprint),
          );
        if (sharedClaim) {
          return true;
        }
        const sharedAsset =
          item.assetCanonicalIds.length > 0 &&
          member.assetCanonicalIds.some((id) => item.assetCanonicalIds.includes(id));
        return (
          (sharedAsset || item.claimFingerprints === undefined) &&
          isNearDuplicate(item.text, member.text, CLUSTER_SIMILARITY_THRESHOLD)
        );
      });
      if (similarToCluster) {
        cluster.push(item);
        assigned = true;
        break;
      }
    }
    if (assigned) {
      continue;
    }
    if (clusters.length < maxClusters) {
      clusters.push([item]);
      continue;
    }
    remainder.push(item);
  }
  return { clusters, remainder };
}

export function eventClusterFingerprint(input: {
  marketDomainId?: string;
  claimFingerprints?: string[];
  contentHashes?: string[];
  assetCanonicalIds?: string[];
  windowDay?: string;
}): string {
  const claims = [...new Set(input.claimFingerprints ?? [])].filter(Boolean).sort();
  const hashes = [...new Set(input.contentHashes ?? [])].filter(Boolean).sort();
  const assets = [...new Set(input.assetCanonicalIds ?? [])].sort();
  const identity = claims.join(",") || hashes.join(",") || assets.join(",") || "unlabeled";
  const basis = [input.marketDomainId ?? "", identity, input.windowDay ?? ""].join("|");
  return createHash("sha256").update(basis).digest("hex");
}

export function absorbMarketDataClusters<T extends ClusterableEvidence>(clusters: T[][]): T[][] {
  const news = clusters.filter((cluster) =>
    cluster.some((item) => item.sourceFamily !== "market_data"),
  );
  const market = clusters.filter(
    (cluster) => cluster.length > 0 && cluster.every((item) => item.sourceFamily === "market_data"),
  );
  for (const snapshot of market) {
    const ids = new Set(snapshot.flatMap((item) => item.assetCanonicalIds));
    const host = news.find((cluster) =>
      cluster.some((item) => item.assetCanonicalIds.some((id) => ids.has(id))),
    );
    if (host) {
      host.push(...snapshot);
    } else {
      news.push(snapshot);
    }
  }
  return news;
}

export function absorbObservationClusters<T extends ClusterableEvidence>(clusters: T[][]): T[][] {
  const rest: T[][] = [];
  const byAssets = new Map<string, T[]>();
  for (const cluster of clusters) {
    const observationOnly =
      cluster.length > 0 && cluster.every((item) => item.sourceFamily === "observation");
    const assets = [...new Set(cluster.flatMap((item) => item.assetCanonicalIds))]
      .filter(Boolean)
      .sort();
    if (!observationOnly || assets.length === 0) {
      rest.push(cluster);
      continue;
    }
    const key = assets.join(",");
    const host = byAssets.get(key);
    if (host) {
      host.push(...cluster);
    } else {
      byAssets.set(key, [...cluster]);
    }
  }
  return [...rest, ...byAssets.values()];
}

function syntheticClaimTitle(title: string): boolean {
  return /^[\w .-]+: [a-z]+_[a-z0-9_]+/i.test(title.trim());
}

export function clusterEventTitle(input: {
  assets: Array<{ displayName?: string | null; symbol?: string | null; canonicalId: string }>;
  evidenceTitles: Array<string | null | undefined>;
  hostnames: string[];
  principalClaimTitle?: string;
  reliabilityStatus?: string;
}): string {
  const principal = input.principalClaimTitle?.trim();
  if (principal && !syntheticClaimTitle(principal)) {
    return principal;
  }
  if (input.reliabilityStatus === "mention") {
    const host = input.hostnames.find((host) => host && host !== "unknown-host");
    return host ? `Search mention · ${host}` : "Search mention";
  }
  const useful = input.evidenceTitles.find((title) => {
    const value = title?.trim() ?? "";
    return value.length >= 28 && value.length <= 140 && !syntheticClaimTitle(value);
  });
  if (useful?.trim()) {
    return useful.trim();
  }
  const assetLabels = takeBounded(
    [
      ...new Set(
        input.assets.map((asset) => {
          if (asset.displayName?.trim()) {
            return asset.displayName.trim();
          }
          if (asset.symbol?.trim()) {
            return asset.symbol.trim().toUpperCase();
          }
          return asset.canonicalId.split(":")[1]?.replace(/-/g, " ") ?? asset.canonicalId;
        }),
      ),
    ],
    3,
  );
  const hosts = takeBounded(
    [
      ...new Set(
        input.hostnames
          .map((host) => host.toLowerCase())
          .filter((host) => host.length > 0 && host !== "unknown-host"),
      ),
    ],
    2,
  );
  const hostSuffix = hosts.length > 0 ? ` · ${hosts.join(", ")}` : "";
  if (assetLabels.length > 0) {
    return `${assetLabels.join(", ")} cluster${hostSuffix}`;
  }
  const shortTitle = input.evidenceTitles.find((title) => {
    const value = title?.trim() ?? "";
    return value.length >= 8 && value.length <= 140;
  });
  if (shortTitle?.trim()) {
    return `${shortTitle.trim()}${hostSuffix}`;
  }
  return hosts.length > 0 ? `Evidence cluster · ${hosts[0]}` : "Unlabeled evidence cluster";
}

export type IndependenceNode = {
  evidenceId: string;
  hostname: string;
  role: EvidenceRole;
};

export type IndependenceEdge = {
  fromId: string;
  toId: string;
  kind: "reprint_of" | "near_duplicate_of";
};

export function independenceGraph(
  items: Array<{
    id: string;
    url?: string | null;
    role: EvidenceRole;
    reprintOfId?: string;
    nearDuplicateOfId?: string;
  }>,
): { nodes: IndependenceNode[]; edges: IndependenceEdge[] } {
  const bounded = takeBounded(items, 100);
  const nodes = bounded.map((item) => ({
    evidenceId: item.id,
    hostname: sourceHostname(item.url),
    role: item.role,
  }));
  const edges: IndependenceEdge[] = [];
  for (const item of bounded) {
    if (item.reprintOfId) {
      edges.push({ fromId: item.id, toId: item.reprintOfId, kind: "reprint_of" });
    }
    if (item.nearDuplicateOfId) {
      edges.push({ fromId: item.id, toId: item.nearDuplicateOfId, kind: "near_duplicate_of" });
    }
  }
  return { nodes, edges: takeBounded(edges, 200) };
}

export function uniqueIndependentHosts(
  items: Array<{ hostname: string; role: EvidenceRole }>,
): number {
  return new Set(
    items
      .filter((item) => item.role === "primary" || item.role === "supporting")
      .map((item) => item.hostname),
  ).size;
}
