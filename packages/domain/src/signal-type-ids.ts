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

export function isTypedSignalId(value: string): value is TypedSignalId {
  return TYPED_SET.has(value);
}
