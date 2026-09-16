import { describe, expect, it } from "vitest";
import {
  CATALYST_KIND_LABELS,
  CATALYST_KINDS,
  CATALYST_SEVERITY_PRIOR,
  claimSatisfiesCatalystContract,
  overlayFirstPassNegation,
  principalCatalystKindForClaims,
  QUANTITATIVE_CATALYST_KINDS,
  SUBJECT_FREE_CATALYST_KINDS,
  selectPrincipalCatalyst,
} from "./catalysts.js";
import { IMPACT_LEVELS } from "./reliability.js";

describe("catalyst taxonomy", () => {
  it("ships the cross-domain kind list from the platform spec", () => {
    expect([...CATALYST_KINDS]).toEqual([
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
    ]);
    expect(CATALYST_KINDS).toHaveLength(17);
    for (const kind of CATALYST_KINDS) {
      expect(IMPACT_LEVELS).toContain(CATALYST_SEVERITY_PRIOR[kind]);
      expect(CATALYST_KIND_LABELS[kind].length).toBeGreaterThan(2);
    }
  });

  it("requires value and unit on quantitative kinds and a subject unless the kind is macro", () => {
    expect([...QUANTITATIVE_CATALYST_KINDS]).toEqual([
      "peg_deviation",
      "token_unlock",
      "large_transfer",
      "market_stress",
      "observed_anomaly",
      "earnings_or_guidance",
    ]);
    expect([...SUBJECT_FREE_CATALYST_KINDS]).toEqual([
      "macro_policy_decision",
      "scheduled_release",
    ]);
    expect(
      claimSatisfiesCatalystContract({
        catalystKind: "peg_deviation",
        subjectCanonicalId: "coingecko:tether",
      }),
    ).toBe(false);
    expect(
      claimSatisfiesCatalystContract({
        catalystKind: "peg_deviation",
        subjectCanonicalId: "coingecko:tether",
        value: 0.92,
        unit: "usd",
      }),
    ).toBe(true);
    expect(
      claimSatisfiesCatalystContract({
        catalystKind: "peg_deviation",
        subjectCanonicalId: "coingecko:tether",
        value: 0.92,
        unit: "count",
      }),
    ).toBe(false);
    expect(
      claimSatisfiesCatalystContract({
        catalystKind: "security_incident",
        value: 1,
        unit: "count",
      }),
    ).toBe(false);
    expect(
      claimSatisfiesCatalystContract({
        catalystKind: "security_incident",
        subjectCanonicalId: "coingecko:bitcoin",
      }),
    ).toBe(true);
    expect(claimSatisfiesCatalystContract({ catalystKind: "macro_policy_decision" })).toBe(true);
    expect(claimSatisfiesCatalystContract({ catalystKind: undefined })).toBe(false);
  });

  it("selects the higher severity prior as the principal kind", () => {
    expect(selectPrincipalCatalyst(["listing_or_delisting", "security_incident"])).toBe(
      "security_incident",
    );
    expect(
      principalCatalystKindForClaims(["crypto:market_move", "crypto:insolvency"], (kind) => {
        if (kind === "crypto:insolvency") {
          return "insolvency_or_withdrawal_halt";
        }
        if (kind === "crypto:market_move") {
          return "listing_or_delisting";
        }
        return undefined;
      }),
    ).toBe("insolvency_or_withdrawal_halt");
  });

  it("applies first-pass negation onto the primary structured claims", () => {
    const overlaid = overlayFirstPassNegation(
      [
        {
          kind: "security_incident",
          predicate: "security_incident",
          polarity: "asserted",
          modality: "asserted",
          excerpt: "no hack occurred",
          subjectCanonicalId: "coingecko:bitcoin",
        },
      ],
      [
        {
          kind: "crypto:security_incident",
          subjectCanonicalId: "coingecko:bitcoin",
          polarity: "negated",
        },
      ],
      (kind) => (kind.includes("security_incident") ? "security_incident" : undefined),
    );
    expect(overlaid[0]?.polarity).toBe("negated");
  });
});
