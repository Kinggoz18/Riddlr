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
      const similarToCluster = cluster.some(
        (member) =>
          inTimeWindow(item.publishedAt, member.publishedAt) &&
          isNearDuplicate(item.text, member.text, CLUSTER_SIMILARITY_THRESHOLD),
      );
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

export function eventClusterFingerprint(ids: string[]): string {
  return [...ids].sort().join("|");
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
