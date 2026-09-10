export const QUEUE_NAMES = {
  scanRun: "riddlr.scan.run",
  ingestSource: "riddlr.ingest.source",
  clusterEvents: "riddlr.cluster.events",
  analyzeEvent: "riddlr.analyze.event",
  notifyDeliver: "riddlr.notify.deliver",
  healthPing: "riddlr.health.ping",
} as const;

export type ScanRunJob = {
  scanId: string;
  agentId: string;
  idempotencyKey: string;
};

export type IngestSourceJob = {
  scanId: string;
  sourceId: string;
  idempotencyKey: string;
};

export type AnalyzeEventJob = {
  eventId: string;
  scanId: string;
  idempotencyKey: string;
};

export type NotifyJob = {
  signalId: string;
  channelConfigId: string;
  idempotencyKey: string;
};
