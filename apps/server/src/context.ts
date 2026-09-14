import { type AppConfig, parseEnv } from "@riddlr/config";
import { decodeMasterKey } from "@riddlr/crypto";
import { createDb, type Database, migrate } from "@riddlr/db";
import { DomainModuleRegistry } from "@riddlr/domain";
import { cryptoDomainModule } from "@riddlr/domain-crypto";
import { createLogger, createMetrics } from "@riddlr/observability";
import { QUEUE_NAMES } from "@riddlr/queue";
import type { ObservationProviderRegistry } from "@riddlr/source-adapters";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { createObservationProviders } from "./modules/observe.js";

export type AppContext = {
  config: AppConfig;
  db: Database;
  redis: Redis;
  scanQueue: Queue;
  ingestQueue?: Queue;
  enrichQueue?: Queue;
  understandQueue?: Queue;
  clusterQueue?: Queue;
  analyzeQueue?: Queue;
  notifyQueue?: Queue;
  observeQueue?: Queue;
  outcomesQueue?: Queue;
  observationProviders?: ObservationProviderRegistry;
  logger: ReturnType<typeof createLogger>;
  metrics: ReturnType<typeof createMetrics>;
  masterKey: Buffer;
  masterKeys: Buffer[];
  domains: DomainModuleRegistry;
};

export async function createContext(): Promise<AppContext> {
  const config = parseEnv();
  await migrate(config.RIDDLR_DATABASE_URL);
  const { db } = createDb(config.RIDDLR_DATABASE_URL);
  const redis = new Redis(config.RIDDLR_REDIS_URL, { maxRetriesPerRequest: null });
  const queueOptions = { connection: redis };
  const scanQueue = new Queue(QUEUE_NAMES.scanRun, { connection: redis });
  const ingestQueue = new Queue(QUEUE_NAMES.ingestSource, queueOptions);
  const enrichQueue = new Queue(QUEUE_NAMES.enrichEvidence, queueOptions);
  const understandQueue = new Queue(QUEUE_NAMES.understandEvidence, queueOptions);
  const clusterQueue = new Queue(QUEUE_NAMES.clusterEvents, queueOptions);
  const analyzeQueue = new Queue(QUEUE_NAMES.analyzeEvent, queueOptions);
  const notifyQueue = new Queue(QUEUE_NAMES.notifyDeliver, queueOptions);
  const observeQueue = new Queue(QUEUE_NAMES.observePoll, queueOptions);
  const outcomesQueue = new Queue(QUEUE_NAMES.recordOutcomes, queueOptions);
  const logger = createLogger({
    level: config.RIDDLR_LOG_LEVEL,
    pretty: config.RIDDLR_LOG_FORMAT === "pretty",
  });
  const domains = new DomainModuleRegistry();
  domains.register(cryptoDomainModule);
  const masterKey = decodeMasterKey(config.encryptionMasterKey);
  const masterKeys = [masterKey];
  if (config.previousMasterKey) {
    masterKeys.push(decodeMasterKey(config.previousMasterKey));
  }
  return {
    config,
    db,
    redis,
    scanQueue,
    ingestQueue,
    enrichQueue,
    understandQueue,
    clusterQueue,
    analyzeQueue,
    notifyQueue,
    observeQueue,
    outcomesQueue,
    observationProviders: createObservationProviders(),
    logger,
    metrics: createMetrics(),
    masterKey,
    masterKeys,
    domains,
  };
}
