import type { EventFacts } from "./analysis-facts.js";
import type { MaterialityDecision } from "./materiality.js";
import {
  assessReliability,
  capConfidence,
  type ImpactLevel,
  type ReliabilityStatus,
} from "./reliability.js";
import type { RiskLevel } from "./signal.js";

export const SIGNAL_DISPOSITIONS = [
  "no_signal",
  "low_priority",
  "medium",
  "high",
  "critical",
] as const;
export type SignalDisposition = (typeof SIGNAL_DISPOSITIONS)[number];

export type SignalGateDecision = {
  persist: boolean;
  notifyEligible: boolean;
  disposition: SignalDisposition;
  reason: string;
  outputKind: "signal" | "unverified_early_warning";
  notifyKind: "signal" | "early_warning" | "confirmation" | "dispute" | "retraction";
  cappedConfidence: number;
};

const IMPACT_RANK: Record<ImpactLevel, number> = {
  informational: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

function impactDisposition(impact: ImpactLevel): SignalDisposition {
  if (impact === "critical") {
    return "critical";
  }
  if (impact === "high") {
    return "high";
  }
  if (impact === "moderate") {
    return "medium";
  }
  return "low_priority";
}

function allowNotify(eligible: boolean, shadow?: boolean): boolean {
  return eligible && !shadow;
}

export function decideSignalGate(input: {
  facts: EventFacts;
  risk: RiskLevel;
  confidence: number;
  material: MaterialityDecision;
  reliability?: ReliabilityStatus;
  impact?: ImpactLevel;
  earlyWarningsEnabled?: boolean;
  previousReliability?: ReliabilityStatus;
  shadowAssessments?: boolean;
}): SignalGateDecision {
  const reliability = input.reliability ?? reliabilityFromFacts(input.facts, input.material);
  const impact = input.impact ?? "moderate";
  const cappedConfidence = capConfidence(reliability, input.confidence);
  const shadow = Boolean(input.shadowAssessments);
  if (!input.material.material) {
    return {
      persist: true,
      notifyEligible: false,
      disposition: "low_priority",
      reason: "interesting_not_material",
      outputKind: "signal",
      notifyKind: "signal",
      cappedConfidence,
    };
  }
  if (reliability === "retracted") {
    return {
      persist: true,
      notifyEligible: allowNotify(true, shadow),
      disposition: "high",
      reason: "retracted",
      outputKind: "signal",
      notifyKind: "retraction",
      cappedConfidence,
    };
  }
  if (reliability === "disputed") {
    return {
      persist: true,
      notifyEligible: allowNotify(true, shadow),
      disposition: "medium",
      reason: "disputed",
      outputKind: "signal",
      notifyKind: "dispute",
      cappedConfidence,
    };
  }
  if (reliability === "mention" || reliability === "legacy_unassessed") {
    return {
      persist: false,
      notifyEligible: false,
      disposition: "low_priority",
      reason: "mention_only",
      outputKind: "signal",
      notifyKind: "signal",
      cappedConfidence,
    };
  }
  if (reliability === "single_source") {
    return {
      persist: true,
      notifyEligible: false,
      disposition: "low_priority",
      reason: "single_source_unverified",
      outputKind: "signal",
      notifyKind: "signal",
      cappedConfidence,
    };
  }
  if (reliability === "observed") {
    return {
      persist: false,
      notifyEligible: false,
      disposition: "low_priority",
      reason: "observed_fact_not_signal",
      outputKind: "signal",
      notifyKind: "signal",
      cappedConfidence,
    };
  }
  if (reliability === "primary_confirmed") {
    const highImpact = IMPACT_RANK[impact] >= IMPACT_RANK.high;
    const notify = Boolean(input.earlyWarningsEnabled) && highImpact;
    return {
      persist: true,
      notifyEligible: allowNotify(notify, shadow),
      disposition: highImpact ? "high" : "low_priority",
      reason: notify ? "unverified_early_warning" : "trusted_firsthand_not_notified",
      outputKind: "unverified_early_warning",
      notifyKind: "early_warning",
      cappedConfidence,
    };
  }
  if (
    input.facts.derivedCount > 0 &&
    (input.facts.independentOriginCount ?? input.facts.independentHostCount) < 2 &&
    !input.facts.watchlistOverlap
  ) {
    return {
      persist: true,
      notifyEligible: false,
      disposition: "low_priority",
      reason: "weakly_supported",
      outputKind: "signal",
      notifyKind: "signal",
      cappedConfidence,
    };
  }
  const previous = input.previousReliability;
  if (
    (previous === "primary_confirmed" || previous === "single_source") &&
    reliability === "corroborated"
  ) {
    const impactOk = IMPACT_RANK[impact] >= IMPACT_RANK.moderate;
    return {
      persist: true,
      notifyEligible: allowNotify(impactOk, shadow),
      disposition: impactDisposition(impact),
      reason: "confirmation",
      outputKind: "signal",
      notifyKind: "confirmation",
      cappedConfidence,
    };
  }
  const impactOk = IMPACT_RANK[impact] >= IMPACT_RANK.moderate;
  return {
    persist: true,
    notifyEligible: allowNotify(impactOk, shadow),
    disposition: impactDisposition(impact),
    reason: input.material.reason,
    outputKind: "signal",
    notifyKind: "signal",
    cappedConfidence,
  };
}

function reliabilityFromFacts(
  facts: EventFacts,
  _material: MaterialityDecision,
): ReliabilityStatus {
  if (facts.reliabilityStatus) {
    return facts.reliabilityStatus;
  }
  return assessReliability({
    contentCompleteness: facts.contentCompleteness,
    independentOriginCount: facts.independentOriginCount ?? facts.independentHostCount,
    supportingCount: facts.primaryCount,
    contradictingCount: facts.contradictingCount,
    retractingCount: facts.retractingCount ?? 0,
    hasTrustedFirsthand: facts.hasTrustedFirsthand || facts.hasAuthoritativePrimary,
    hasValidatedClaim: facts.hasValidatedClaim,
    headlineMismatch: facts.headlineMismatch,
  }).status;
}
