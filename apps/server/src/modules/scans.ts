import { agentMarketDomains, agents, scans } from "@riddlr/db";
import { assertSupportedMarketDomains, scanWindowStart } from "@riddlr/domain";
import { eq } from "drizzle-orm";
import type { AppContext } from "../context.js";

export async function enqueueAgentScan(ctx: AppContext, agentId: string) {
  const agentRows = await ctx.db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  const agent = agentRows[0];
  if (!agent) {
    const error = new Error("Agent not found");
    (error as Error & { statusCode?: number; code?: string }).statusCode = 404;
    (error as Error & { code?: string }).code = "not_found";
    throw error;
  }
  const joins = await ctx.db
    .select()
    .from(agentMarketDomains)
    .where(eq(agentMarketDomains.agentId, agentId))
    .limit(8);
  try {
    assertSupportedMarketDomains(joins.map((item) => item.marketDomainId));
  } catch (error) {
    const wrapped = new Error(
      error instanceof Error ? error.message : "Coming-soon domains cannot start scans.",
    );
    (wrapped as Error & { statusCode?: number; code?: string }).statusCode = 400;
    (wrapped as Error & { code?: string }).code = "coming_soon";
    throw wrapped;
  }
  const windowStart = scanWindowStart(
    agent.schedule,
    new Date(),
    agent.customIntervalMs ?? undefined,
  );
  const idempotencyKey = `scan:${agentId}:${windowStart.toISOString()}`;
  const existing = await ctx.db
    .select()
    .from(scans)
    .where(eq(scans.idempotencyKey, idempotencyKey))
    .limit(1);
  if (existing[0]) {
    if (existing[0].status === "queued" || existing[0].status === "running") {
      return { scan: existing[0], duplicate: true };
    }
    if (existing[0].status === "failed") {
      const retryAttempt = (existing[0].retryAttempt ?? 0) + 1;
      const retryKey = `${idempotencyKey}:retry:${retryAttempt}`;
      const [scan] = await ctx.db
        .insert(scans)
        .values({
          agentId,
          status: "queued",
          windowStart,
          idempotencyKey: retryKey,
          retryAttempt,
        })
        .onConflictDoNothing()
        .returning();
      if (scan) {
        await ctx.scanQueue.add(
          "scan",
          { scanId: scan.id, agentId, idempotencyKey: retryKey },
          { jobId: retryKey, removeOnComplete: 50, removeOnFail: 50 },
        );
        return { scan, duplicate: false, retry: true };
      }
    }
    return { scan: existing[0], duplicate: true };
  }
  const [scan] = await ctx.db
    .insert(scans)
    .values({
      agentId,
      status: "queued",
      windowStart,
      idempotencyKey,
    })
    .onConflictDoNothing()
    .returning();
  if (!scan) {
    const again = await ctx.db
      .select()
      .from(scans)
      .where(eq(scans.idempotencyKey, idempotencyKey))
      .limit(1);
    return { scan: again[0], duplicate: true };
  }
  await ctx.scanQueue.add(
    "scan",
    { scanId: scan.id, agentId, idempotencyKey },
    { jobId: idempotencyKey, removeOnComplete: 50, removeOnFail: 50 },
  );
  return { scan, duplicate: false };
}
