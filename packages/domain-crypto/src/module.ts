import {
  buildAssetNewsQuery,
  buildDomainGeneralNewsQuery,
  CATALYST_SEVERITY_PRIOR,
  type CatalystKind,
  canonicalizeFromRegistry,
  claimSatisfiesCatalystContract,
  claimTitle,
  classifyPageHeuristic,
  DEFAULT_AGENT_DESCRIPTION,
  DEFAULT_AGENT_NAME,
  DEFAULT_EXPLOIT_TRANSFER_USD,
  type DetectorSpec,
  type DomainModule,
  type ExtractedAsset,
  eventJoinWindowForKind,
  FUNDING_DIVERGENCE_V1,
  fingerprintClaim,
  claimsCompatible as genericClaimsCompatible,
  isCatalystKind,
  MARKET_STRESS_V1,
  MAX_SEARXNG_ASSET_QUERIES,
  MAX_SNAPSHOT_SPACES,
  type MarketObservation,
  type NormalizedEvidence,
  ODDS_JUMP_V1,
  PEG_DEVIATION_V1,
  RETURN_SHOCK_V1,
  type RegistryAsset,
  resolveEvidenceAssets,
  selectPrincipalCatalyst,
  TVL_DRAWDOWN_V1,
  takeBounded,
  VOLUME_ANOMALY_V1,
  watchlistSearchQuery,
  weakClaimObject,
} from "@riddlr/domain";
import { CRYPTO_RESOLVER_RULES } from "./resolver-rules.js";

export const DEFAULT_CRYPTO_WATCHLIST: ExtractedAsset[] = [
  {
    assetClass: "cryptocurrency",
    canonicalId: "coingecko:bitcoin",
    symbol: "BTC",
    displayName: "Bitcoin",
  },
  {
    assetClass: "cryptocurrency",
    canonicalId: "coingecko:ethereum",
    symbol: "ETH",
    displayName: "Ethereum",
  },
  {
    assetClass: "stablecoin",
    canonicalId: "coingecko:tether",
    symbol: "USDT",
    displayName: "Tether",
  },
];

export const CRYPTO_SNAPSHOT_SPACES: Readonly<Record<string, string>> = {
  "coingecko:aave": "aave.eth",
  "coingecko:uniswap": "uniswapgovernance.eth",
  "coingecko:compound-governance-token": "compound-governance.eth",
  "coingecko:ethereum-name-service": "ens.eth",
};

export function snapshotSpacesForWatchlist(
  watchlist: readonly { canonicalId: string }[],
  registry: readonly RegistryAsset[] = [],
): { spaces: string[]; spaceAssets: Record<string, string> } {
  const spaces: string[] = [];
  const spaceAssets: Record<string, string> = {};
  for (const item of takeBounded(watchlist, MAX_SNAPSHOT_SPACES)) {
    const mapped = CRYPTO_SNAPSHOT_SPACES[item.canonicalId];
    if (mapped) {
      spaces.push(mapped);
      spaceAssets[mapped] = item.canonicalId;
    }
    const extra = registry.find((asset) => asset.canonicalId === item.canonicalId)?.externalIds
      .snapshotSpaces;
    for (const space of extra ?? []) {
      if (typeof space === "string" && space.trim()) {
        const id = space.trim().toLowerCase();
        spaces.push(id);
        spaceAssets[id] = item.canonicalId;
      }
    }
  }
  const unique = [...new Set(spaces)];
  return {
    spaces: takeBounded(unique, MAX_SNAPSHOT_SPACES),
    spaceAssets,
  };
}

const CRYPTO_ASSET_CLASSES = ["cryptocurrency", "meme_coin", "stablecoin"] as const;

export const CRYPTO_SEARXNG_CATALYST_KEYWORDS = [
  "hack",
  "exploit",
  "depeg",
  "listing",
  "SEC",
  "lawsuit",
  "outage",
  "unlock",
] as const;

export const CRYPTO_SEARXNG_GENERAL_FALLBACK = "cryptocurrency bitcoin ethereum stablecoin news";

export const DEFAULT_CRYPTO_OBJECTIVES = [
  "general_crypto_intelligence",
  "emerging_narratives",
  "major_events",
  "significant_market_changes",
  "risk_signals",
  "cross_source_corroboration",
  "potential_opportunities",
  "hidden_gems",
  "unusual_market_behaviour",
  "anomalies",
  "asset_specific_changes",
  "general_market_trends",
] as const;

const LEGACY_CRYPTO_OBJECTIVES = [
  "general_crypto_intelligence",
  "emerging_narratives",
  "major_events",
  "significant_market_changes",
  "risk_signals",
  "cross_source_corroboration",
];

export const CRYPTO_CLAIM_KINDS = [
  "crypto:security_incident",
  "crypto:insolvency",
  "crypto:stablecoin_peg_change",
  "crypto:token_unlock",
  "crypto:listing_or_delisting",
  "crypto:market_move",
  "crypto:governance_proposal",
  "crypto:regulatory_action",
  "crypto:sanction",
  "crypto:macro_policy_decision",
  "crypto:scheduled_release",
  "crypto:service_outage",
  "crypto:material_corporate_event",
  "crypto:large_transfer",
  "crypto:market_stress",
  "crypto:principal_statement",
  "crypto:general_report",
  "crypto:observed_spot_price_anomaly",
  "crypto:observed_quoted_volume_anomaly",
  "crypto:observed_tvl_anomaly",
] as const;

export const CRYPTO_CLAIM_TO_CATALYST: Record<
  (typeof CRYPTO_CLAIM_KINDS)[number],
  CatalystKind | undefined
> = {
  "crypto:security_incident": "security_incident",
  "crypto:insolvency": "insolvency_or_withdrawal_halt",
  "crypto:stablecoin_peg_change": "peg_deviation",
  "crypto:token_unlock": "token_unlock",
  "crypto:listing_or_delisting": "listing_or_delisting",
  "crypto:market_move": "listing_or_delisting",
  "crypto:governance_proposal": "governance_proposal",
  "crypto:regulatory_action": "regulatory_or_legal_action",
  "crypto:sanction": "sanction",
  "crypto:macro_policy_decision": "macro_policy_decision",
  "crypto:scheduled_release": "scheduled_release",
  "crypto:service_outage": "material_corporate_event",
  "crypto:material_corporate_event": "material_corporate_event",
  "crypto:large_transfer": "large_transfer",
  "crypto:market_stress": "market_stress",
  "crypto:principal_statement": "principal_statement",
  "crypto:general_report": undefined,
  "crypto:observed_spot_price_anomaly": "observed_anomaly",
  "crypto:observed_quoted_volume_anomaly": "observed_anomaly",
  "crypto:observed_tvl_anomaly": "observed_anomaly",
};

export const CRYPTO_CATALYST_TO_CLAIM: Partial<
  Record<CatalystKind, (typeof CRYPTO_CLAIM_KINDS)[number]>
> = {
  security_incident: "crypto:security_incident",
  insolvency_or_withdrawal_halt: "crypto:insolvency",
  peg_deviation: "crypto:stablecoin_peg_change",
  token_unlock: "crypto:token_unlock",
  listing_or_delisting: "crypto:listing_or_delisting",
  governance_proposal: "crypto:governance_proposal",
  regulatory_or_legal_action: "crypto:regulatory_action",
  sanction: "crypto:sanction",
  macro_policy_decision: "crypto:macro_policy_decision",
  scheduled_release: "crypto:scheduled_release",
  material_corporate_event: "crypto:material_corporate_event",
  large_transfer: "crypto:large_transfer",
  market_stress: "crypto:market_stress",
  principal_statement: "crypto:principal_statement",
};

export const CRYPTO_IMPACT_POLICY_VERSION = "crypto-impact-1";

export const CRYPTO_DETECTOR_SPECS: readonly DetectorSpec[] = [
  { ...RETURN_SHOCK_V1, claimKind: "crypto:observed_spot_price_anomaly" },
  { ...VOLUME_ANOMALY_V1, claimKind: "crypto:observed_quoted_volume_anomaly" },
  { ...TVL_DRAWDOWN_V1, claimKind: "crypto:observed_tvl_anomaly" },
  { ...PEG_DEVIATION_V1, claimKind: "crypto:stablecoin_peg_change" },
  { ...MARKET_STRESS_V1, claimKind: "crypto:market_stress", provider: "hyperliquid" },
  { ...MARKET_STRESS_V1, claimKind: "crypto:market_stress", provider: "binance-futures" },
  { ...FUNDING_DIVERGENCE_V1, claimKind: "crypto:market_stress", provider: "hyperliquid" },
  { ...FUNDING_DIVERGENCE_V1, claimKind: "crypto:market_stress", provider: "binance-futures" },
  { ...ODDS_JUMP_V1, claimKind: "crypto:macro_policy_decision", provider: "polymarket" },
  { ...ODDS_JUMP_V1, claimKind: "crypto:macro_policy_decision", provider: "kalshi" },
];

const CLAIM_PATTERNS: Array<{
  kind: (typeof CRYPTO_CLAIM_KINDS)[number];
  predicate: string;
  re: RegExp;
  quantitative?: boolean;
}> = [
  {
    kind: "crypto:security_incident",
    predicate: "security_incident",
    re: /\b(hack|exploit|breach|compromised)\b/i,
  },
  {
    kind: "crypto:insolvency",
    predicate: "insolvency",
    re: /\b(insolvent|insolvency|withdrawal halt|halted withdrawals)\b/i,
  },
  {
    kind: "crypto:stablecoin_peg_change",
    predicate: "peg_change",
    re: /\bdepeg(?:ged|ging)?\b|\blost (its )?peg\b/i,
    quantitative: true,
  },
  {
    kind: "crypto:token_unlock",
    predicate: "token_unlock",
    re: /\b(token unlock|unlock event|cliff unlock)\b/i,
    quantitative: true,
  },
  {
    kind: "crypto:listing_or_delisting",
    predicate: "listing_or_delisting",
    re: /\b(etf inflows?|inflows accelerate|listed products|listed on|delisted from)\b/i,
  },
  {
    kind: "crypto:governance_proposal",
    predicate: "governance_proposal",
    re: /\b(governance proposal|snapshot vote)\b/i,
    quantitative: true,
  },
  {
    kind: "crypto:regulatory_action",
    predicate: "regulatory_action",
    re: /\b(sec|cftc|doj|enforcement action)\b/i,
  },
  {
    kind: "crypto:sanction",
    predicate: "sanction",
    re: /\b(ofac|sanctioned|sanctions)\b/i,
  },
  {
    kind: "crypto:macro_policy_decision",
    predicate: "macro_policy_decision",
    re: /\b(fomc|federal reserve|interest-rate decision)\b/i,
  },
  {
    kind: "crypto:scheduled_release",
    predicate: "scheduled_release",
    re: /\b(cpi print|nonfarm payrolls|eia inventory)\b/i,
  },
  {
    kind: "crypto:service_outage",
    predicate: "service_outage",
    re: /\b(outage|went down|service disruption)\b/i,
  },
  {
    kind: "crypto:large_transfer",
    predicate: "large_transfer",
    re: /\b(large transfer|whale (?:moved|transfer))\b/i,
    quantitative: true,
  },
  {
    kind: "crypto:market_stress",
    predicate: "market_stress",
    re: /\b(funding rate|open interest|liquidations?)\b/i,
    quantitative: true,
  },
];

function excerptAround(content: string, match: RegExpExecArray | null): string {
  if (!match) {
    return content.slice(0, 180).trim();
  }
  const start = Math.max(0, match.index - 40);
  return content.slice(start, start + 180).trim();
}

function quantityFromText(content: string): { value: number; unit: string } | undefined {
  const percent = /(\d+(?:\.\d+)?)\s*(?:%|percent)\b/i.exec(content);
  if (percent?.[1]) {
    return { value: Number(percent[1]), unit: "percent" };
  }
  const usd = /(?:usd|usdt|\$)\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/i.exec(content);
  if (usd?.[1]) {
    return { value: Number(usd[1].replaceAll(",", "")), unit: "usd" };
  }
  const votes = /(\d+(?:\.\d+)?)\s*votes\b/i.exec(content);
  if (votes?.[1]) {
    return { value: Number(votes[1]), unit: "votes" };
  }
  return undefined;
}

function toCryptoClaimKind(kind: string): (typeof CRYPTO_CLAIM_KINDS)[number] | undefined {
  if ((CRYPTO_CLAIM_KINDS as readonly string[]).includes(kind)) {
    if (kind === "crypto:market_move") {
      return "crypto:listing_or_delisting";
    }
    return kind as (typeof CRYPTO_CLAIM_KINDS)[number];
  }
  if (isCatalystKind(kind)) {
    return CRYPTO_CATALYST_TO_CLAIM[kind];
  }
  return undefined;
}

function completeEnough(item: NormalizedEvidence): boolean {
  return (
    item.contentCompleteness === "full_document" || item.contentCompleteness === "native_complete"
  );
}

export function mergeShippedCryptoObjectives(current: string[]): string[] {
  const set = new Set(current);
  if (DEFAULT_CRYPTO_OBJECTIVES.every((id) => set.has(id))) {
    return current;
  }
  const uncustomized =
    current.length === 0 ||
    (current.length === LEGACY_CRYPTO_OBJECTIVES.length &&
      LEGACY_CRYPTO_OBJECTIVES.every((id) => set.has(id)));
  if (uncustomized) {
    return [...DEFAULT_CRYPTO_OBJECTIVES];
  }
  return current;
}

export const cryptoDomainModule: DomainModule = {
  id: "crypto",
  assetClasses: [...CRYPTO_ASSET_CLASSES],
  claimKinds() {
    return [...CRYPTO_CLAIM_KINDS];
  },
  mapClaimKindToCatalyst(kind: string) {
    if ((CRYPTO_CLAIM_KINDS as readonly string[]).includes(kind)) {
      return CRYPTO_CLAIM_TO_CATALYST[kind as (typeof CRYPTO_CLAIM_KINDS)[number]];
    }
    if (isCatalystKind(kind) && CRYPTO_CATALYST_TO_CLAIM[kind]) {
      return kind;
    }
    if (kind === "observed_anomaly") {
      return "observed_anomaly";
    }
    return undefined;
  },
  sourceQuery(input) {
    const queries = this.sourceQueries(input);
    return queries[0] ?? "";
  },
  sourceQueries(input) {
    const watchlist = input.watchlist.map((item) => ({
      canonicalId: item.canonicalId,
      symbol: item.symbol,
      name: item.displayName,
    }));
    if (input.adapterId === "searxng") {
      const perAsset = takeBounded(input.watchlist, MAX_SEARXNG_ASSET_QUERIES).map((item) =>
        buildAssetNewsQuery({
          name: item.displayName,
          symbol: item.symbol,
          canonicalId: item.canonicalId,
          keywords: CRYPTO_SEARXNG_CATALYST_KEYWORDS,
        }),
      );
      const general = buildDomainGeneralNewsQuery(
        CRYPTO_SEARXNG_GENERAL_FALLBACK,
        CRYPTO_SEARXNG_CATALYST_KEYWORDS,
      );
      return [...perAsset.filter(Boolean), general];
    }
    if (input.adapterId === "x" || input.adapterId === "discord") {
      return [watchlistSearchQuery(watchlist, "crypto")];
    }
    if (
      input.adapterId === "feeds" ||
      input.adapterId === "defillama" ||
      input.adapterId === "hyperliquid" ||
      input.adapterId === "binance-futures" ||
      input.adapterId === "polymarket" ||
      input.adapterId === "kalshi" ||
      input.adapterId === "snapshot" ||
      input.adapterId === "alchemy" ||
      input.adapterId === "helius" ||
      input.adapterId === "edgar"
    ) {
      return [""];
    }
    return [watchlist.map((item) => item.canonicalId).join(" ")];
  },
  canonicalizeAsset(input, registry: readonly RegistryAsset[] = []) {
    return canonicalizeFromRegistry(input, registry);
  },
  extractAssets(evidence: NormalizedEvidence[], registry: readonly RegistryAsset[] = []) {
    return resolveEvidenceAssets(evidence, registry, CRYPTO_RESOLVER_RULES);
  },
  extractObservations(evidence: NormalizedEvidence[], registry: readonly RegistryAsset[] = []) {
    const observations: MarketObservation[] = [];
    for (const item of evidence) {
      const hay = `${item.title ?? ""} ${item.bodyText ?? ""}`;
      const sourceId = item.canonicalUrl ?? item.externalId ?? item.contentHash;
      const assetCanonicalId = this.extractAssets([item], registry)[0]?.canonicalId;
      const observedAt = item.publishedAt ?? item.fetchedAt;
      const negated =
        /\b(no|not|without|isn't|is not)\b.{0,24}\b(depeg|hack|exploit|insolvent)/i.test(hay);
      const funding = /funding rate\s+(-?\d+(?:\.\d+)?)\s*%/i.exec(hay);
      if (funding?.[1]) {
        observations.push({
          kind: "funding_rate",
          value: Number(funding[1]),
          unit: "percent",
          observedAt,
          sourceId,
          assetCanonicalId,
        });
      }
      const price = /(?:usd|usdt|\$)\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/i.exec(hay);
      if (price?.[1] && assetCanonicalId) {
        observations.push({
          kind: "quoted_price",
          value: Number(price[1].replaceAll(",", "")),
          unit: "usd",
          observedAt,
          sourceId,
          assetCanonicalId,
        });
      }
      if (!negated && /\bdepeg(?:ged|ging)?\b/i.test(hay)) {
        observations.push({
          kind: "stablecoin_depeg_mentioned",
          value: true,
          observedAt,
          sourceId,
          assetCanonicalId,
        });
      }
      if (/\bopen interest\b/i.test(hay)) {
        observations.push({
          kind: "open_interest_mentioned",
          value: true,
          observedAt,
          sourceId,
          assetCanonicalId,
        });
      }
      if (/\bperpetual(?:s)?\b|\bperps?\b/i.test(hay)) {
        observations.push({
          kind: "derivatives_mentioned",
          value: true,
          observedAt,
          sourceId,
          assetCanonicalId,
        });
      }
    }
    return takeBounded(observations, 20);
  },
  extractClaims(evidence: NormalizedEvidence[], registry: readonly RegistryAsset[] = []) {
    const out: ReturnType<DomainModule["extractClaims"]> = [];
    for (const item of evidence) {
      if (!completeEnough(item)) {
        continue;
      }
      const pageClass = classifyPageHeuristic({
        url: item.canonicalUrl ?? item.url,
        title: item.title,
        bodyText: item.bodyText,
      });
      if (pageClass === "market_profile" || pageClass === "documentation") {
        continue;
      }
      const content = `${item.title ?? ""}\n${item.bodyText ?? ""}`;
      if (content.trim().length < 40) {
        continue;
      }
      const assets = this.extractAssets([item], registry);
      const subjectCanonicalId = assets[0]?.canonicalId;
      const timeBucket = (item.publishedAt ?? item.fetchedAt).toISOString().slice(0, 10);
      const negated =
        /\b(no|not|without|isn't|is not)\b.{0,24}\b(depeg|hack|exploit|insolvent)\b/i.test(content);
      for (const pattern of CLAIM_PATTERNS) {
        const match = pattern.re.exec(content);
        if (!match) {
          continue;
        }
        if (weakClaimObject(match[0])) {
          continue;
        }
        const polarity = negated ? "negated" : "asserted";
        const excerpt = excerptAround(content, match);
        const objectText = match[0];
        const quantity = pattern.quantitative ? quantityFromText(content) : undefined;
        const fingerprint = fingerprintClaim({
          marketDomainId: "crypto",
          kind: pattern.kind,
          subjectCanonicalId,
          polarity,
          objectText,
          value: quantity?.value,
          timeBucket,
        });
        const claim = {
          marketDomainId: "crypto" as const,
          kind: pattern.kind,
          subjectCanonicalId,
          predicate: pattern.predicate,
          objectText,
          value: quantity?.value,
          unit: quantity?.unit,
          polarity: polarity as "asserted" | "negated",
          modality: "asserted" as const,
          fingerprint,
          title: "",
          excerpt,
        };
        out.push({ ...claim, title: claimTitle(claim) });
      }
    }
    return takeBounded(out, 32);
  },
  normalizeClaim(candidate, evidence, registry: readonly RegistryAsset[] = []) {
    const domainKind = toCryptoClaimKind(candidate.kind);
    if (!domainKind || domainKind === "crypto:general_report") {
      return undefined;
    }
    if (
      domainKind === "crypto:observed_spot_price_anomaly" ||
      domainKind === "crypto:observed_quoted_volume_anomaly" ||
      domainKind === "crypto:observed_tvl_anomaly"
    ) {
      return undefined;
    }
    const catalyst = CRYPTO_CLAIM_TO_CATALYST[domainKind];
    if (!catalyst || catalyst === "observed_anomaly") {
      return undefined;
    }
    if (weakClaimObject(candidate.objectText ?? candidate.excerpt)) {
      return undefined;
    }
    const assets = this.extractAssets([evidence], registry);
    const subjectCanonicalId = candidate.subjectCanonicalId ?? assets[0]?.canonicalId;
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
      marketDomainId: "crypto",
      kind: domainKind,
      subjectCanonicalId,
      polarity: candidate.polarity,
      objectText: candidate.objectText ?? candidate.predicate,
      value: candidate.value,
      timeBucket,
    });
    const claim = {
      marketDomainId: "crypto" as const,
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
    const notes = [
      `Independent evidence items: ${evidence.length}`,
      `Resolved crypto assets: ${assets.map((item) => item.canonicalId).join(", ") || "none"}`,
      `Watchlist: ${watchlist.map((item) => item.canonicalId).join(", ") || "none"}`,
      `Sourced observations: ${observations.map((item) => item.kind).join(", ") || "none"}`,
    ];
    for (const item of observations) {
      if (item.kind === "tvl_usd" && item.assetCanonicalId) {
        notes.push(`Protocol TVL ${item.assetCanonicalId}: ${item.value} ${item.unit ?? "usd"}`);
      }
      if (item.kind === "tvl_change_1d" && item.assetCanonicalId) {
        notes.push(`Protocol TVL 24h change ${item.assetCanonicalId}: ${item.value}%`);
      }
      if (item.kind === "funding_rate_apr" && item.assetCanonicalId) {
        notes.push(
          `Funding APR ${item.assetCanonicalId} (${item.sourceId}): ${item.value}% at ${item.observedAt.toISOString()}`,
        );
      }
      if (item.kind === "open_interest_usd" && item.assetCanonicalId) {
        notes.push(
          `Open interest usd ${item.assetCanonicalId} (${item.sourceId}): ${item.value} at ${item.observedAt.toISOString()}`,
        );
      }
      if (item.kind === "volume_24h_usd" && item.assetCanonicalId) {
        notes.push(
          `Perp 24h volume ${item.assetCanonicalId} (${item.sourceId}): ${item.value} usd`,
        );
      }
      if (item.kind === "odds_yes" && item.assetCanonicalId) {
        notes.push(
          `Odds yes ${item.assetCanonicalId} (${item.sourceId}): ${item.value} at ${item.observedAt.toISOString()}`,
        );
      }
    }
    return {
      domainId: "crypto",
      observations,
      notes,
    };
  },
  assessImpact(input) {
    if (input.retracted) {
      return {
        level: "informational",
        reason: "retracted",
        reasonCodes: ["crypto:retracted"],
      };
    }
    const kinds = new Set(input.claims.map((item) => item.kind));
    const catalysts = input.claims
      .map((item) => this.mapClaimKindToCatalyst(item.kind))
      .filter((item): item is CatalystKind => Boolean(item));
    const principal = selectPrincipalCatalyst(catalysts);
    const oddsJump = input.claims.some((item) => item.predicate === "odds_jump");
    if (oddsJump) {
      const agreed = input.claims.some((item) =>
        (item.objectText ?? item.title).includes("agreed"),
      );
      if (agreed && (input.watchlistOverlap || input.portfolioOverlap)) {
        return {
          level: "moderate",
          reason: "odds_jump_agreed",
          reasonCodes: ["crypto:odds_jump"],
        };
      }
      return {
        level: "low",
        reason: "odds_jump",
        reasonCodes: ["crypto:odds_jump"],
      };
    }
    if (kinds.has("crypto:security_incident") || kinds.has("crypto:insolvency")) {
      return {
        level: "critical",
        reason: "active_compromise_or_insolvency",
        reasonCodes: ["crypto:security_incident", "crypto:insolvency"],
      };
    }
    if (
      (kinds.has("crypto:stablecoin_peg_change") || principal === "peg_deviation") &&
      !input.contradicted
    ) {
      return {
        level: "critical",
        reason: "peg_failure",
        reasonCodes: ["crypto:peg_failure"],
      };
    }
    if (kinds.has("crypto:regulatory_action") || principal === "regulatory_or_legal_action") {
      return {
        level: input.watchlistOverlap || input.portfolioOverlap ? "high" : "moderate",
        reason: "regulatory_action",
        reasonCodes: ["crypto:regulatory_action"],
      };
    }
    if (kinds.has("crypto:governance_proposal") || principal === "governance_proposal") {
      const hay = input.claims.map((item) => `${item.title} ${item.objectText ?? ""}`).join(" ");
      const material = /\b(treasury|emission|fee-switch|fee switch|upgrade)\b/i.test(hay);
      return {
        level: material ? "high" : "moderate",
        reason: material ? "governance_material" : "governance_proposal",
        reasonCodes: ["crypto:governance_proposal"],
      };
    }
    if (kinds.has("crypto:large_transfer") || principal === "large_transfer") {
      const hay = input.claims.map((item) => `${item.title} ${item.objectText ?? ""}`).join(" ");
      const outflow = /\b(bridge_outflow|treasury_outflow)\b/.test(hay);
      const inflow = /\bexchange_inflow\b/.test(hay);
      const exploit = input.claims.some(
        (item) => typeof item.value === "number" && item.value >= DEFAULT_EXPLOIT_TRANSFER_USD,
      );
      if (outflow || exploit) {
        return {
          level: "high",
          reason: outflow ? "bridge_or_treasury_outflow" : "exploit_transfer",
          reasonCodes: ["crypto:large_transfer"],
        };
      }
      if (inflow) {
        return {
          level: "low",
          reason: "exchange_inflow",
          reasonCodes: ["crypto:large_transfer"],
        };
      }
      return {
        level: "moderate",
        reason: "large_transfer",
        reasonCodes: ["crypto:large_transfer"],
      };
    }
    if (
      kinds.has("crypto:service_outage") ||
      kinds.has("crypto:material_corporate_event") ||
      principal === "material_corporate_event"
    ) {
      return {
        level: "high",
        reason: "service_outage",
        reasonCodes: ["crypto:service_outage"],
      };
    }
    if (input.stale) {
      return {
        level: "informational",
        reason: "stale_report",
        reasonCodes: ["crypto:stale"],
      };
    }
    if (
      (kinds.has("crypto:market_move") ||
        kinds.has("crypto:listing_or_delisting") ||
        principal === "listing_or_delisting") &&
      (input.watchlistOverlap || input.portfolioOverlap)
    ) {
      return {
        level: "moderate",
        reason: "watchlist_market_move",
        reasonCodes: ["crypto:listing_or_delisting"],
      };
    }
    if (
      (kinds.has("crypto:observed_spot_price_anomaly") ||
        kinds.has("crypto:observed_quoted_volume_anomaly") ||
        kinds.has("crypto:observed_tvl_anomaly") ||
        principal === "observed_anomaly") &&
      (input.watchlistOverlap || input.portfolioOverlap)
    ) {
      return {
        level: "moderate",
        reason: "observed_anomaly",
        reasonCodes: ["crypto:observed_anomaly"],
      };
    }
    if (kinds.has("crypto:market_stress") || principal === "market_stress") {
      return {
        level: "informational",
        reason: "perp_stress_observation",
        reasonCodes: ["crypto:market_stress"],
      };
    }
    if (principal) {
      const prior = CATALYST_SEVERITY_PRIOR[principal];
      if (prior === "critical" || prior === "high") {
        return {
          level: prior,
          reason: principal,
          reasonCodes: [`crypto:${principal}`],
        };
      }
      if (
        prior === "moderate" &&
        (input.watchlistOverlap || input.portfolioOverlap || input.hasTrustedFirsthand)
      ) {
        return {
          level: "moderate",
          reason: principal,
          reasonCodes: [`crypto:${principal}`],
        };
      }
    }
    if (input.hasTrustedFirsthand && kinds.size > 0 && !kinds.has("crypto:general_report")) {
      return {
        level: "high",
        reason: "trusted_firsthand_claim",
        reasonCodes: ["crypto:firsthand"],
      };
    }
    return {
      level: "informational",
      reason: "no_high_impact_claim",
      reasonCodes: ["crypto:informational"],
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
      name: DEFAULT_AGENT_NAME,
      description: DEFAULT_AGENT_DESCRIPTION,
      objectives: [...DEFAULT_CRYPTO_OBJECTIVES],
      assetClasses: ["cryptocurrency", "meme_coin", "stablecoin"],
    };
  },
};
