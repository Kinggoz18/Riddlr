import pino from "pino";
import { Counter, collectDefaultMetrics, Histogram, Registry } from "prom-client";

const REDACT_PATHS = [
  "*.password",
  "*.secret",
  "*.apiKey",
  "*.resendApiKey",
  "*.token",
  "*.cookie",
  "*.ciphertext",
  "*.recoveryCode",
  "*.totp",
  "authorization",
  "RIDDLR_ENCRYPTION_MASTER_KEY",
  "RIDDLR_RESEND_API_KEY",
];

export function createLogger(options: { level: string; pretty: boolean }) {
  return pino({
    level: options.level,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    transport: options.pretty ? { target: "pino-pretty", options: { colorize: true } } : undefined,
  });
}

export function createMetrics() {
  const register = new Registry();
  collectDefaultMetrics({ register });
  const httpDuration = new Histogram({
    name: "riddlr_http_request_duration_seconds",
    help: "HTTP request duration",
    labelNames: ["method", "route", "status"],
    registers: [register],
  });
  const authEvents = new Counter({
    name: "riddlr_auth_events_total",
    help: "Authentication events",
    labelNames: ["result"],
    registers: [register],
  });
  const scans = new Counter({
    name: "riddlr_scans_total",
    help: "Scan outcomes",
    labelNames: ["status"],
    registers: [register],
  });
  const evidenceOutcomes = new Counter({
    name: "riddlr_evidence_outcomes_total",
    help: "Evidence completeness outcomes",
    labelNames: ["completeness"],
    registers: [register],
  });
  const assessments = new Counter({
    name: "riddlr_event_assessments_total",
    help: "Event reliability assessments",
    labelNames: ["reliability"],
    registers: [register],
  });
  const aiCalls = new Counter({
    name: "riddlr_ai_calls_total",
    help: "LLM calls",
    labelNames: ["provider", "result"],
    registers: [register],
  });
  const scanIrrelevantRejects = new Counter({
    name: "riddlr_scan_irrelevant_rejects_total",
    help: "Search hits dropped by the deterministic relevance gate",
    labelNames: ["family"],
    registers: [register],
  });
  const enrichmentOutcomes = new Counter({
    name: "riddlr_enrichment_outcomes_total",
    help: "Document enrichment outcomes",
    labelNames: ["status"],
    registers: [register],
  });
  const claims = new Counter({
    name: "riddlr_claims_total",
    help: "Claim extraction outcomes",
    labelNames: ["result"],
    registers: [register],
  });
  const notifications = new Counter({
    name: "riddlr_notifications_total",
    help: "Notification decisions",
    labelNames: ["kind"],
    registers: [register],
  });
  const registrySeeds = new Counter({
    name: "riddlr_registry_seeds_total",
    help: "Asset registry seed outcomes",
    labelNames: ["result"],
    registers: [register],
  });
  const observePolls = new Counter({
    name: "riddlr_observe_polls_total",
    help: "Observation poll outcomes",
    labelNames: ["provider", "result"],
    registers: [register],
  });
  const detectorFindings = new Counter({
    name: "riddlr_detector_findings_total",
    help: "Observation detector outcomes",
    labelNames: ["detector", "result"],
    registers: [register],
  });
  const observeWsDrops = new Counter({
    name: "riddlr_observe_ws_drops_total",
    help: "WebSocket frames dropped by the bounded liquidation buffer",
    labelNames: ["provider", "reason"],
    registers: [register],
  });
  const lifecycleTransitions = new Counter({
    name: "riddlr_event_lifecycle_transitions_total",
    help: "Event lifecycle transitions",
    labelNames: ["to"],
    registers: [register],
  });
  const signalOutcomes = new Counter({
    name: "riddlr_signal_outcomes_total",
    help: "Recorded observation outcomes at fixed horizons",
    labelNames: ["horizon", "metric"],
    registers: [register],
  });
  return {
    register,
    httpDuration,
    authEvents,
    scans,
    aiCalls,
    evidenceOutcomes,
    scanIrrelevantRejects,
    assessments,
    enrichmentOutcomes,
    claims,
    notifications,
    registrySeeds,
    observePolls,
    detectorFindings,
    observeWsDrops,
    lifecycleTransitions,
    signalOutcomes,
  };
}

let peakRss = 0;

export function snapshotProcessMemory() {
  const usage = process.memoryUsage();
  peakRss = Math.max(peakRss, usage.rss);
  return {
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    peakRss,
  };
}

export function containsSecretLeak(line: string): boolean {
  return /sk-[A-Za-z0-9]|password":\s*"[^"[]|BEGIN PRIVATE KEY/.test(line);
}
