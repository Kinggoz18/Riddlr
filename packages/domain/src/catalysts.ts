import type { CatalystKind } from "./catalyst-kinds.js";
import {
  type ClaimCandidate,
  claimTitle,
  fingerprintClaim,
  type NormalizedClaim,
} from "./claims.js";

export {
  CATALYST_KIND_LABELS,
  CATALYST_KINDS,
  CATALYST_SEVERITY_PRIOR,
  type CatalystKind,
  claimSatisfiesCatalystContract,
  isCatalystKind,
  isQuantitativeCatalyst,
  isSubjectFreeCatalyst,
  principalCatalystKindForClaims,
  QUANTITATIVE_CATALYST_KINDS,
  SUBJECT_FREE_CATALYST_KINDS,
  selectPrincipalCatalyst,
} from "./catalyst-kinds.js";

export function overlayFirstPassNegation(
  primary: readonly ClaimCandidate[],
  firstPass: readonly {
    kind: string;
    subjectCanonicalId?: string;
    polarity: ClaimCandidate["polarity"];
  }[],
  catalystOf: (kind: string) => CatalystKind | undefined,
): ClaimCandidate[] {
  return primary.map((claim) => {
    const catalyst = catalystOf(claim.kind);
    if (!catalyst || claim.polarity === "negated") {
      return claim;
    }
    const negated = firstPass.some((item) => {
      if (item.polarity !== "negated") {
        return false;
      }
      if (catalystOf(item.kind) !== catalyst) {
        return false;
      }
      if (
        claim.subjectCanonicalId &&
        item.subjectCanonicalId &&
        claim.subjectCanonicalId !== item.subjectCanonicalId
      ) {
        return false;
      }
      return true;
    });
    return negated ? { ...claim, polarity: "negated" as const } : claim;
  });
}

export function overlayNormalizedClaimNegation<T extends NormalizedClaim>(
  primary: readonly T[],
  firstPass: readonly T[],
  catalystOf: (kind: string) => CatalystKind | undefined,
): T[] {
  return primary.map((claim) => {
    const catalyst = catalystOf(claim.kind);
    if (!catalyst || claim.polarity === "negated") {
      return claim;
    }
    const negated = firstPass.some((item) => {
      if (item.polarity !== "negated") {
        return false;
      }
      if (catalystOf(item.kind) !== catalyst) {
        return false;
      }
      if (
        claim.subjectCanonicalId &&
        item.subjectCanonicalId &&
        claim.subjectCanonicalId !== item.subjectCanonicalId
      ) {
        return false;
      }
      return true;
    });
    if (!negated) {
      return claim;
    }
    const next = { ...claim, polarity: "negated" as const };
    return {
      ...next,
      fingerprint: fingerprintClaim({
        marketDomainId: next.marketDomainId,
        kind: next.kind,
        subjectCanonicalId: next.subjectCanonicalId,
        polarity: next.polarity,
        objectText: next.objectText,
        value: next.value,
      }),
      title: claimTitle(next),
    };
  });
}
