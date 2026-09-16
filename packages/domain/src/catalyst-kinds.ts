import { isClaimUnit } from "./claims.js";
import type { ImpactLevel } from "./reliability.js";

export const CATALYST_KINDS = [
  "security_incident",
  "insolvency_or_withdrawal_halt",
  "peg_deviation",
  "token_unlock",
  "listing_or_delisting",
  "governance_proposal",
  "regulatory_or_legal_action",
  "sanction",
  "macro_policy_decision",
  "scheduled_release",
  "insider_transaction",
  "material_corporate_event",
  "earnings_or_guidance",
  "large_transfer",
  "market_stress",
  "observed_anomaly",
  "principal_statement",
] as const;

export type CatalystKind = (typeof CATALYST_KINDS)[number];

export const QUANTITATIVE_CATALYST_KINDS = [
  "peg_deviation",
  "token_unlock",
  "large_transfer",
  "market_stress",
  "observed_anomaly",
  "earnings_or_guidance",
] as const satisfies readonly CatalystKind[];

export const SUBJECT_FREE_CATALYST_KINDS = [
  "macro_policy_decision",
  "scheduled_release",
] as const satisfies readonly CatalystKind[];

export const CATALYST_SEVERITY_PRIOR: Record<CatalystKind, ImpactLevel> = {
  security_incident: "critical",
  insolvency_or_withdrawal_halt: "critical",
  peg_deviation: "critical",
  token_unlock: "high",
  listing_or_delisting: "moderate",
  governance_proposal: "moderate",
  regulatory_or_legal_action: "high",
  sanction: "high",
  macro_policy_decision: "high",
  scheduled_release: "moderate",
  insider_transaction: "high",
  material_corporate_event: "high",
  earnings_or_guidance: "high",
  large_transfer: "moderate",
  market_stress: "high",
  observed_anomaly: "moderate",
  principal_statement: "moderate",
};

export const CATALYST_KIND_LABELS: Record<CatalystKind, string> = {
  security_incident: "Security incident",
  insolvency_or_withdrawal_halt: "Insolvency or withdrawal halt",
  peg_deviation: "Peg deviation",
  token_unlock: "Token unlock",
  listing_or_delisting: "Listing or delisting",
  governance_proposal: "Governance proposal",
  regulatory_or_legal_action: "Regulatory or legal action",
  sanction: "Sanction",
  macro_policy_decision: "Macro policy decision",
  scheduled_release: "Scheduled release",
  insider_transaction: "Insider transaction",
  material_corporate_event: "Material corporate event",
  earnings_or_guidance: "Earnings or guidance",
  large_transfer: "Large transfer",
  market_stress: "Market stress",
  observed_anomaly: "Observed anomaly",
  principal_statement: "Principal statement",
};

const SEVERITY_RANK: Record<ImpactLevel, number> = {
  critical: 5,
  high: 4,
  moderate: 3,
  low: 2,
  informational: 1,
};

const QUANTITATIVE = new Set<string>(QUANTITATIVE_CATALYST_KINDS);
const SUBJECT_FREE = new Set<string>(SUBJECT_FREE_CATALYST_KINDS);
const KIND_SET = new Set<string>(CATALYST_KINDS);

export function isCatalystKind(value: string): value is CatalystKind {
  return KIND_SET.has(value);
}

export function isQuantitativeCatalyst(kind: CatalystKind): boolean {
  return QUANTITATIVE.has(kind);
}

export function isSubjectFreeCatalyst(kind: CatalystKind): boolean {
  return SUBJECT_FREE.has(kind);
}

export function claimSatisfiesCatalystContract(input: {
  catalystKind: CatalystKind | undefined;
  subjectCanonicalId?: string;
  value?: number | string | boolean | null;
  unit?: string;
}): boolean {
  if (!input.catalystKind) {
    return false;
  }
  if (isQuantitativeCatalyst(input.catalystKind)) {
    if (input.value === undefined || input.value === null || input.value === "") {
      return false;
    }
    if (!input.unit?.trim() || !isClaimUnit(input.unit)) {
      return false;
    }
  }
  if (!isSubjectFreeCatalyst(input.catalystKind) && !input.subjectCanonicalId) {
    return false;
  }
  return true;
}

export function selectPrincipalCatalyst(kinds: readonly CatalystKind[]): CatalystKind | undefined {
  if (kinds.length === 0) {
    return undefined;
  }
  return kinds.reduce((best, kind) => {
    const bestRank = SEVERITY_RANK[CATALYST_SEVERITY_PRIOR[best]];
    const nextRank = SEVERITY_RANK[CATALYST_SEVERITY_PRIOR[kind]];
    if (nextRank > bestRank) {
      return kind;
    }
    if (nextRank === bestRank) {
      return CATALYST_KINDS.indexOf(kind) < CATALYST_KINDS.indexOf(best) ? kind : best;
    }
    return best;
  });
}

export function principalCatalystKindForClaims(
  kinds: readonly string[],
  mapClaimKind: (kind: string) => CatalystKind | undefined,
): CatalystKind | undefined {
  const mapped: CatalystKind[] = [];
  for (const kind of kinds) {
    const catalyst = mapClaimKind(kind) ?? (isCatalystKind(kind) ? kind : undefined);
    if (catalyst) {
      mapped.push(catalyst);
    }
  }
  return selectPrincipalCatalyst(mapped);
}
