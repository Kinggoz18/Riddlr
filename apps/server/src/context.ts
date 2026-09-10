import { type AppConfig, parseEnv } from "@riddlr/config";
import { decodeMasterKey } from "@riddlr/crypto";
import { createDb, type Database, migrate } from "@riddlr/db";
import { DomainModuleRegistry } from "@riddlr/domain";
import { cryptoDomainModule } from "@riddlr/domain-crypto";
import { createLogger, createMetrics } from "@riddlr/observability";
import { QUEUE_NAMES } from "@riddlr/queue";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

export type AppContext = {
  config: AppConfig;
  db: Database;
  redis: Redis;
  scanQueue: Queue;
  analyzeQueue: Queue;
  notifyQueue: Queue;
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
  const analyzeQueue = new Queue(QUEUE_NAMES.analyzeEvent, queueOptions);
  const notifyQueue = new Queue(QUEUE_NAMES.notifyDeliver, queueOptions);
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
    analyzeQueue,
    notifyQueue,
    logger,
    metrics: createMetrics(),
    masterKey,
    masterKeys,
    domains,
  };
}
