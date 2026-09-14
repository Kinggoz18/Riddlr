import { describe, expect, it } from "vitest";
import {
  collectSignalProofFacts,
  evaluateTypedSignal,
  typedSignalForCatalyst,
} from "./signal-types.js";

describe("typed signal mapping", () => {
  it("maps the eight shipped types and leaves exchange inflow untyped", () => {
    expect(typedSignalForCatalyst("security_incident")).toBe("exploit_or_bridge_drain");
    expect(typedSignalForCatalyst("large_transfer")).toBe("exploit_or_bridge_drain");
    expect(
      typedSignalForCatalyst("large_transfer", {
        isExchangeInflow: true,
        isExploitTransfer: false,
      }),
    ).toBeUndefined();
    expect(typedSignalForCatalyst("peg_deviation")).toBe("stablecoin_peg_deviation");
    expect(typedSignalForCatalyst("token_unlock")).toBe("token_unlock");
    expect(typedSignalForCatalyst("listing_or_delisting")).toBe("listing_or_delisting");
    expect(typedSignalForCatalyst("governance_proposal")).toBe("governance_proposal");
    expect(typedSignalForCatalyst("regulatory_or_legal_action")).toBe("regulatory_legal_sanction");
    expect(typedSignalForCatalyst("sanction")).toBe("regulatory_legal_sanction");
    expect(typedSignalForCatalyst("macro_policy_decision")).toBe("macro_policy_catalyst");
    expect(typedSignalForCatalyst("principal_statement")).toBe("macro_policy_catalyst");
    expect(typedSignalForCatalyst("market_stress")).toBe("perp_stress");
    expect(typedSignalForCatalyst("observed_anomaly")).toBeUndefined();
    expect(typedSignalForCatalyst("insider_transaction")).toBeUndefined();
  });
});

describe("typed signal proof policies", () => {
  it("validates exploit with tx evidence plus an independent write-up or official status", () => {
    const writeup = evaluateTypedSignal({
      eventType: "security_incident",
      proof: collectSignalProofFacts({
        evidence: [{ sourceFamily: "onchain" }, { sourceFamily: "search" }],
      }),
    });
    expect(writeup.persist).toBe(true);
    expect(writeup.outputKind).toBe("signal");
    expect(writeup.reason).toBe("exploit_tx_and_writeup_or_status");
    const status = evaluateTypedSignal({
      eventType: "security_incident",
      proof: collectSignalProofFacts({
        evidence: [
          { sourceFamily: "onchain" },
          { sourceFamily: "feed", trustTier: "official_firsthand" },
        ],
      }),
    });
    expect(status.outputKind).toBe("signal");
    expect(status.reason).toBe("exploit_tx_and_writeup_or_status");
  });

  it("early-warns exploit from a detector alone or one social origin", () => {
    const detector = evaluateTypedSignal({
      eventType: "security_incident",
      proof: collectSignalProofFacts({
        evidence: [{ sourceFamily: "observation" }],
      }),
    });
    expect(detector.outputKind).toBe("unverified_early_warning");
    expect(detector.reason).toBe("exploit_detector_only");
    const social = evaluateTypedSignal({
      eventType: "security_incident",
      proof: collectSignalProofFacts({
        evidence: [{ sourceFamily: "x", trustTier: "community" }],
      }),
    });
    expect(social.outputKind).toBe("unverified_early_warning");
    expect(social.reason).toBe("exploit_social_origin");
  });

  it("does not persist a web-only corroborated exploit without tx evidence", () => {
    const evaluated = evaluateTypedSignal({
      eventType: "security_incident",
      proof: collectSignalProofFacts({
        evidence: [{ sourceFamily: "search" }, { sourceFamily: "search" }],
      }),
    });
    expect(evaluated.persist).toBe(false);
    expect(evaluated.reason).toBe("exploit_missing_tx_or_detector");
  });

  it("validates peg deviation with detector plus issuer or exchange statement", () => {
    const evaluated = evaluateTypedSignal({
      eventType: "peg_deviation",
      proof: collectSignalProofFacts({
        evidence: [
          { sourceFamily: "observation" },
          { sourceFamily: "search", trustTier: "official_firsthand" },
        ],
      }),
    });
    expect(evaluated.outputKind).toBe("signal");
    expect(evaluated.reason).toBe("peg_detector_and_issuer_statement");
  });

  it("early-warns peg deviation from the detector alone", () => {
    const evaluated = evaluateTypedSignal({
      eventType: "peg_deviation",
      proof: collectSignalProofFacts({
        evidence: [{ sourceFamily: "observation" }],
      }),
    });
    expect(evaluated.outputKind).toBe("unverified_early_warning");
    expect(evaluated.reason).toBe("peg_detector_only");
  });

  it("persists token unlock as anticipated and withholds notify without calendar evidence", () => {
    const anticipated = evaluateTypedSignal({
      eventType: "token_unlock",
      proof: collectSignalProofFacts({
        evidence: [{ sourceFamily: "search" }],
      }),
    });
    expect(anticipated.persist).toBe(true);
    expect(anticipated.anticipated).toBe(true);
    expect(anticipated.notifyAsEarlyWarning).toBe(false);
    expect(anticipated.allowValidatedNotify).toBe(false);
    expect(anticipated.reason).toBe("unlock_anticipated");
    const calendar = evaluateTypedSignal({
      eventType: "token_unlock",
      proof: collectSignalProofFacts({
        evidence: [{ sourceFamily: "calendar" }],
      }),
    });
    expect(calendar.anticipated).toBe(true);
    expect(calendar.allowValidatedNotify).toBe(true);
    expect(calendar.reason).toBe("unlock_calendar_evidence");
  });

  it("validates listing from an official exchange feed and early-warns web or social only", () => {
    const official = evaluateTypedSignal({
      eventType: "listing_or_delisting",
      proof: collectSignalProofFacts({
        evidence: [{ sourceFamily: "feed", trustTier: "official_firsthand" }],
      }),
    });
    expect(official.outputKind).toBe("signal");
    expect(official.reason).toBe("listing_official_exchange_feed");
    const web = evaluateTypedSignal({
      eventType: "listing_or_delisting",
      proof: collectSignalProofFacts({
        evidence: [{ sourceFamily: "search" }, { sourceFamily: "search" }],
      }),
    });
    expect(web.outputKind).toBe("unverified_early_warning");
    expect(web.reason).toBe("listing_web_or_social_only");
  });

  it("validates governance from Snapshot proposal evidence and refuses web-only proposals", () => {
    const proposal = evaluateTypedSignal({
      eventType: "governance_proposal",
      proof: collectSignalProofFacts({
        evidence: [{ sourceFamily: "governance", trustTier: "official_firsthand" }],
      }),
    });
    expect(proposal.outputKind).toBe("signal");
    expect(proposal.reason).toBe("governance_proposal_evidence");
    const web = evaluateTypedSignal({
      eventType: "governance_proposal",
      proof: collectSignalProofFacts({
        evidence: [{ sourceFamily: "search" }],
      }),
    });
    expect(web.persist).toBe(false);
    expect(web.reason).toBe("governance_missing_proposal_evidence");
  });

  it("validates regulatory action from an official document and early-warns web only", () => {
    const official = evaluateTypedSignal({
      eventType: "regulatory_or_legal_action",
      proof: collectSignalProofFacts({
        evidence: [{ sourceFamily: "search", trustTier: "official_firsthand" }],
      }),
    });
    expect(official.outputKind).toBe("signal");
    expect(official.reason).toBe("regulatory_official_document");
    const web = evaluateTypedSignal({
      eventType: "regulatory_or_legal_action",
      proof: collectSignalProofFacts({
        evidence: [{ sourceFamily: "search" }],
      }),
    });
    expect(web.outputKind).toBe("unverified_early_warning");
    expect(web.reason).toBe("regulatory_web_only");
  });

  it("validates macro policy from official text and early-warns odds jump or principal post", () => {
    const official = evaluateTypedSignal({
      eventType: "macro_policy_decision",
      proof: collectSignalProofFacts({
        evidence: [{ sourceFamily: "feed", trustTier: "official_firsthand" }],
      }),
    });
    expect(official.outputKind).toBe("signal");
    expect(official.reason).toBe("macro_official_text");
    const odds = evaluateTypedSignal({
      eventType: "macro_policy_decision",
      proof: collectSignalProofFacts({
        evidence: [{ sourceFamily: "observation" }],
        claims: [{ kind: "crypto:macro_policy_decision", predicate: "odds_jump" }],
      }),
    });
    expect(odds.outputKind).toBe("unverified_early_warning");
    expect(odds.reason).toBe("macro_odds_jump");
    const principal = evaluateTypedSignal({
      eventType: "principal_statement",
      proof: collectSignalProofFacts({
        evidence: [{ sourceFamily: "x", trustTier: "known_analyst" }],
        claims: [{ kind: "crypto:principal_statement", predicate: "said" }],
      }),
    });
    expect(principal.outputKind).toBe("unverified_early_warning");
    expect(principal.reason).toBe("macro_principal_post");
  });

  it("never persists perp stress as a fundamental signal and early-warns on detector trip", () => {
    const detector = evaluateTypedSignal({
      eventType: "market_stress",
      proof: collectSignalProofFacts({
        evidence: [{ sourceFamily: "observation" }],
      }),
    });
    expect(detector.persist).toBe(true);
    expect(detector.outputKind).toBe("unverified_early_warning");
    expect(detector.epistemicStatus).toBe("observed");
    expect(detector.reason).toBe("perp_stress_detector");
    const article = evaluateTypedSignal({
      eventType: "market_stress",
      proof: collectSignalProofFacts({
        evidence: [{ sourceFamily: "search" }, { sourceFamily: "search" }],
      }),
    });
    expect(article.persist).toBe(false);
    expect(article.outputKind).not.toBe("unverified_early_warning");
    expect(article.reason).toBe("perp_stress_missing_detector");
  });
});
