import type { SeriesObservation } from "@riddlr/domain";
import type { SourceErrorClass } from "../types.js";

export type ObserveQuery = {
  subjectCanonicalIds: readonly string[];
  observedAt: Date;
};

export type ObserveResult = {
  observations: SeriesObservation[];
  partial: boolean;
  errors: Array<{ class: SourceErrorClass; message: string }>;
  requestUrl?: string;
  responseStatus?: number;
  stale?: boolean;
};

export type ObservationProvider = {
  id: string;
  metrics: readonly string[];
  defaultIntervalMs: number;
  observe(config: Record<string, unknown>, query: ObserveQuery): Promise<ObserveResult>;
};

export class ObservationProviderRegistry {
  private readonly providers = new Map<string, ObservationProvider>();

  register(provider: ObservationProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): ObservationProvider | undefined {
    return this.providers.get(id);
  }

  require(id: string): ObservationProvider {
    const found = this.get(id);
    if (!found) {
      throw new Error(`Unknown observation provider: ${id}`);
    }
    return found;
  }

  list(): ObservationProvider[] {
    return [...this.providers.values()];
  }
}

export function createScriptedObservationProvider(script: {
  id?: string;
  metrics?: readonly string[];
  defaultIntervalMs?: number;
  observe: (query: ObserveQuery) => Promise<ObserveResult> | ObserveResult;
}): ObservationProvider {
  return {
    id: script.id ?? "scripted",
    metrics: script.metrics ?? ["spot_price"],
    defaultIntervalMs: script.defaultIntervalMs ?? 60_000,
    async observe(_config, query) {
      return script.observe(query);
    },
  };
}
