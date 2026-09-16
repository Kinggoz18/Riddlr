import { createHash } from "node:crypto";
import type { EvidenceRole } from "./evidence.js";
import { normalizeText } from "./evidence.js";
import { MAX_CLUSTER_TOKENS, takeBounded } from "./limits.js";
import { DEFAULT_PRICE_TRACKER_HOSTS, hostMatchesPublisherPolicy } from "./publisher-hosts.js";

export const NEAR_DUPLICATE_THRESHOLD = 0.82;
export const CLUSTER_SIMILARITY_THRESHOLD = 0.45;
export const CLUSTER_TOKEN_SIMILARITY_THRESHOLD = 0.25;
export const CLUSTER_CONTENT_BIGRAM_MIN_CHARS = 8;
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
  watchedAssetHit?: boolean;
  relevanceHit?: boolean;
  trustTier?: string;
  contentCompleteness?: string;
};

const CLUSTER_TOKEN_STOP = new Set([
  "a",
  "an",
  "the",
  "of",
  "and",
  "or",
  "to",
  "in",
  "on",
  "for",
  "as",
  "at",
  "by",
  "from",
  "with",
  "this",
  "that",
  "its",
  "than",
  "then",
  "but",
  "not",
  "no",
  "just",
  "about",
  "after",
  "over",
  "under",
  "into",
  "out",
  "up",
  "down",
  "all",
  "any",
  "can",
  "could",
  "would",
  "should",
  "may",
  "will",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "has",
  "have",
  "had",
  "do",
  "did",
  "does",
  "us",
  "vs",
  "amid",
  "says",
  "said",
  "say",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "today",
  "yesterday",
  "week",
  "month",
  "year",
  "afternoon",
  "morning",
]);

const CLUSTER_GENERIC_TOKENS = new Set([
  "public",
  "offering",
  "initial",
  "million",
  "billion",
  "shares",
  "company",
  "companies",
  "sources",
  "according",
  "reported",
  "filing",
  "lawsuit",
  "court",
  "federal",
  "confidential",
  "investor",
  "investors",
  "market",
  "stock",
  "price",
  "group",
  "energy",
  "bank",
  "could",
  "soon",
  "right",
  "hold",
  "buy",
  "sell",
]);

const TRUST_RANK: Record<string, number> = {
  official_firsthand: 4,
  known_analyst: 3,
  reputable_press: 3,
  community: 1,
  unknown: 0,
  blocked: -1,
};

function stemClusterToken(token: string): string {
  if (token.length <= 4) {
    return token;
  }
  if (token.endsWith("ies") && token.length > 5) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith("ing") && token.length > 5) {
    return token.slice(0, -3);
  }
  if (token.endsWith("ed") && token.length > 5) {
    return token.slice(0, -2);
  }
  if (token.endsWith("es") && token.length > 4) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 4) {
    return token.slice(0, -1);
  }
  return token;
}

export function clusterTokens(text: string): string[] {
  const raw = normalizeText(text)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 3 && !CLUSTER_TOKEN_STOP.has(token) && !/^\d+$/.test(token))
    .map(stemClusterToken);
  return takeBounded(raw, MAX_CLUSTER_TOKENS);
}

export function tokenJaccard(left: string, right: string): number {
  return jaccardSimilarity(new Set(clusterTokens(left)), new Set(clusterTokens(right)));
}

export function clusterContentBigrams(text: string): Set<string> {
  const tokens = clusterTokens(text).filter((token) => !CLUSTER_GENERIC_TOKENS.has(token));
  const out = new Set<string>();
  for (let index = 0; index < tokens.length - 1 && out.size < MAX_CLUSTER_TOKENS; index += 1) {
    const first = tokens[index];
    const second = tokens[index + 1];
    if (!first || !second) {
      continue;
    }
    if (first.length + second.length + 1 >= CLUSTER_CONTENT_BIGRAM_MIN_CHARS) {
      out.add(`${first} ${second}`);
    }
  }
  return out;
}

function sharesContentBigram(left: string, right: string): boolean {
  const other = clusterContentBigrams(right);
  for (const item of clusterContentBigrams(left)) {
    if (other.has(item)) {
      return true;
    }
  }
  return false;
}

export function clusterPriorityScore(item: {
  watchedAssetHit?: boolean;
  relevanceHit?: boolean;
  trustTier?: string;
  contentCompleteness?: string;
}): number {
  let score = 0;
  if (item.watchedAssetHit) {
    score += 1_000_000;
  }
  if (item.relevanceHit) {
    score += 100_000;
  }
  if (
    item.contentCompleteness === "full_document" ||
    item.contentCompleteness === "native_complete"
  ) {
    score += 10_000;
  }
  score += (TRUST_RANK[item.trustTier ?? "unknown"] ?? 0) * 1_000;
  return score;
}

export function sortClusterCandidates<T extends ClusterableEvidence>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => {
    const diff = clusterPriorityScore(right) - clusterPriorityScore(left);
    if (diff !== 0) {
      return diff;
    }
    return (right.publishedAt?.getTime() ?? 0) - (left.publishedAt?.getTime() ?? 0);
  });
}

function hasClaimFingerprints(item: ClusterableEvidence): boolean {
  return (item.claimFingerprints?.length ?? 0) > 0;
}

function itemsJoin<T extends ClusterableEvidence>(item: T, member: T): boolean {
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
    hasClaimFingerprints(item) &&
    hasClaimFingerprints(member) &&
    (item.claimFingerprints ?? []).some((fingerprint) =>
      member.claimFingerprints?.includes(fingerprint),
    );
  if (sharedClaim) {
    return true;
  }
  const sharedAsset =
    item.assetCanonicalIds.length > 0 &&
    member.assetCanonicalIds.some((id) => item.assetCanonicalIds.includes(id));
  const shingleHit = isNearDuplicate(item.text, member.text, CLUSTER_SIMILARITY_THRESHOLD);
  const tokenHit = tokenJaccard(item.text, member.text) >= CLUSTER_TOKEN_SIMILARITY_THRESHOLD;
  const bigramHit = sharesContentBigram(item.text, member.text);
  if (sharedAsset && (shingleHit || tokenHit || bigramHit)) {
    return true;
  }
  if (!hasClaimFingerprints(item) && !hasClaimFingerprints(member) && (shingleHit || bigramHit)) {
    return true;
  }
  return false;
}

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
      const similarToCluster = cluster.some((member) => itemsJoin(item, member));
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
  overflowBucket?: string;
}): string {
  const claims = [...new Set(input.claimFingerprints ?? [])].filter(Boolean).sort();
  const hashes = [...new Set(input.contentHashes ?? [])].filter(Boolean).sort();
  const assets = [...new Set(input.assetCanonicalIds ?? [])].sort();
  const identity = claims.join(",") || hashes.join(",") || assets.join(",") || "unlabeled";
  const basis = [input.marketDomainId ?? "", identity, input.overflowBucket ?? ""].join("|");
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

function isPriceTrackerHost(host: string): boolean {
  return DEFAULT_PRICE_TRACKER_HOSTS.some((pattern) => hostMatchesPublisherPolicy(host, pattern));
}

function newsHostnames(hosts: readonly string[]): string[] {
  const normalized = [
    ...new Set(
      hosts
        .map((host) => host.toLowerCase())
        .filter((host) => host.length > 0 && host !== "unknown-host"),
    ),
  ];
  const news = normalized.filter((host) => !isPriceTrackerHost(host));
  return news.length > 0 ? news : normalized;
}

function usefulEvidenceTitle(titles: Array<string | null | undefined>): string | undefined {
  return titles
    .find((title) => {
      const value = title?.trim() ?? "";
      if (value.length < 28 || value.length > 140 || syntheticClaimTitle(value)) {
        return false;
      }
      if (/wikipedia/i.test(value) || /market snapshot$/i.test(value)) {
        return false;
      }
      return true;
    })
    ?.trim();
}

function assetLabelsForTitle(
  assets: Array<{ displayName?: string | null; symbol?: string | null; canonicalId: string }>,
): string[] {
  return takeBounded(
    [
      ...new Set(
        assets.map((asset) => {
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
}

export function clusterOpensEvent(input: {
  sourceFamilies: readonly string[];
  observedAnomaly: boolean;
}): boolean {
  if (input.sourceFamilies.length === 0) {
    return true;
  }
  const marketDataOnly = input.sourceFamilies.every((family) => family === "market_data");
  return !marketDataOnly || input.observedAnomaly;
}

export function clusterEventTitle(input: {
  assets: Array<{ displayName?: string | null; symbol?: string | null; canonicalId: string }>;
  evidenceTitles: Array<string | null | undefined>;
  hostnames: string[];
  principalClaimTitle?: string;
  reliabilityStatus?: string;
  sourceFamilies?: readonly string[];
}): string {
  const principal = input.principalClaimTitle?.trim();
  if (principal && !syntheticClaimTitle(principal)) {
    return principal;
  }
  const families = input.sourceFamilies ?? [];
  const observationOrMarket =
    families.length > 0 &&
    families.every((family) => family === "observation" || family === "market_data");
  const useful = usefulEvidenceTitle(input.evidenceTitles);
  if (observationOrMarket) {
    if (useful) {
      return useful;
    }
    const labels = assetLabelsForTitle(input.assets);
    return labels.length > 0 ? `${labels.join(", ")} spot observations` : "Spot observations";
  }
  if (useful) {
    return useful;
  }
  const assetLabels = assetLabelsForTitle(input.assets);
  const hosts = takeBounded(newsHostnames(input.hostnames), 2);
  const hostSuffix = hosts.length > 0 ? ` · ${hosts.join(", ")}` : "";
  if (input.reliabilityStatus === "mention") {
    const host = hosts[0];
    return host ? `Search mention · ${host}` : "Search mention";
  }
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
