import type { EventFacts } from "./analysis-facts.js";
import type { MaterialityDecision } from "./materiality.js";
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
};

const RISK_DISPOSITION: Record<RiskLevel, SignalDisposition> = {
  low: "low_priority",
  moderate: "medium",
  high: "high",
  critical: "critical",
};

export function decideSignalGate(input: {
  facts: EventFacts;
  risk: RiskLevel;
  confidence: number;
  material: MaterialityDecision;
}): SignalGateDecision {
  if (!input.material.material) {
    return {
      persist: true,
      notifyEligible: false,
      disposition: "low_priority",
      reason: "interesting_not_material",
    };
  }
  if (
    input.facts.derivedCount > 0 &&
    input.facts.independentHostCount < 2 &&
    !input.facts.watchlistOverlap
  ) {
    return {
      persist: true,
      notifyEligible: false,
      disposition: "low_priority",
      reason: "weakly_supported",
    };
  }
  const disposition = RISK_DISPOSITION[input.risk];
  const notifyEligible =
    disposition === "medium" || disposition === "high" || disposition === "critical";
  return {
    persist: true,
    notifyEligible,
    disposition,
    reason: input.material.reason,
  };
}
