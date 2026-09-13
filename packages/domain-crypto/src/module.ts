import {
  claimTitle,
  classifyPageHeuristic,
  DEFAULT_AGENT_DESCRIPTION,
  DEFAULT_AGENT_NAME,
  type DomainModule,
  type ExtractedAsset,
  fingerprintClaim,
  claimsCompatible as genericClaimsCompatible,
  type MarketObservation,
  type NormalizedEvidence,
  takeBounded,
  watchlistSearchQuery,
  weakClaimObject,
} from "@riddlr/domain";

const KNOWN: Record<string, ExtractedAsset> = {
  btc: {
    assetClass: "cryptocurrency",
    canonicalId: "coingecko:bitcoin",
    symbol: "BTC",
    displayName: "Bitcoin",
  },
  bitcoin: {
    assetClass: "cryptocurrency",
    canonicalId: "coingecko:bitcoin",
    symbol: "BTC",
    displayName: "Bitcoin",
  },
  eth: {
    assetClass: "cryptocurrency",
    canonicalId: "coingecko:ethereum",
    symbol: "ETH",
    displayName: "Ethereum",
  },
  ethereum: {
    assetClass: "cryptocurrency",
    canonicalId: "coingecko:ethereum",
    symbol: "ETH",
    displayName: "Ethereum",
  },
  sol: {
    assetClass: "cryptocurrency",
    canonicalId: "coingecko:solana",
    symbol: "SOL",
    displayName: "Solana",
  },
  usdt: {
    assetClass: "stablecoin",
    canonicalId: "coingecko:tether",
    symbol: "USDT",
    displayName: "Tether",
  },
  usdc: {
    assetClass: "stablecoin",
    canonicalId: "coingecko:usd-coin",
    symbol: "USDC",
    displayName: "USD Coin",
  },
};

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

const TOKEN_RE = /\b(bitcoin|ethereum|solana|btc|eth|sol|usdt|usdc|meme coin|stablecoin)\b/gi;
const CRYPTO_ASSET_CLASSES = ["cryptocurrency", "meme_coin", "stablecoin"] as const;

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
  "crypto:regulatory_action",
  "crypto:service_outage",
  "crypto:market_move",
  "crypto:general_report",
] as const;

export const CRYPTO_IMPACT_POLICY_VERSION = "crypto-impact-1";

const CLAIM_PATTERNS: Array<{
  kind: (typeof CRYPTO_CLAIM_KINDS)[number];
  predicate: string;
  re: RegExp;
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
  },
  {
    kind: "crypto:regulatory_action",
    predicate: "regulatory_action",
    re: /\b(sec|cftc|doj|ofac|enforcement action)\b/i,
  },
  {
    kind: "crypto:service_outage",
    predicate: "service_outage",
    re: /\b(outage|went down|service disruption)\b/i,
  },
  {
    kind: "crypto:market_move",
    predicate: "market_move",
    re: /\b(etf inflows?|inflows accelerate|listed products)\b/i,
  },
];

function excerptAround(content: string, match: RegExpExecArray | null): string {
  if (!match) {
    return content.slice(0, 180).trim();
  }
  const start = Math.max(0, match.index - 40);
  return content.slice(start, start + 180).trim();
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
  sourceQuery(input) {
    const watchlist = input.watchlist.map((item) => ({
      canonicalId: item.canonicalId,
      symbol: item.symbol,
      name: item.displayName,
    }));
    if (input.adapterId === "searxng") {
      return watchlistSearchQuery(watchlist, "cryptocurrency bitcoin ethereum stablecoin news");
    }
    if (input.adapterId === "x" || input.adapterId === "discord") {
      return watchlistSearchQuery(watchlist, "crypto");
    }
    return watchlist.map((item) => item.canonicalId).join(" ");
  },
  canonicalizeAsset(input) {
    if (input.canonicalId) {
      const known = Object.values(KNOWN).find((item) => item.canonicalId === input.canonicalId);
      if (known) {
        return known;
      }
      if (!input.name && !input.symbol) {
        return undefined;
      }
      const assetClass =
        CRYPTO_ASSET_CLASSES.find((item) => item === input.assetClass) ?? "cryptocurrency";
      return {
        assetClass,
        canonicalId: input.canonicalId,
        symbol: input.symbol,
        displayName: input.name,
      };
    }
    const key = (input.symbol ?? input.name ?? "").toLowerCase();
    return KNOWN[key];
  },
  extractAssets(evidence: NormalizedEvidence[]) {
    const found = new Map<string, ExtractedAsset>();
    for (const item of evidence) {
      const haystack = `${item.title ?? ""} ${item.bodyText ?? ""}`;
      for (const match of haystack.matchAll(TOKEN_RE)) {
        const key = match[0].toLowerCase();
        const asset =
          KNOWN[key] ??
          (key.includes("meme")
            ? {
                assetClass: "meme_coin" as const,
                canonicalId: "crypto:meme-narrative",
                displayName: "Meme coins",
              }
            : undefined);
        if (asset) {
          found.set(asset.canonicalId, asset);
        }
      }
    }
    return [...found.values()];
  },
  extractObservations(evidence: NormalizedEvidence[]) {
    const observations: MarketObservation[] = [];
    for (const item of evidence) {
      const hay = `${item.title ?? ""} ${item.bodyText ?? ""}`;
      const sourceId = item.canonicalUrl ?? item.externalId ?? item.contentHash;
      const assetCanonicalId = this.extractAssets([item])[0]?.canonicalId;
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
  extractClaims(evidence: NormalizedEvidence[]) {
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
      const assets = this.extractAssets([item]);
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
        const fingerprint = fingerprintClaim({
          marketDomainId: "crypto",
          kind: pattern.kind,
          subjectCanonicalId,
          polarity,
          objectText,
          timeBucket,
        });
        const claim = {
          marketDomainId: "crypto" as const,
          kind: pattern.kind,
          subjectCanonicalId,
          predicate: pattern.predicate,
          objectText,
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
  normalizeClaim(candidate, evidence) {
    if (!(CRYPTO_CLAIM_KINDS as readonly string[]).includes(candidate.kind)) {
      return undefined;
    }
    if (candidate.kind === "crypto:general_report") {
      return undefined;
    }
    if (weakClaimObject(candidate.objectText ?? candidate.excerpt)) {
      return undefined;
    }
    const assets = this.extractAssets([evidence]);
    const subjectCanonicalId = candidate.subjectCanonicalId ?? assets[0]?.canonicalId;
    const timeBucket = (evidence.publishedAt ?? evidence.fetchedAt).toISOString().slice(0, 10);
    const fingerprint = fingerprintClaim({
      marketDomainId: "crypto",
      kind: candidate.kind,
      subjectCanonicalId,
      polarity: candidate.polarity,
      objectText: candidate.objectText ?? candidate.predicate,
      timeBucket,
    });
    const claim = {
      marketDomainId: "crypto" as const,
      kind: candidate.kind,
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
    if (kinds.has("crypto:security_incident") || kinds.has("crypto:insolvency")) {
      return {
        level: "critical",
        reason: "active_compromise_or_insolvency",
        reasonCodes: ["crypto:security_incident", "crypto:insolvency"],
      };
    }
    if (kinds.has("crypto:stablecoin_peg_change") && !input.contradicted) {
      return {
        level: "critical",
        reason: "peg_failure",
        reasonCodes: ["crypto:peg_failure"],
      };
    }
    if (kinds.has("crypto:regulatory_action")) {
      return {
        level: input.watchlistOverlap || input.portfolioOverlap ? "high" : "moderate",
        reason: "regulatory_action",
        reasonCodes: ["crypto:regulatory_action"],
      };
    }
    if (kinds.has("crypto:service_outage")) {
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
    if (kinds.has("crypto:market_move") && (input.watchlistOverlap || input.portfolioOverlap)) {
      return {
        level: "moderate",
        reason: "watchlist_market_move",
        reasonCodes: ["crypto:market_move"],
      };
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
  defaultAgentProfile() {
    return {
      name: DEFAULT_AGENT_NAME,
      description: DEFAULT_AGENT_DESCRIPTION,
      objectives: [...DEFAULT_CRYPTO_OBJECTIVES],
      assetClasses: ["cryptocurrency", "meme_coin", "stablecoin"],
    };
  },
};
