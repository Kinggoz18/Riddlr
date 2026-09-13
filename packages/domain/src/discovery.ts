import type { EventFacts } from "./analysis-facts.js";
import type { MaterialityDecision } from "./materiality.js";

export const EPISTEMIC_STATUSES = [
  "discovered",
  "observed",
  "confirmed",
  "inferred",
  "signal",
] as const;
export type EpistemicStatus = (typeof EPISTEMIC_STATUSES)[number];

export const CANDIDATE_KINDS = [
  "potential_opportunity",
  "emerging_narrative",
  "hidden_gem",
  "major_event",
  "unusual_market_behaviour",
  "risk",
  "anomaly",
  "significant_development",
  "asset_specific_change",
  "general_market_trend",
  "search_mention",
  "single_source_report",
] as const;
export type CandidateKind = (typeof CANDIDATE_KINDS)[number];

export type DiscoveryDecision = {
  candidate: boolean;
  kind: CandidateKind | null;
  epistemicStatus: EpistemicStatus | null;
  reason: string;
  matchedObjectives: string[];
};

export type EventPipelineStatus = "empty" | "needs_analysis" | "candidate" | "immaterial";

const KIND_RANK: CandidateKind[] = [
  "risk",
  "anomaly",
  "unusual_market_behaviour",
  "significant_development",
  "major_event",
  "single_source_report",
  "emerging_narrative",
  "hidden_gem",
  "asset_specific_change",
  "general_market_trend",
  "search_mention",
  "potential_opportunity",
];

const KIND_OBJECTIVES: Record<CandidateKind, string[]> = {
  potential_opportunity: ["potential_opportunities", "general_crypto_intelligence"],
  emerging_narrative: ["emerging_narratives"],
  hidden_gem: ["hidden_gems"],
  major_event: ["major_events"],
  unusual_market_behaviour: ["unusual_market_behaviour", "significant_market_changes"],
  risk: ["risk_signals"],
  anomaly: ["anomalies"],
  significant_development: ["significant_market_changes", "general_crypto_intelligence"],
  search_mention: ["emerging_narratives", "general_crypto_intelligence"],
  single_source_report: ["emerging_narratives", "cross_source_corroboration"],
  asset_specific_change: ["asset_specific_changes"],
  general_market_trend: ["general_market_trends"],
};

const RISK_TEXT = /\b(hack|exploit|breach|rug|insolvent|depeg(?:ged|ging)?)\b/i;
const DISCLAIMER =
  "May warrant further investigation. Not a recommendation to buy, sell, or trade.";

export function discoverCandidate(input: {
  facts: EventFacts;
  objectives: string[];
  text: string;
  material: MaterialityDecision;
}): DiscoveryDecision {
  const { facts, material } = input;
  if (facts.evidenceCount <= 0 || material.reason === "no_evidence") {
    return {
      candidate: false,
      kind: null,
      epistemicStatus: null,
      reason: "no_evidence",
      matchedObjectives: [],
    };
  }
  if (material.reason === "reprint_only" || facts.derivedCount >= facts.evidenceCount) {
    return {
      candidate: false,
      kind: null,
      epistemicStatus: null,
      reason: "reprint_only",
      matchedObjectives: [],
    };
  }

  const flags = kindFlags(facts, input.text, material);
  const kind = selectKind(flags);
  const matchedObjectives = (KIND_OBJECTIVES[kind] ?? []).filter((id) =>
    input.objectives.includes(id),
  );
  return {
    candidate: true,
    kind,
    epistemicStatus: epistemicFromFacts(facts),
    reason: `${kind.replaceAll("_", " ")} candidate. ${DISCLAIMER}`,
    matchedObjectives,
  };
}

export function epistemicFromFacts(
  facts: EventFacts,
): Exclude<EpistemicStatus, "inferred" | "signal"> {
  if (facts.independentOriginCount >= 2 && facts.contentCompleteness !== "snippet") {
    return "confirmed";
  }
  if (facts.independentHostCount >= 2 && facts.contentCompleteness !== "snippet") {
    return "confirmed";
  }
  if (facts.priceChangePct !== undefined || facts.volumeUsd !== undefined) {
    return "observed";
  }
  return "discovered";
}

export function nextEventStatus(input: {
  evidenceCount: number;
  discovery: DiscoveryDecision;
  material: MaterialityDecision;
}): EventPipelineStatus {
  if (input.evidenceCount <= 0) {
    return "empty";
  }
  if (input.material.material) {
    return "needs_analysis";
  }
  if (input.discovery.candidate) {
    return "candidate";
  }
  return "immaterial";
}

export function formatDiscoveryNotes(discovery: DiscoveryDecision): string[] {
  if (!discovery.candidate || !discovery.kind || !discovery.epistemicStatus) {
    return [
      "Discovery: not a candidate",
      discovery.reason ? `Discovery reason: ${discovery.reason}` : "",
    ].filter(Boolean);
  }
  return [
    `Discovery: ${discovery.kind.replaceAll("_", " ")} candidate`,
    `Epistemic status: ${discovery.epistemicStatus} — not a signal`,
    DISCLAIMER,
    "Opportunity means this may warrant further investigation. Keep DISCOVERED, OBSERVED, CONFIRMED, INFERRED, and SIGNAL distinct.",
    discovery.matchedObjectives.length > 0
      ? `Matched objectives: ${discovery.matchedObjectives.join(", ")}`
      : "Matched objectives: none (discovery still proceeds from evidence)",
  ];
}

function kindFlags(
  facts: EventFacts,
  text: string,
  material: MaterialityDecision,
): Record<CandidateKind, boolean> {
  const news = facts.sourceFamilies.some(
    (family) => family === "search" || family === "x" || family === "discord",
  );
  const meme = facts.assetClasses.includes("meme_coin");
  const quotes = facts.priceChangePct !== undefined || facts.volumeUsd !== undefined;
  return {
    risk:
      facts.pegEvidence ||
      facts.regulatoryPrimary ||
      RISK_TEXT.test(text) ||
      (facts.holderClaim && /\b(exploit|hack|insolvent)\b/i.test(text)),
    anomaly: facts.contradictingCount > 0,
    unusual_market_behaviour: facts.marketReaction === "strong",
    emerging_narrative:
      facts.firstIndependentMention &&
      news &&
      facts.hasValidatedClaim &&
      facts.contentCompleteness !== "snippet",
    hidden_gem:
      facts.firstIndependentMention && (facts.watchlistOverlap || meme) && facts.hasValidatedClaim,
    major_event: material.material && facts.independentOriginCount >= 2,
    significant_development: facts.hasTrustedFirsthand,
    search_mention:
      news &&
      (facts.contentCompleteness === "snippet" || !facts.hasValidatedClaim) &&
      facts.firstIndependentMention,
    single_source_report:
      facts.hasValidatedClaim &&
      facts.independentOriginCount <= 1 &&
      facts.contentCompleteness !== "snippet",
    asset_specific_change: facts.watchlistOverlap && (quotes || facts.primaryCount > 0),
    general_market_trend: quotes && !news,
    potential_opportunity: true,
  };
}

function selectKind(flags: Record<CandidateKind, boolean>): CandidateKind {
  const matching = KIND_RANK.filter((kind) => flags[kind] && kind !== "potential_opportunity");
  return matching[0] ?? "potential_opportunity";
}
