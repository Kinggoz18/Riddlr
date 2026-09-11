import { takeBounded } from "./limits.js";
import type { RiskLevel } from "./signal.js";
import { MAX_SELECTED_SKILLS_PER_ANALYSIS, skillPurposeLine } from "./skills.js";

export const SKILL_CATEGORIES = [
  "discovery",
  "evidence",
  "domain_analysis",
  "market_context",
  "validation",
  "risk",
  "signal_gate",
] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const SKILL_DATA_KINDS = [
  "independent_evidence",
  "news_or_social",
  "market_quotes",
  "liquidity_metrics",
  "stablecoin_exposure",
  "regulatory_claims",
  "holder_claims",
] as const;
export type SkillDataKind = (typeof SKILL_DATA_KINDS)[number];

export type SkillCapability = {
  slug: string;
  displayName: string;
  description: string;
  category: SkillCategory;
  stage: number;
  specificity: number;
  core?: boolean;
  requiredAny?: SkillDataKind[];
  skipIfMissing?: SkillDataKind;
};

export const SHIPPED_CRYPTO_SKILLS: SkillCapability[] = [
  {
    slug: "candidate-discovery",
    displayName: "Candidate discovery",
    description: "Keep discovery distinct from analysis. A candidate is not a trade.",
    category: "discovery",
    stage: 5,
    specificity: 100,
    core: true,
  },
  {
    slug: "event-correlation",
    displayName: "Event correlation",
    description: "Relate evidence items without treating reprints as independent proof.",
    category: "evidence",
    stage: 10,
    specificity: 100,
    core: true,
  },
  {
    slug: "early-trend-detection",
    displayName: "Early trend detection",
    description: "Ask whether something is starting, before it is a coherent narrative.",
    category: "domain_analysis",
    stage: 20,
    specificity: 20,
    requiredAny: ["news_or_social"],
  },
  {
    slug: "narrative-detection",
    displayName: "Narrative analysis",
    description: "Decide whether attention has become a coherent market narrative.",
    category: "domain_analysis",
    stage: 21,
    specificity: 20,
    requiredAny: ["news_or_social"],
  },
  {
    slug: "catalyst-analysis",
    displayName: "Catalyst analysis",
    description: "Separate what happened, why it may have happened, and what could happen next.",
    category: "domain_analysis",
    stage: 22,
    specificity: 30,
    requiredAny: ["news_or_social", "regulatory_claims"],
  },
  {
    slug: "regulatory-analysis",
    displayName: "Regulatory analysis",
    description: "Apply an evidence hierarchy before stating what a regulator did.",
    category: "domain_analysis",
    stage: 23,
    specificity: 50,
    requiredAny: ["regulatory_claims"],
  },
  {
    slug: "stablecoin-risk",
    displayName: "Stablecoin risk",
    description: "Assess stablecoin stress from evidence, not from assumed reserves.",
    category: "domain_analysis",
    stage: 24,
    specificity: 50,
    requiredAny: ["stablecoin_exposure"],
  },
  {
    slug: "whale-activity",
    displayName: "Large holder activity",
    description: "Interpret reported large-holder activity without assuming on-chain sight.",
    category: "domain_analysis",
    stage: 25,
    specificity: 50,
    requiredAny: ["holder_claims"],
  },
  {
    slug: "market-regime-analysis",
    displayName: "Market context",
    description: "Ask how the current market environment changes interpretation of this event.",
    category: "market_context",
    stage: 30,
    specificity: 40,
    skipIfMissing: "market_quotes",
    requiredAny: ["market_quotes"],
  },
  {
    slug: "price-reaction-analysis",
    displayName: "Price reaction",
    description: "Ask whether the market actually cared, using only sourced figures.",
    category: "market_context",
    stage: 31,
    specificity: 40,
    skipIfMissing: "market_quotes",
    requiredAny: ["market_quotes"],
  },
  {
    slug: "liquidity-analysis",
    displayName: "Liquidity",
    description: "Distinguish price movement from tradeability.",
    category: "market_context",
    stage: 32,
    specificity: 40,
    skipIfMissing: "liquidity_metrics",
    requiredAny: ["liquidity_metrics"],
  },
  {
    slug: "contrarian-analysis",
    displayName: "Contrarian review",
    description:
      "Challenge the leading thesis before a medium, high, or critical signal is issued.",
    category: "validation",
    stage: 40,
    specificity: 100,
    core: true,
  },
  {
    slug: "materiality-analysis",
    displayName: "Materiality",
    description: "Decide whether this is important enough to interrupt the operator.",
    category: "signal_gate",
    stage: 50,
    specificity: 100,
    core: true,
  },
  {
    slug: "risk-assessment",
    displayName: "Risk assessment",
    description: "Keep risk as a first-class dimension, separate from confidence.",
    category: "risk",
    stage: 51,
    specificity: 100,
    core: true,
  },
];

export const SHIPPED_CRYPTO_SKILL_SLUGS = SHIPPED_CRYPTO_SKILLS.map((item) => item.slug);

const CATALOG_BY_SLUG = new Map(SHIPPED_CRYPTO_SKILLS.map((item) => [item.slug, item]));

export function shippedSkillCapability(slug: string): SkillCapability | undefined {
  return CATALOG_BY_SLUG.get(slug);
}

export function skillOperatorCopy(input: {
  slug: string;
  description?: string | null;
  markdownBody?: string;
}): { displayName: string; description: string } {
  const catalog = CATALOG_BY_SLUG.get(input.slug);
  return {
    displayName: catalog?.displayName ?? input.slug,
    description:
      input.description?.trim() ||
      catalog?.description ||
      skillPurposeLine(input.markdownBody ?? "") ||
      "",
  };
}

export type SkillApplicabilityFacts = {
  present: Partial<Record<SkillDataKind, boolean>>;
  expectedRisk?: RiskLevel;
};

export type SkillDecision = {
  slug: string;
  displayName: string;
  category: SkillCategory | "user";
  selected: boolean;
  reason: string;
};

export type SkillSelection = {
  selected: SkillDecision[];
  skipped: SkillDecision[];
};

export function selectApplicableSkills(input: {
  attached: Array<{ slug: string }>;
  facts: SkillApplicabilityFacts;
  limit?: number;
}): SkillSelection {
  const limit = input.limit ?? MAX_SELECTED_SKILLS_PER_ANALYSIS;
  const present = input.facts.present;
  const hasEvidence = Boolean(present.independent_evidence);
  const ranked: Array<SkillDecision & { stage: number; core: boolean; specificity: number }> = [];
  const skipped: SkillDecision[] = [];

  for (const skill of input.attached) {
    const catalog = CATALOG_BY_SLUG.get(skill.slug);
    if (!catalog) {
      ranked.push({
        slug: skill.slug,
        displayName: skill.slug,
        category: "user",
        selected: true,
        reason: "user_skill_attached",
        stage: 80,
        specificity: 10,
        core: false,
      });
      continue;
    }
    const decisionBase = {
      slug: catalog.slug,
      displayName: catalog.displayName,
      category: catalog.category,
    };
    if (!hasEvidence) {
      skipped.push({ ...decisionBase, selected: false, reason: "no_evidence" });
      continue;
    }
    if (catalog.skipIfMissing && !present[catalog.skipIfMissing]) {
      skipped.push({
        ...decisionBase,
        selected: false,
        reason: missingReason(catalog.skipIfMissing),
      });
      continue;
    }
    if (catalog.requiredAny && !catalog.requiredAny.some((kind) => present[kind])) {
      skipped.push({ ...decisionBase, selected: false, reason: "not_applicable" });
      continue;
    }
    ranked.push({
      ...decisionBase,
      selected: true,
      reason: catalog.core ? "core_validation" : "applicable",
      stage: catalog.stage,
      specificity: catalog.specificity,
      core: Boolean(catalog.core),
    });
  }

  ranked.sort((left, right) => {
    if (left.core !== right.core) {
      return left.core ? -1 : 1;
    }
    if (left.specificity !== right.specificity) {
      return right.specificity - left.specificity;
    }
    return left.stage - right.stage;
  });
  const kept = takeBounded(ranked, limit);
  const overflow = ranked.slice(kept.length).map((item) => ({
    slug: item.slug,
    displayName: item.displayName,
    category: item.category,
    selected: false,
    reason: "prompt_budget",
  }));
  return {
    selected: kept.map(
      ({ stage: _stage, core: _core, specificity: _specificity, ...item }) => item,
    ),
    skipped: [...skipped, ...overflow],
  };
}

function missingReason(kind: SkillDataKind): string {
  switch (kind) {
    case "market_quotes":
      return "market_quotes_unavailable";
    case "liquidity_metrics":
      return "liquidity_evidence_unavailable";
    default:
      return `${kind}_unavailable`;
  }
}

export function skippedSkillNotice(decision: SkillDecision): string | undefined {
  if (decision.selected) {
    return undefined;
  }
  if (
    decision.slug === "liquidity-analysis" &&
    decision.reason === "liquidity_evidence_unavailable"
  ) {
    return "Liquidity analysis unavailable — no reliable liquidity data was provided.";
  }
  if (
    decision.slug === "price-reaction-analysis" &&
    decision.reason === "market_quotes_unavailable"
  ) {
    return "Price reaction analysis unavailable — no sourced market quotes were provided.";
  }
  if (
    decision.slug === "market-regime-analysis" &&
    decision.reason === "market_quotes_unavailable"
  ) {
    return "Market regime cannot be confidently assessed — required market context was not provided.";
  }
  if (decision.slug === "whale-activity" && decision.reason === "not_applicable") {
    return "Large-holder analysis skipped — no reported large-holder activity was in evidence.";
  }
  return undefined;
}
