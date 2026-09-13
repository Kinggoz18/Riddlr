import { agents, evidenceItems, evidenceOccurrences, scans } from "@riddlr/db";
import { assertSupportedMarketDomains, type MarketDomainId } from "@riddlr/domain";
import { snapshotProcessMemory } from "@riddlr/observability";
import { QUEUE_NAMES } from "@riddlr/queue";
import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { createContext } from "../context.js";
import { seedAssetRegistryIfDue } from "../modules/asset-registry.js";
import { enrichAndUnderstandScan } from "../modules/intelligence.js";
import { deliverSignalNotifications } from "../modules/notify.js";
import { enqueueObserveIfDue, pollObservationProvider } from "../modules/observe.js";
import { analyzeQueuedEvent, clusterScanEvents, runScan } from "../modules/pipeline.js";
import { enqueueAgentScan } from "../modules/scans.js";

const ctx = await createContext();
const workerOptions = {
  connection: ctx.redis,
  concurrency: ctx.config.RIDDLR_WORKER_CONCURRENCY,
  lockDuration: 120_000,
  stalledInterval: 30_000,
};

const worker = new Worker(
  QUEUE_NAMES.scanRun,
  async (job) => {
    const scanId = String((job.data as { scanId?: string }).scanId ?? "");
    try {
      await runScan(ctx, scanId);
    } catch (error) {
      ctx.logger.error({ err: error, scanId }, "scan worker failed");
      throw error;
    }
  },
  workerOptions,
);

const notifyWorker = new Worker(
  QUEUE_NAMES.notifyDeliver,
  async (job) => {
    const signalId = String((job.data as { signalId?: string }).signalId ?? "");
    await deliverSignalNotifications(ctx, signalId);
  },
  { ...workerOptions, concurrency: 2 },
);

const analyzeWorker = new Worker(
  QUEUE_NAMES.analyzeEvent,
  async (job) => {
    const eventId = String((job.data as { eventId?: string }).eventId ?? "");
    await analyzeQueuedEvent(ctx, eventId);
  },
  workerOptions,
);

async function enrichOrUnderstand(job: { data: { evidenceId?: string; marketDomainId?: string } }) {
  const evidenceId = String(job.data.evidenceId ?? "");
  const marketDomainId = String(job.data.marketDomainId ?? "") as MarketDomainId;
  assertSupportedMarketDomains([marketDomainId]);
  const module = ctx.domains.require(marketDomainId);
  const [row] = await ctx.db
    .select()
    .from(evidenceItems)
    .where(eq(evidenceItems.id, evidenceId))
    .limit(1);
  if (!row) {
    return;
  }
  await enrichAndUnderstandScan({ ctx, module, evidenceRows: [row] });
}

const enrichWorker = new Worker(
  QUEUE_NAMES.enrichEvidence,
  async (job) => {
    await enrichOrUnderstand(job);
  },
  { ...workerOptions, concurrency: ctx.config.RIDDLR_ENRICH_CONCURRENCY },
);

const understandWorker = new Worker(
  QUEUE_NAMES.understandEvidence,
  async (job) => {
    await enrichOrUnderstand(job);
  },
  { ...workerOptions, concurrency: ctx.config.RIDDLR_UNDERSTAND_CONCURRENCY },
);

const clusterWorker = new Worker(
  QUEUE_NAMES.clusterEvents,
  async (job) => {
    const scanId = String((job.data as { scanId?: string }).scanId ?? "");
    const marketDomainId = String(
      (job.data as { marketDomainId?: string }).marketDomainId ?? "",
    ) as MarketDomainId;
    assertSupportedMarketDomains([marketDomainId]);
    const [scan] = await ctx.db.select().from(scans).where(eq(scans.id, scanId)).limit(1);
    if (!scan) {
      return;
    }
    const occurrences = await ctx.db
      .select({ evidenceId: evidenceOccurrences.evidenceId })
      .from(evidenceOccurrences)
      .where(eq(evidenceOccurrences.scanId, scanId))
      .limit(ctx.config.RIDDLR_SCAN_EVIDENCE_LIMIT);
    await clusterScanEvents(
      ctx,
      scan,
      occurrences.map((item) => item.evidenceId),
    );
  },
  workerOptions,
);

const observeWorker = new Worker(
  QUEUE_NAMES.observePoll,
  async (job) => {
    const providerId = String((job.data as { providerId?: string }).providerId ?? "");
    if (!providerId) {
      return;
    }
    await pollObservationProvider(ctx, providerId);
  },
  { ...workerOptions, concurrency: ctx.config.RIDDLR_OBSERVE_CONCURRENCY },
);

void ctx.redis.set("riddlr:worker:heartbeat", new Date().toISOString(), "EX", 60);
const heartbeat = setInterval(() => {
  void ctx.redis.set("riddlr:worker:heartbeat", new Date().toISOString(), "EX", 60);
  const memory = snapshotProcessMemory();
  ctx.logger.debug(
    { rss: memory.rss, heapUsed: memory.heapUsed, peakRss: memory.peakRss },
    "worker memory",
  );
}, 15_000);

async function enqueueDueScans() {
  if (ctx.config.RIDDLR_SCHEDULER_ENABLED !== "true") {
    return;
  }
  const rows = await ctx.db
    .select()
    .from(agents)
    .where(eq(agents.enabled, true))
    .limit(ctx.config.RIDDLR_SCHEDULER_AGENT_LIMIT);
  for (const agent of rows) {
    try {
      await enqueueAgentScan(ctx, agent.id);
    } catch (error) {
      if ((error as Error & { code?: string }).code === "coming_soon") {
        continue;
      }
      ctx.logger.warn({ err: error, agentId: agent.id }, "scheduler enqueue failed");
    }
  }
}

const scheduler = setInterval(() => {
  void enqueueDueScans().catch((error) => {
    ctx.logger.warn({ err: error }, "scheduler tick failed");
  });
  void seedAssetRegistryIfDue(ctx).catch((error) => {
    ctx.logger.warn({ err: error }, "registry seed tick failed");
  });
  void enqueueObserveIfDue(ctx).catch((error) => {
    ctx.logger.warn({ err: error }, "observe enqueue tick failed");
  });
}, 60_000);

const shutdown = async () => {
  clearInterval(scheduler);
  clearInterval(heartbeat);
  await worker.close();
  await notifyWorker.close();
  await analyzeWorker.close();
  await enrichWorker.close();
  await understandWorker.close();
  await clusterWorker.close();
  await observeWorker.close();
  await ctx.scanQueue.close();
  await ctx.ingestQueue?.close();
  await ctx.enrichQueue?.close();
  await ctx.understandQueue?.close();
  await ctx.clusterQueue?.close();
  await ctx.analyzeQueue?.close();
  await ctx.notifyQueue?.close();
  await ctx.observeQueue?.close();
  await ctx.redis.quit();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

void enqueueDueScans().catch((error) => {
  ctx.logger.warn({ err: error }, "scheduler start failed");
});
void seedAssetRegistryIfDue(ctx).catch((error) => {
  ctx.logger.warn({ err: error }, "registry seed start failed");
});
void enqueueObserveIfDue(ctx).catch((error) => {
  ctx.logger.warn({ err: error }, "observe enqueue start failed");
});

ctx.logger.info(
  {
    concurrency: ctx.config.RIDDLR_WORKER_CONCURRENCY,
    observeConcurrency: ctx.config.RIDDLR_OBSERVE_CONCURRENCY,
    evidenceLimit: ctx.config.RIDDLR_SCAN_EVIDENCE_LIMIT,
    scheduler: ctx.config.RIDDLR_SCHEDULER_ENABLED,
  },
  "Riddlr worker started",
);
