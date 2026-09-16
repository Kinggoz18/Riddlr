import {
  acceptedSubjectCanonicalId,
  CATALYST_SEVERITY_PRIOR,
  type CatalystKind,
  canonicalizeFromRegistry,
  claimSatisfiesCatalystContract,
  claimTitle,
  type DomainModule,
  type ExtractedAsset,
  eventJoinWindowForKind,
  fingerprintClaim,
  claimsCompatible as genericClaimsCompatible,
  isCatalystKind,
  isSubjectFreeCatalyst,
  type NormalizedEvidence,
  resolveEvidenceAssets,
  selectPrincipalCatalyst,
  takeBounded,
  watchlistSearchQuery,
} from "@riddlr/domain";
import { equitiesRelevanceTerms } from "./relevance-terms.js";
import { EQUITIES_RESOLVER_RULES, equitiesAssetClassFor } from "./resolver-rules.js";

export const DEFAULT_EQUITIES_WATCHLIST: ExtractedAsset[] = [
  {
    assetClass: "stock",
    canonicalId: "sec:0000320193",
    symbol: "AAPL",
    displayName: "Apple Inc.",
  },
  {
    assetClass: "stock",
    canonicalId: "sec:0000789019",
    symbol: "MSFT",
    displayName: "Microsoft Corp",
  },
];

export const DEFAULT_EQUITIES_AGENT_NAME = "Equities Intelligence Agent";
export const DEFAULT_EQUITIES_AGENT_DESCRIPTION =
  "An Equities watcher. It scans SEC EDGAR filings for watched issuers, clusters evidence into events, and analyzes only material events. It cannot trade.";

export const DEFAULT_EQUITIES_OBJECTIVES = [
  "general_equities_intelligence",
  "major_events",
  "risk_signals",
  "cross_source_corroboration",
  "asset_specific_changes",
] as const;

const EQUITIES_ASSET_CLASSES = ["stock", "etf", "index"] as const;

export const EQUITIES_CLAIM_KINDS = [
  "equities:earnings",
  "equities:insider_transaction",
  "equities:listing_or_delisting",
  "equities:insolvency",
  "equities:officer_change",
  "equities:impairment_or_exit",
  "equities:ownership_change",
  "equities:material_corporate_event",
  "equities:general_report",
] as const;

export const EQUITIES_CLAIM_TO_CATALYST: Record<
  (typeof EQUITIES_CLAIM_KINDS)[number],
  CatalystKind | undefined
> = {
  "equities:earnings": "earnings_or_guidance",
  "equities:insider_transaction": "insider_transaction",
  "equities:listing_or_delisting": "listing_or_delisting",
  "equities:insolvency": "insolvency_or_withdrawal_halt",
  "equities:officer_change": "material_corporate_event",
  "equities:impairment_or_exit": "material_corporate_event",
  "equities:ownership_change": "material_corporate_event",
  "equities:material_corporate_event": "material_corporate_event",
  "equities:general_report": undefined,
};

export const EQUITIES_CATALYST_TO_CLAIM: Partial<
  Record<CatalystKind, (typeof EQUITIES_CLAIM_KINDS)[number]>
> = {
  earnings_or_guidance: "equities:earnings",
  insider_transaction: "equities:insider_transaction",
  listing_or_delisting: "equities:listing_or_delisting",
  insolvency_or_withdrawal_halt: "equities:insolvency",
  material_corporate_event: "equities:material_corporate_event",
};

export const EQUITIES_IMPACT_POLICY_VERSION = "equities-impact-1";

const ITEM_CLAIM: Record<
  string,
  { kind: (typeof EQUITIES_CLAIM_KINDS)[number]; predicate: string }
> = {
  "1.01": { kind: "equities:material_corporate_event", predicate: "material_corporate_event" },
  "1.02": { kind: "equities:material_corporate_event", predicate: "material_corporate_event" },
  "1.03": { kind: "equities:insolvency", predicate: "insolvency_or_withdrawal_halt" },
  "2.02": { kind: "equities:earnings", predicate: "earnings_or_guidance" },
  "2.04": { kind: "equities:impairment_or_exit", predicate: "impairment_or_exit" },
  "2.05": { kind: "equities:impairment_or_exit", predicate: "impairment_or_exit" },
  "2.06": { kind: "equities:impairment_or_exit", predicate: "impairment_or_exit" },
  "3.01": { kind: "equities:listing_or_delisting", predicate: "listing_or_delisting" },
  "5.02": { kind: "equities:officer_change", predicate: "officer_change" },
  "8.01": { kind: "equities:material_corporate_event", predicate: "material_corporate_event" },
};

function completeEnough(item: NormalizedEvidence): boolean {
  return (
    item.contentCompleteness === "full_document" || item.contentCompleteness === "native_complete"
  );
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function payloadForm(evidence: NormalizedEvidence): string {
  const form = evidence.adapterPayload?.form;
  return typeof form === "string" ? form.toUpperCase() : "";
}

function payloadItems(evidence: NormalizedEvidence): string[] {
  return asStringArray(evidence.adapterPayload?.items);
}

function excerptAround(content: string, needle: string): string {
  const index = content.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) {
    return content.slice(0, 180).trim();
  }
  const start = Math.max(0, index - 40);
  return content.slice(start, start + 180).trim();
}

export function mapEightKItemToClaim(item: string): (typeof ITEM_CLAIM)[string] | undefined {
  return ITEM_CLAIM[item];
}

export const equitiesDomainModule: DomainModule = {
  id: "equities",
  assetClasses: [...EQUITIES_ASSET_CLASSES],
  claimKinds() {
    return [...EQUITIES_CLAIM_KINDS];
  },
  mapClaimKindToCatalyst(kind: string) {
    if ((EQUITIES_CLAIM_KINDS as readonly string[]).includes(kind)) {
      return EQUITIES_CLAIM_TO_CATALYST[kind as (typeof EQUITIES_CLAIM_KINDS)[number]];
    }
    if (isCatalystKind(kind) && EQUITIES_CATALYST_TO_CLAIM[kind]) {
      return kind;
    }
    return undefined;
  },
  sourceQuery(input) {
    const queries = this.sourceQueries(input);
    return queries[0] ?? "";
  },
  sourceQueries(input) {
    if (
      input.adapterId === "edgar" ||
      input.adapterId === "feeds" ||
      input.adapterId === "searxng"
    ) {
      if (input.adapterId === "searxng") {
        return [watchlistSearchQuery(input.watchlist, "equities earnings 8-K")];
      }
      return [""];
    }
    return [input.watchlist.map((item) => item.canonicalId).join(" ")];
  },
  canonicalizeAsset(input, registry = []) {
    return canonicalizeFromRegistry(input, registry);
  },
  extractAssets(evidence, registry = [], options = {}) {
    return resolveEvidenceAssets(evidence, registry, EQUITIES_RESOLVER_RULES, options);
  },
  relevanceTerms() {
    return equitiesRelevanceTerms();
  },
  extractObservations() {
    return [];
  },
  extractClaims(evidence, registry = []) {
    const out: ReturnType<DomainModule["extractClaims"]> = [];
    for (const item of evidence) {
      if (!completeEnough(item)) {
        continue;
      }
      const assets = this.extractAssets([item], registry);
      const payloadId =
        typeof item.adapterPayload?.subjectCanonicalId === "string"
          ? item.adapterPayload.subjectCanonicalId
          : undefined;
      const subjectCanonicalId = payloadId ?? assets[0]?.canonicalId;
      const timeBucket = (item.publishedAt ?? item.fetchedAt).toISOString().slice(0, 10);
      const form = payloadForm(item);
      const content = `${item.title ?? ""}\n${item.bodyText ?? ""}`;
      if (form === "4" || form === "4/A") {
        const shares = Number(item.adapterPayload?.shares);
        const price = Number(item.adapterPayload?.price);
        const value =
          Number.isFinite(shares) && Number.isFinite(price) ? shares * price : undefined;
        const published = item.publishedAt ?? item.fetchedAt;
        const txnDate =
          typeof item.adapterPayload?.transactionDate === "string"
            ? new Date(`${item.adapterPayload.transactionDate}T00:00:00Z`)
            : undefined;
        const lagHours =
          txnDate && !Number.isNaN(txnDate.getTime())
            ? (published.getTime() - txnDate.getTime()) / 3_600_000
            : undefined;
        const objectText = [
          String(item.adapterPayload?.transactionCode ?? "Form 4"),
          lagHours !== undefined ? `disclosureLagHours=${lagHours.toFixed(1)}` : undefined,
        ]
          .filter(Boolean)
          .join(" ");
        const fingerprint = fingerprintClaim({
          marketDomainId: "equities",
          kind: "equities:insider_transaction",
          subjectCanonicalId,
          polarity: "asserted",
          objectText,
          value,
          timeBucket,
        });
        const claim = {
          marketDomainId: "equities" as const,
          kind: "equities:insider_transaction",
          subjectCanonicalId,
          predicate: "insider_transaction",
          objectText,
          value,
          unit: value === undefined ? undefined : "usd",
          polarity: "asserted" as const,
          modality: "asserted" as const,
          fingerprint,
          title: "",
          excerpt: excerptAround(content, "Form 4"),
        };
        out.push({ ...claim, title: claimTitle(claim) });
        continue;
      }
      if (form.startsWith("SC 13")) {
        const fingerprint = fingerprintClaim({
          marketDomainId: "equities",
          kind: "equities:ownership_change",
          subjectCanonicalId,
          polarity: "asserted",
          objectText: form,
          timeBucket,
        });
        const claim = {
          marketDomainId: "equities" as const,
          kind: "equities:ownership_change",
          subjectCanonicalId,
          predicate: "ownership_change",
          objectText: form,
          polarity: "asserted" as const,
          modality: "asserted" as const,
          fingerprint,
          title: "",
          excerpt: excerptAround(content, form),
        };
        out.push({ ...claim, title: claimTitle(claim) });
        continue;
      }
      const items = payloadItems(item);
      for (const eightKItem of items) {
        const mapped = mapEightKItemToClaim(eightKItem);
        if (!mapped) {
          continue;
        }
        const fingerprint = fingerprintClaim({
          marketDomainId: "equities",
          kind: mapped.kind,
          subjectCanonicalId,
          polarity: "asserted",
          objectText: eightKItem,
          timeBucket,
        });
        const claim = {
          marketDomainId: "equities" as const,
          kind: mapped.kind,
          subjectCanonicalId,
          predicate: mapped.predicate,
          objectText: eightKItem,
          polarity: "asserted" as const,
          modality: "asserted" as const,
          fingerprint,
          title: "",
          excerpt: excerptAround(content, eightKItem),
        };
        out.push({ ...claim, title: claimTitle(claim) });
      }
    }
    return takeBounded(out, 32);
  },
  normalizeClaim(candidate, evidence, registry = [], allowedSubjectIds) {
    const domainKind = (EQUITIES_CLAIM_KINDS as readonly string[]).includes(candidate.kind)
      ? (candidate.kind as (typeof EQUITIES_CLAIM_KINDS)[number])
      : isCatalystKind(candidate.kind)
        ? EQUITIES_CATALYST_TO_CLAIM[candidate.kind]
        : undefined;
    if (!domainKind || domainKind === "equities:general_report") {
      return undefined;
    }
    const catalyst = EQUITIES_CLAIM_TO_CATALYST[domainKind];
    if (
      allowedSubjectIds &&
      candidate.subjectCanonicalId &&
      !allowedSubjectIds.includes(candidate.subjectCanonicalId)
    ) {
      return undefined;
    }
    const assets = this.extractAssets([evidence], registry);
    const subjectCanonicalId = acceptedSubjectCanonicalId({
      candidateId: candidate.subjectCanonicalId,
      fallbackId: assets[0]?.canonicalId,
      registry,
      allowedSubjectIds,
      subjectFree: catalyst ? isSubjectFreeCatalyst(catalyst) : false,
    });
    if (
      !claimSatisfiesCatalystContract({
        catalystKind: catalyst,
        subjectCanonicalId,
        value: candidate.value,
        unit: candidate.unit,
      })
    ) {
      return undefined;
    }
    const timeBucket = (evidence.publishedAt ?? evidence.fetchedAt).toISOString().slice(0, 10);
    const fingerprint = fingerprintClaim({
      marketDomainId: "equities",
      kind: domainKind,
      subjectCanonicalId,
      polarity: candidate.polarity,
      objectText: candidate.objectText ?? candidate.predicate,
      value: candidate.value,
      timeBucket,
    });
    const claim = {
      marketDomainId: "equities" as const,
      kind: domainKind,
      subjectCanonicalId,
      predicate: candidate.predicate,
      objectText: candidate.objectText,
      value: candidate.value,
      unit: candidate.unit,
      polarity: candidate.polarity,
      modality: candidate.modality,
      fingerprint,
      title: "",
    };
    return { ...claim, title: claimTitle(claim) };
  },
  claimsCompatible(left, right) {
    return genericClaimsCompatible(left, right);
  },
  assembleContext({ evidence, assets, observations, watchlist = [] }) {
    return {
      domainId: "equities" as const,
      observations,
      notes: [
        `Independent evidence items: ${evidence.length}`,
        `Resolved equity assets: ${assets.map((item) => item.canonicalId).join(", ") || "none"}`,
        `Watchlist: ${watchlist.map((item) => item.canonicalId).join(", ") || "none"}`,
      ],
    };
  },
  assessImpact(input) {
    if (input.retracted) {
      return {
        level: "informational",
        reason: "retracted",
        reasonCodes: ["equities:retracted"],
      };
    }
    const kinds = new Set(input.claims.map((item) => item.kind));
    const predicates = new Set(input.claims.map((item) => item.predicate));
    const catalysts = input.claims
      .map((item) => this.mapClaimKindToCatalyst(item.kind))
      .filter((item): item is CatalystKind => Boolean(item));
    const principal = selectPrincipalCatalyst(catalysts);
    const onlyInsider =
      kinds.size > 0 && [...kinds].every((kind) => kind === "equities:insider_transaction");
    if (onlyInsider) {
      return {
        level: "low",
        reason: "insider_transaction",
        reasonCodes: ["equities:insider_transaction"],
      };
    }
    if (kinds.has("equities:insolvency") || principal === "insolvency_or_withdrawal_halt") {
      return {
        level: "high",
        reason: "insolvency_or_withdrawal_halt",
        reasonCodes: ["equities:insolvency"],
      };
    }
    if (kinds.has("equities:earnings") || principal === "earnings_or_guidance") {
      return {
        level: "high",
        reason: "earnings_or_guidance",
        reasonCodes: ["equities:earnings"],
      };
    }
    if (predicates.has("impairment_or_exit") || predicates.has("officer_change")) {
      return {
        level: "high",
        reason: predicates.has("impairment_or_exit") ? "impairment_or_exit" : "officer_change",
        reasonCodes: ["equities:material_corporate_event"],
      };
    }
    if (principal) {
      const prior = CATALYST_SEVERITY_PRIOR[principal];
      if (prior === "critical" || prior === "high") {
        return {
          level: prior,
          reason: principal,
          reasonCodes: [`equities:${principal}`],
        };
      }
    }
    if (input.hasTrustedFirsthand && kinds.size > 0) {
      return {
        level: "high",
        reason: "trusted_firsthand_claim",
        reasonCodes: ["equities:firsthand"],
      };
    }
    return {
      level: "informational",
      reason: "no_high_impact_claim",
      reasonCodes: ["equities:informational"],
    };
  },
  principalClaimTitle(claim) {
    return claim.title || claimTitle(claim);
  },
  eventJoinWindow(kind) {
    return eventJoinWindowForKind(kind);
  },
  defaultAgentProfile() {
    return {
      name: DEFAULT_EQUITIES_AGENT_NAME,
      description: DEFAULT_EQUITIES_AGENT_DESCRIPTION,
      objectives: [...DEFAULT_EQUITIES_OBJECTIVES],
      assetClasses: ["stock", "etf", "index"],
    };
  },
};

export { equitiesAssetClassFor };
