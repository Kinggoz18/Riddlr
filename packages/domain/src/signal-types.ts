import { isCatalystKind } from "./catalysts.js";
import {
  DEFAULT_ANALYSIS_EVIDENCE_LIMIT,
  DEFAULT_EXPLOIT_TRANSFER_USD,
  takeBounded,
} from "./limits.js";
import type { TrustTier } from "./reliability.js";

export const TYPED_SIGNAL_IDS = [
  "exploit_or_bridge_drain",
  "stablecoin_peg_deviation",
  "token_unlock",
  "listing_or_delisting",
  "governance_proposal",
  "regulatory_legal_sanction",
  "macro_policy_catalyst",
  "perp_stress",
] as const;

export type TypedSignalId = (typeof TYPED_SIGNAL_IDS)[number];

export const TYPED_SIGNAL_LABELS: Record<TypedSignalId, string> = {
  exploit_or_bridge_drain: "Exploit or bridge drain",
  stablecoin_peg_deviation: "Stablecoin peg deviation",
  token_unlock: "Token unlock",
  listing_or_delisting: "Listing or delisting",
  governance_proposal: "Governance proposal",
  regulatory_legal_sanction: "Regulatory, legal, sanction",
  macro_policy_catalyst: "Macro policy catalyst",
  perp_stress: "Perp stress",
};

const TYPED_SET = new Set<string>(TYPED_SIGNAL_IDS);
const WRITEUP_FAMILIES = new Set(["search", "feed"]);
const SOCIAL_POST_FAMILIES = new Set(["x", "discord"]);
const EXPLOIT_OBJECT = /\b(bridge_outflow|treasury_outflow|exploit|hack|bridge drain)\b/i;
const INFLOW_OBJECT = /\bexchange_inflow\b/i;

export function isTypedSignalId(value: string): value is TypedSignalId {
  return TYPED_SET.has(value);
}

export type SignalProofEvidence = {
  sourceFamily?: string;
  trustTier?: TrustTier;
};

export type SignalProofClaim = {
  kind?: string;
  predicate?: string;
  objectText?: string;
  value?: number | string | boolean | null;
};

export type SignalProofFacts = {
  hasDetector: boolean;
  hasTx: boolean;
  hasIndependentWriteup: boolean;
  hasOfficialStatus: boolean;
  hasIssuerOrExchangeStatement: boolean;
  hasCalendarEvidence: boolean;
  hasOfficialExchangeFeed: boolean;
  hasWebOrSocial: boolean;
  hasProposalEvidence: boolean;
  hasOfficialDocument: boolean;
  hasWebOnly: boolean;
  hasOddsJump: boolean;
  hasPrincipalPost: boolean;
  hasOfficialText: boolean;
  hasSocialOrigin: boolean;
  isExchangeInflow: boolean;
  isExploitTransfer: boolean;
};

export type TypedSignalEvaluation = {
  typedSignalId?: TypedSignalId;
  persist: boolean;
  outputKind: "signal" | "unverified_early_warning";
  anticipated: boolean;
  notifyAsEarlyWarning: boolean;
  allowValidatedNotify: boolean;
  reason: string;
  epistemicStatus: "signal" | "observed";
};

function numericValue(value: number | string | boolean | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isOfficialNonSocial(item: SignalProofEvidence): boolean {
  if (item.trustTier !== "official_firsthand") {
    return false;
  }
  return !SOCIAL_POST_FAMILIES.has(item.sourceFamily ?? "");
}

export function collectSignalProofFacts(input: {
  evidence: readonly SignalProofEvidence[];
  claims?: readonly SignalProofClaim[];
}): SignalProofFacts {
  const evidence = takeBounded(input.evidence, DEFAULT_ANALYSIS_EVIDENCE_LIMIT);
  const claims = takeBounded(input.claims ?? [], 32);
  const families = evidence.map((item) => item.sourceFamily);
  const officialNonSocial = evidence.filter(isOfficialNonSocial);
  const hasWeb = families.includes("search");
  const hasSocialOrigin = evidence.some((item) =>
    SOCIAL_POST_FAMILIES.has(item.sourceFamily ?? ""),
  );
  const objectHay = claims.map((item) => `${item.objectText ?? ""} ${item.kind ?? ""}`).join(" ");
  const maxValue = claims.reduce<number | undefined>((current, item) => {
    const value = numericValue(item.value);
    if (value === undefined) {
      return current;
    }
    return current === undefined ? value : Math.max(current, value);
  }, undefined);
  return {
    hasDetector: families.includes("observation"),
    hasTx: families.includes("onchain"),
    hasIndependentWriteup: evidence.some((item) => WRITEUP_FAMILIES.has(item.sourceFamily ?? "")),
    hasOfficialStatus: officialNonSocial.length > 0,
    hasIssuerOrExchangeStatement: officialNonSocial.length > 0,
    hasCalendarEvidence: families.includes("calendar"),
    hasOfficialExchangeFeed: evidence.some(
      (item) => item.sourceFamily === "feed" && item.trustTier === "official_firsthand",
    ),
    hasWebOrSocial:
      hasWeb ||
      hasSocialOrigin ||
      evidence.some(
        (item) => item.sourceFamily === "feed" && item.trustTier !== "official_firsthand",
      ),
    hasProposalEvidence: families.includes("governance"),
    hasOfficialDocument: officialNonSocial.length > 0,
    hasWebOnly: hasWeb && officialNonSocial.length === 0,
    hasOddsJump: claims.some((item) => item.predicate === "odds_jump"),
    hasPrincipalPost:
      claims.some(
        (item) =>
          item.kind === "principal_statement" ||
          item.kind?.endsWith(":principal_statement") === true,
      ) ||
      evidence.some(
        (item) =>
          SOCIAL_POST_FAMILIES.has(item.sourceFamily ?? "") &&
          (item.trustTier === "official_firsthand" || item.trustTier === "known_analyst"),
      ),
    hasOfficialText: officialNonSocial.length > 0,
    hasSocialOrigin,
    isExchangeInflow: INFLOW_OBJECT.test(objectHay) && !EXPLOIT_OBJECT.test(objectHay),
    isExploitTransfer:
      EXPLOIT_OBJECT.test(objectHay) ||
      (maxValue !== undefined && maxValue >= DEFAULT_EXPLOIT_TRANSFER_USD),
  };
}

export function typedSignalForCatalyst(
  kind: string,
  proof?: Pick<SignalProofFacts, "isExchangeInflow" | "isExploitTransfer">,
): TypedSignalId | undefined {
  if (!isCatalystKind(kind)) {
    return undefined;
  }
  switch (kind) {
    case "security_incident":
      return "exploit_or_bridge_drain";
    case "large_transfer":
      if (proof?.isExchangeInflow && !proof.isExploitTransfer) {
        return undefined;
      }
      return "exploit_or_bridge_drain";
    case "peg_deviation":
      return "stablecoin_peg_deviation";
    case "token_unlock":
      return "token_unlock";
    case "listing_or_delisting":
      return "listing_or_delisting";
    case "governance_proposal":
      return "governance_proposal";
    case "regulatory_or_legal_action":
    case "sanction":
      return "regulatory_legal_sanction";
    case "macro_policy_decision":
    case "principal_statement":
      return "macro_policy_catalyst";
    case "market_stress":
      return "perp_stress";
    default:
      return undefined;
  }
}

function none(reason: string, typedSignalId?: TypedSignalId): TypedSignalEvaluation {
  return {
    typedSignalId,
    persist: false,
    outputKind: "signal",
    anticipated: false,
    notifyAsEarlyWarning: false,
    allowValidatedNotify: false,
    reason,
    epistemicStatus: "signal",
  };
}

function validated(
  typedSignalId: TypedSignalId,
  reason: string,
  extra?: Partial<TypedSignalEvaluation>,
): TypedSignalEvaluation {
  return {
    typedSignalId,
    persist: true,
    outputKind: "signal",
    anticipated: false,
    notifyAsEarlyWarning: false,
    allowValidatedNotify: true,
    reason,
    epistemicStatus: "signal",
    ...extra,
  };
}

function earlyWarning(
  typedSignalId: TypedSignalId,
  reason: string,
  extra?: Partial<TypedSignalEvaluation>,
): TypedSignalEvaluation {
  return {
    typedSignalId,
    persist: true,
    outputKind: "unverified_early_warning",
    anticipated: false,
    notifyAsEarlyWarning: true,
    allowValidatedNotify: false,
    reason,
    epistemicStatus: "signal",
    ...extra,
  };
}

export function evaluateTypedSignal(input: {
  eventType: string;
  proof: SignalProofFacts;
}): TypedSignalEvaluation {
  const typedSignalId = typedSignalForCatalyst(input.eventType, input.proof);
  if (!typedSignalId) {
    return none("untyped_catalyst");
  }
  const proof = input.proof;
  switch (typedSignalId) {
    case "exploit_or_bridge_drain": {
      if (proof.hasTx && (proof.hasIndependentWriteup || proof.hasOfficialStatus)) {
        return validated(typedSignalId, "exploit_tx_and_writeup_or_status");
      }
      if (proof.hasDetector || proof.hasSocialOrigin) {
        return earlyWarning(
          typedSignalId,
          proof.hasDetector ? "exploit_detector_only" : "exploit_social_origin",
        );
      }
      return none("exploit_missing_tx_or_detector", typedSignalId);
    }
    case "stablecoin_peg_deviation": {
      if (proof.hasDetector && proof.hasIssuerOrExchangeStatement) {
        return validated(typedSignalId, "peg_detector_and_issuer_statement");
      }
      if (proof.hasDetector) {
        return earlyWarning(typedSignalId, "peg_detector_only");
      }
      return none("peg_missing_detector", typedSignalId);
    }
    case "token_unlock": {
      return validated(
        typedSignalId,
        proof.hasCalendarEvidence ? "unlock_calendar_evidence" : "unlock_anticipated",
        {
          anticipated: true,
          allowValidatedNotify: proof.hasCalendarEvidence,
        },
      );
    }
    case "listing_or_delisting": {
      if (proof.hasOfficialExchangeFeed) {
        return validated(typedSignalId, "listing_official_exchange_feed");
      }
      if (proof.hasWebOrSocial) {
        return earlyWarning(typedSignalId, "listing_web_or_social_only");
      }
      return none("listing_missing_feed_or_web", typedSignalId);
    }
    case "governance_proposal": {
      if (proof.hasProposalEvidence) {
        return validated(typedSignalId, "governance_proposal_evidence");
      }
      return none("governance_missing_proposal_evidence", typedSignalId);
    }
    case "regulatory_legal_sanction": {
      if (proof.hasOfficialDocument) {
        return validated(typedSignalId, "regulatory_official_document");
      }
      if (proof.hasWebOnly) {
        return earlyWarning(typedSignalId, "regulatory_web_only");
      }
      return none("regulatory_missing_official_or_web", typedSignalId);
    }
    case "macro_policy_catalyst": {
      if (proof.hasOfficialText) {
        return validated(typedSignalId, "macro_official_text");
      }
      if (proof.hasOddsJump || proof.hasPrincipalPost) {
        return earlyWarning(
          typedSignalId,
          proof.hasOddsJump ? "macro_odds_jump" : "macro_principal_post",
        );
      }
      return none("macro_missing_official_or_odds", typedSignalId);
    }
    case "perp_stress": {
      if (proof.hasDetector) {
        return earlyWarning(typedSignalId, "perp_stress_detector", {
          epistemicStatus: "observed",
        });
      }
      return none("perp_stress_missing_detector", typedSignalId);
    }
  }
}
