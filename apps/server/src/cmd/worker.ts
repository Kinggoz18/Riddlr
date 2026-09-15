import { agents, evidenceItems, evidenceOccurrences, scans, sources } from "@riddlr/db";
import { assertSupportedMarketDomains, type MarketDomainId } from "@riddlr/domain";
import { snapshotProcessMemory } from "@riddlr/observability";
import { QUEUE_NAMES } from "@riddlr/queue";
import {
  BINANCE_FUTURES_PROVIDER_ID,
  runBinanceForceOrderSocket,
  sharedBinanceForceOrderAggregator,
} from "@riddlr/source-adapters";
import { Worker } from "bullmq";
import { and, eq } from "drizzle-orm";
import { createContext } from "../context.js";
import { seedAssetRegistryIfDue } from "../modules/asset-registry.js";
import { processInboundReceipt } from "../modules/inbound-webhooks.js";
import { enrichAndUnderstandScan } from "../modules/intelligence.js";
import { deliverSignalNotifications } from "../modules/notify.js";
import {
  enqueueObserveIfDue,
  pollObservationProvider,
  seedE2eObservedShock,
} from "../modules/observe.js";
import { recordDueOutcomes, resolveExpiredEvents } from "../modules/outcomes.js";
import { analyzeQueuedEvent, clusterScanEvents, runScan } from "../modules/pipeline.js";
import { enqueueAgentScan } from "../modules/scans.js";

const ctx = await createContext();
const wsAbort = new AbortController();
if (ctx.config.RIDDLR_ENV !== "test") {
  const aggregator = sharedBinanceForceOrderAggregator({
    onDrop: (reason) =>
      ctx.metrics.observeWsDrops.inc({ provider: BINANCE_FUTURES_PROVIDER_ID, reason }),
  });
  void runBinanceForceOrderSocket({
    aggregator,
    isEnabled: async () => {
      const [row] = await ctx.db
        .select({ id: sources.id })
        .from(sources)
        .where(and(eq(sources.adapterId, BINANCE_FUTURES_PROVIDER_ID), eq(sources.enabled, true)))
        .limit(1);
      return Boolean(row);
    },
    signal: wsAbort.signal,
    logger: ctx.logger,
  });
}
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
    const data = job.data as {
      kind?: string;
      receiptId?: string;
      offset?: number;
      providerId?: string;
    };
    if (data.kind === "inbound" && data.receiptId) {
      await processInboundReceipt(ctx, data.receiptId, data.offset ?? 0);
      return;
    }
    const providerId = String(data.providerId ?? "");
    if (!providerId) {
      return;
    }
    await pollObservationProvider(ctx, providerId);
  },
  { ...workerOptions, concurrency: ctx.config.RIDDLR_OBSERVE_CONCURRENCY },
);

const outcomesWorker = new Worker(
  QUEUE_NAMES.recordOutcomes,
  async () => {
    await resolveExpiredEvents(ctx);
    await recordDueOutcomes(ctx);
  },
  { ...workerOptions, concurrency: 1 },
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
  void seedE2eObservedShock(ctx).catch((error) => {
    ctx.logger.warn({ err: error }, "e2e observation seed failed");
  });
  void ctx.outcomesQueue
    ?.add(
      "outcomes",
      { idempotencyKey: "outcomes:tick" },
      { jobId: `outcomes:${Math.floor(Date.now() / 60_000)}`, attempts: 1 },
    )
    .catch((error) => {
      ctx.logger.warn({ err: error }, "outcomes enqueue tick failed");
    });
}, 60_000);

const shutdown = async () => {
  wsAbort.abort();
  clearInterval(scheduler);
  clearInterval(heartbeat);
  await worker.close();
  await notifyWorker.close();
  await analyzeWorker.close();
  await enrichWorker.close();
  await understandWorker.close();
  await clusterWorker.close();
  await observeWorker.close();
  await outcomesWorker.close();
  await ctx.scanQueue.close();
  await ctx.ingestQueue?.close();
  await ctx.enrichQueue?.close();
  await ctx.understandQueue?.close();
  await ctx.clusterQueue?.close();
  await ctx.analyzeQueue?.close();
  await ctx.notifyQueue?.close();
  await ctx.observeQueue?.close();
  await ctx.outcomesQueue?.close();
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
