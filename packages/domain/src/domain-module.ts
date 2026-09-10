import type { NormalizedEvidence } from "./evidence.js";
import type { AssetClass, MarketDomainId } from "./market-domains.js";

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

export type DomainModule = {
  id: MarketDomainId;
  assetClasses: AssetClass[];
  canonicalizeAsset(input: {
    symbol?: string;
    name?: string;
    canonicalId?: string;
    assetClass?: AssetClass;
  }): ExtractedAsset | undefined;
  extractAssets(evidence: NormalizedEvidence[]): ExtractedAsset[];
  extractObservations(evidence: NormalizedEvidence[]): MarketObservation[];
  assembleContext(input: {
    evidence: NormalizedEvidence[];
    assets: ExtractedAsset[];
    observations: MarketObservation[];
    watchlist?: ExtractedAsset[];
  }): DomainContext;
  defaultAgentProfile(): {
    name: string;
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
