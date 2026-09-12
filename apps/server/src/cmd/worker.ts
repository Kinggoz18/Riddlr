import { agents } from "@riddlr/db";
import { snapshotProcessMemory } from "@riddlr/observability";
import { QUEUE_NAMES } from "@riddlr/queue";
import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { createContext } from "../context.js";
import { deliverSignalNotifications } from "../modules/notify.js";
import { analyzeQueuedEvent, runScan } from "../modules/pipeline.js";
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
}, 60_000);

const shutdown = async () => {
  clearInterval(scheduler);
  clearInterval(heartbeat);
  await worker.close();
  await notifyWorker.close();
  await analyzeWorker.close();
  await ctx.scanQueue.close();
  await ctx.analyzeQueue.close();
  await ctx.notifyQueue.close();
  await ctx.redis.quit();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

void enqueueDueScans().catch((error) => {
  ctx.logger.warn({ err: error }, "scheduler start failed");
});

ctx.logger.info(
  {
    concurrency: ctx.config.RIDDLR_WORKER_CONCURRENCY,
    evidenceLimit: ctx.config.RIDDLR_SCAN_EVIDENCE_LIMIT,
    scheduler: ctx.config.RIDDLR_SCHEDULER_ENABLED,
  },
  "Riddlr worker started",
);
