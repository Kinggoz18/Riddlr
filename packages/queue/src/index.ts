export const QUEUE_NAMES = {
  scanRun: "riddlr.scan.run",
  ingestSource: "riddlr.ingest.source",
  enrichEvidence: "riddlr.enrich.evidence",
  understandEvidence: "riddlr.understand.evidence",
  clusterEvents: "riddlr.cluster.events",
  analyzeEvent: "riddlr.analyze.event",
  notifyDeliver: "riddlr.notify.deliver",
  observePoll: "riddlr.observe.poll",
  healthPing: "riddlr.health.ping",
} as const;

export type ScanRunJob = {
  scanId: string;
  agentId: string;
  marketDomainId: string;
  idempotencyKey: string;
};

export type IngestSourceJob = {
  scanId: string;
  sourceId: string;
  marketDomainId: string;
  idempotencyKey: string;
};

export type EnrichEvidenceJob = {
  scanId: string;
  evidenceId: string;
  marketDomainId: string;
  idempotencyKey: string;
};

export type UnderstandEvidenceJob = {
  scanId: string;
  evidenceId: string;
  marketDomainId: string;
  idempotencyKey: string;
};

export type ClusterEventsJob = {
  scanId: string;
  marketDomainId: string;
  idempotencyKey: string;
};

export type AnalyzeEventJob = {
  eventId: string;
  scanId: string;
  marketDomainId: string;
  idempotencyKey: string;
};

export type NotifyJob = {
  signalId: string;
  channelConfigId?: string;
  marketDomainId: string;
  idempotencyKey: string;
};

export type ObservePollJob = {
  providerId: string;
  idempotencyKey: string;
};
