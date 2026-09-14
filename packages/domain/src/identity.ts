import { MAX_IDENTITY_TRACK_ROWS, takeBounded } from "./limits.js";
import type { TrustTier } from "./reliability.js";

export const SOCIAL_CLAIM_FAMILIES = ["x", "discord", "feed"] as const;

export type SocialClaimFamily = (typeof SOCIAL_CLAIM_FAMILIES)[number];

export type IdentityClaimObservation = {
  identityId: string;
  claimId: string;
  publishedAt: Date;
  trustTier: TrustTier;
};

export type IdentityTrackRecord = {
  claims: number;
  laterCorroborated: number;
  medianLeadHours: number | null;
};

const PRIMARY_TIERS = new Set<TrustTier>(["official_firsthand", "known_analyst"]);

export function isSocialClaimFamily(family: string | undefined): family is SocialClaimFamily {
  return family === "x" || family === "discord" || family === "feed";
}

export function isCommunitySocialEvidence(input: {
  sourceFamily?: string;
  trustTier?: TrustTier;
}): boolean {
  if (!isSocialClaimFamily(input.sourceFamily)) {
    return false;
  }
  return input.trustTier !== "official_firsthand" && input.trustTier !== "known_analyst";
}

export function effectiveIdentityTrust(input: {
  identityId?: string | null;
  parentId?: string | null;
  policyByIdentity: ReadonlyMap<string, TrustTier>;
}): TrustTier | undefined {
  if (input.identityId) {
    const own = input.policyByIdentity.get(input.identityId);
    if (own) {
      return own;
    }
  }
  if (input.parentId) {
    return input.policyByIdentity.get(input.parentId);
  }
  return undefined;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? null;
  }
  const high = sorted[mid];
  const low = sorted[mid - 1];
  if (high === undefined || low === undefined) {
    return null;
  }
  return (low + high) / 2;
}

export function computeIdentityTrackRecords(
  rows: readonly IdentityClaimObservation[],
): Map<string, IdentityTrackRecord> {
  const bounded = takeBounded(rows, MAX_IDENTITY_TRACK_ROWS);
  const byClaim = new Map<string, IdentityClaimObservation[]>();
  for (const row of bounded) {
    if (!row.identityId || !row.claimId || Number.isNaN(row.publishedAt.getTime())) {
      continue;
    }
    const list = byClaim.get(row.claimId) ?? [];
    list.push(row);
    byClaim.set(row.claimId, list);
  }
  const claims = new Map<string, number>();
  const corroborated = new Map<string, number>();
  const leads = new Map<string, number[]>();
  for (const group of byClaim.values()) {
    const firstByIdentity = new Map<string, IdentityClaimObservation>();
    for (const row of group) {
      const current = firstByIdentity.get(row.identityId);
      if (!current || row.publishedAt < current.publishedAt) {
        firstByIdentity.set(row.identityId, row);
      }
    }
    let firstPrimary: IdentityClaimObservation | undefined;
    for (const row of firstByIdentity.values()) {
      if (!PRIMARY_TIERS.has(row.trustTier)) {
        continue;
      }
      if (!firstPrimary || row.publishedAt < firstPrimary.publishedAt) {
        firstPrimary = row;
      }
    }
    for (const [identityId, first] of firstByIdentity) {
      claims.set(identityId, (claims.get(identityId) ?? 0) + 1);
      if (!firstPrimary || firstPrimary.identityId === identityId) {
        continue;
      }
      if (first.publishedAt >= firstPrimary.publishedAt) {
        continue;
      }
      corroborated.set(identityId, (corroborated.get(identityId) ?? 0) + 1);
      const hours = (firstPrimary.publishedAt.getTime() - first.publishedAt.getTime()) / 3_600_000;
      const list = leads.get(identityId) ?? [];
      list.push(hours);
      leads.set(identityId, list);
    }
  }
  const records = new Map<string, IdentityTrackRecord>();
  for (const [identityId, count] of claims) {
    records.set(identityId, {
      claims: count,
      laterCorroborated: corroborated.get(identityId) ?? 0,
      medianLeadHours: median(leads.get(identityId) ?? []),
    });
  }
  return records;
}
