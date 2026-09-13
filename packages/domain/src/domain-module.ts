import type { ClaimCandidate, NormalizedClaim } from "./claims.js";
import type { NormalizedEvidence } from "./evidence.js";
import type { AssetClass, MarketDomainId } from "./market-domains.js";
import type { ImpactAssessment } from "./reliability.js";

export type ExtractedAsset = {
  assetClass: AssetClass;
  canonicalId: string;
  symbol?: string;
  displayName?: string;
};

export type MarketObservation = {
  kind: string;
  assetCanonicalId?: string;
  value: number | string | boolean | null;
  unit?: string;
  observedAt: Date;
  sourceId: string;
};

export type DomainContext = {
  domainId: MarketDomainId;
  observations: MarketObservation[];
  notes: string[];
};

export type ImpactInput = {
  claims: NormalizedClaim[];
  assets: ExtractedAsset[];
  observations: MarketObservation[];
  watchlistOverlap: boolean;
  portfolioOverlap: boolean;
  hasTrustedFirsthand: boolean;
  stale: boolean;
  contradicted: boolean;
  retracted: boolean;
};

export type DomainModule = {
  id: MarketDomainId;
  assetClasses: AssetClass[];
  claimKinds(): string[];
  sourceQuery(input: { adapterId: string; watchlist: ExtractedAsset[] }): string;
  canonicalizeAsset(input: {
    symbol?: string;
    name?: string;
    canonicalId?: string;
    assetClass?: AssetClass;
  }): ExtractedAsset | undefined;
  extractAssets(evidence: NormalizedEvidence[]): ExtractedAsset[];
  extractObservations(evidence: NormalizedEvidence[]): MarketObservation[];
  extractClaims(evidence: NormalizedEvidence[]): Array<NormalizedClaim & { excerpt?: string }>;
  normalizeClaim(
    candidate: ClaimCandidate,
    evidence: NormalizedEvidence,
  ): NormalizedClaim | undefined;
  claimsCompatible(left: NormalizedClaim, right: NormalizedClaim): boolean;
  assembleContext(input: {
    evidence: NormalizedEvidence[];
    assets: ExtractedAsset[];
    observations: MarketObservation[];
    watchlist?: ExtractedAsset[];
  }): DomainContext;
  assessImpact(input: ImpactInput): ImpactAssessment;
  principalClaimTitle(claim: NormalizedClaim): string;
  defaultAgentProfile(): {
    name: string;
    description: string;
    objectives: string[];
    assetClasses: AssetClass[];
  };
};

export class DomainModuleRegistry {
  private readonly modules = new Map<MarketDomainId, DomainModule>();

  register(module: DomainModule): void {
    this.modules.set(module.id, module);
  }

  get(id: MarketDomainId): DomainModule | undefined {
    return this.modules.get(id);
  }

  require(id: MarketDomainId): DomainModule {
    const found = this.get(id);
    if (!found) {
      throw new Error(`No domain module registered for '${id}'.`);
    }
    return found;
  }
}
