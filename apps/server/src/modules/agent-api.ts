import {
  agentCreateSchema,
  agentUpdateSchema,
  assetSearchQuerySchema,
  skillCreateSchema,
  skillUpdateSchema,
  type watchlistItemSchema,
} from "@riddlr/api-contract";
import {
  agentMarketDomains,
  agentSkills,
  agentSources,
  agents,
  auditLogs,
  events,
  scans,
  signals,
  skills,
  sources,
  watchlistItems,
  watchlists,
} from "@riddlr/db";
import {
  assertCanonicalAssetId,
  assertSafeSkillMarkdown,
  assertSkillSlug,
  assertSupportedMarketDomains,
  DEFAULT_AGENT_DESCRIPTION,
  InvalidWatchlistItemError,
  MAX_ASSET_SEARCH_RESULTS,
  MAX_SKILLS_PER_AGENT,
  MAX_WATCHLIST_ITEMS,
  resolveDailyTokenBudget,
  shippedSkillCapability,
  skillOperatorCopy,
  takeBounded,
  UnsafeSkillError,
} from "@riddlr/domain";
import { asc, count, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import type { AppContext } from "../context.js";
import { findRegistryAsset, searchAssets } from "./asset-registry.js";
import { enqueueAgentScan } from "./scans.js";

const DEFAULT_SEARCH_NAME = "Watchlist";

function operatorAgentDescription(agent: { kind: string; description?: string | null }) {
  const stored = agent.description?.trim();
  if (stored) {
    return stored;
  }
  return agent.kind === "system_default" ? DEFAULT_AGENT_DESCRIPTION : "";
}

function presentSkill(row: {
  id: string;
  slug: string;
  origin: string;
  version?: string | null;
  description?: string | null;
  markdownBody?: string;
}) {
  const copy = skillOperatorCopy({
    slug: row.slug,
    description: row.description,
    markdownBody: row.markdownBody,
  });
  const catalog = shippedSkillCapability(row.slug);
  return {
    id: row.id,
    slug: row.slug,
    origin: row.origin,
    version: row.version,
    displayName: copy.displayName,
    description: copy.description,
    category: catalog?.category ?? "user",
    markdownBody: row.markdownBody,
  };
}

function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

function failWatchlist(error: unknown, reply: FastifyReply) {
  if (error instanceof InvalidWatchlistItemError) {
    return sendError(reply, 400, "invalid_watchlist", error.message);
  }
  throw error;
}

function failSkill(error: unknown, reply: FastifyReply) {
  if (error instanceof UnsafeSkillError) {
    return sendError(reply, 400, "unsafe_skill", error.message);
  }
  throw error;
}

async function resolveWatchlistItem(ctx: AppContext, item: z.infer<typeof watchlistItemSchema>) {
  const canonicalId = assertCanonicalAssetId(item.canonicalId.trim().toLowerCase());
  const module = ctx.domains.require("crypto");
  if (item.assetClass && !module.assetClasses.includes(item.assetClass)) {
    throw new InvalidWatchlistItemError(
      "Watchlist asset class is not available on the Crypto domain.",
    );
  }
  const found = await findRegistryAsset(ctx, canonicalId);
  if (!found || found.status === "inactive") {
    throw new InvalidWatchlistItemError(`Unknown asset ${canonicalId}.`);
  }
  const resolved = module.canonicalizeAsset(
    {
      canonicalId,
      symbol: item.symbol,
      name: item.name,
      assetClass: item.assetClass,
    },
    [found],
  );
  if (!resolved) {
    throw new InvalidWatchlistItemError(`Unknown asset ${canonicalId}.`);
  }
  if (item.assetClass && resolved.assetClass !== item.assetClass) {
    throw new InvalidWatchlistItemError(
      `Canonical id ${canonicalId} is ${resolved.assetClass}, not ${item.assetClass}.`,
    );
  }
  return resolved;
}

async function ensureWatchlist(ctx: AppContext, agentId: string, name: string) {
  const existing = await ctx.db
    .select()
    .from(watchlists)
    .where(eq(watchlists.agentId, agentId))
    .limit(1);
  if (existing[0]) {
    return existing[0];
  }
  const [row] = await ctx.db.insert(watchlists).values({ agentId, name }).returning();
  if (!row) {
    throw new Error("Failed to create watchlist");
  }
  return row;
}

async function replaceWatchlist(
  ctx: AppContext,
  agentId: string,
  name: string,
  items: z.infer<typeof watchlistItemSchema>[],
) {
  const watchlist = await ensureWatchlist(ctx, agentId, name);
  const resolved = [];
  for (const item of takeBounded(items, MAX_WATCHLIST_ITEMS)) {
    resolved.push(await resolveWatchlistItem(ctx, item));
  }
  await ctx.db.delete(watchlistItems).where(eq(watchlistItems.watchlistId, watchlist.id));
  for (const item of resolved) {
    await ctx.db
      .insert(watchlistItems)
      .values({
        watchlistId: watchlist.id,
        assetClass: item.assetClass,
        canonicalId: item.canonicalId,
        symbol: item.symbol ?? null,
        name: item.displayName ?? null,
      })
      .onConflictDoNothing();
  }
  return watchlist;
}

async function attachSkills(ctx: AppContext, agentId: string, skillIds: string[]) {
  const unique = [...new Set(takeBounded(skillIds, MAX_SKILLS_PER_AGENT))];
  if (unique.length === 0) {
    await ctx.db.delete(agentSkills).where(eq(agentSkills.agentId, agentId));
    return;
  }
  const rows = await ctx.db
    .select()
    .from(skills)
    .where(inArray(skills.id, unique))
    .limit(MAX_SKILLS_PER_AGENT);
  if (rows.length !== unique.length) {
    const error = new Error("One or more skills were not found.");
    (error as Error & { statusCode?: number; code?: string }).statusCode = 400;
    (error as Error & { code?: string }).code = "unknown_skill";
    throw error;
  }
  await ctx.db.delete(agentSkills).where(eq(agentSkills.agentId, agentId));
  await ctx.db.insert(agentSkills).values(unique.map((skillId) => ({ agentId, skillId })));
}

async function listAgentsPayload(ctx: AppContext) {
  const max = ctx.config.RIDDLR_MAX_AGENTS;
  const rows = await ctx.db.select().from(agents).orderBy(asc(agents.createdAt)).limit(max);
  for (const agent of rows) {
    await ensureWatchlist(
      ctx,
      agent.id,
      agent.kind === "system_default" ? "Default watchlist" : `${agent.name} Watchlist`,
    );
  }
  const ids = rows.map((agent) => agent.id);
  const domainRows =
    ids.length > 0
      ? await ctx.db
          .select()
          .from(agentMarketDomains)
          .where(inArray(agentMarketDomains.agentId, ids))
          .limit(max * 8)
      : [];
  const skillRows =
    ids.length > 0
      ? await ctx.db
          .select({
            agentId: agentSkills.agentId,
            id: skills.id,
            slug: skills.slug,
            origin: skills.origin,
            description: skills.description,
            markdownBody: skills.markdownBody,
          })
          .from(agentSkills)
          .innerJoin(skills, eq(agentSkills.skillId, skills.id))
          .where(inArray(agentSkills.agentId, ids))
          .limit(max * MAX_SKILLS_PER_AGENT)
      : [];
  const watchlistRows =
    ids.length > 0
      ? await ctx.db.select().from(watchlists).where(inArray(watchlists.agentId, ids)).limit(max)
      : [];
  const watchlistIds = watchlistRows.map((row) => row.id);
  const itemRows =
    watchlistIds.length > 0
      ? await ctx.db
          .select()
          .from(watchlistItems)
          .where(inArray(watchlistItems.watchlistId, watchlistIds))
          .limit(max * MAX_WATCHLIST_ITEMS)
      : [];
  const sourceRows =
    ids.length > 0
      ? await ctx.db
          .select()
          .from(agentSources)
          .where(inArray(agentSources.agentId, ids))
          .limit(max * 32)
      : [];
  const sourceCatalog =
    sourceRows.length > 0
      ? await ctx.db
          .select()
          .from(sources)
          .where(inArray(sources.id, [...new Set(sourceRows.map((item) => item.sourceId))]))
          .limit(32)
      : [];
  return {
    agents: rows.map((agent) => {
      const watchlist = watchlistRows.find((row) => row.agentId === agent.id);
      return {
        id: agent.id,
        name: agent.name,
        kind: agent.kind,
        enabled: agent.enabled,
        description: operatorAgentDescription(agent),
        schedule: agent.schedule,
        customIntervalMs: agent.customIntervalMs,
        tokenBudget: agent.tokenBudget,
        objectives: agent.objectives,
        notificationPolicy: agent.notificationPolicy,
        default: agent.kind === "system_default",
        sourceIds: sourceRows
          .filter((item) => item.agentId === agent.id)
          .map((item) => item.sourceId),
        sources: sourceRows
          .filter((item) => item.agentId === agent.id)
          .map((item) => {
            const source = sourceCatalog.find((row) => row.id === item.sourceId);
            return {
              id: item.sourceId,
              name: source?.name ?? item.sourceId,
              adapterId: source?.adapterId,
            };
          }),
        domains: domainRows
          .filter((item) => item.agentId === agent.id)
          .map((item) => item.marketDomainId),
        skills: skillRows
          .filter((item) => item.agentId === agent.id)
          .map((item) => {
            const presented = presentSkill(item);
            return {
              id: presented.id,
              slug: presented.slug,
              origin: presented.origin,
              displayName: presented.displayName,
              description: presented.description,
            };
          }),
        watchlist: watchlist
          ? {
              id: watchlist.id,
              name: watchlist.name,
              items: itemRows
                .filter((item) => item.watchlistId === watchlist.id)
                .map((item) => ({
                  id: item.id,
                  canonicalId: item.canonicalId,
                  assetClass: item.assetClass as
                    | "cryptocurrency"
                    | "meme_coin"
                    | "stablecoin"
                    | undefined,
                  symbol: item.symbol ?? undefined,
                  name: item.name ?? undefined,
                })),
            }
          : null,
      };
    }),
  };
}

export function registerAgentRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  authed: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
) {
  app.get("/api/v1/agents", { preHandler: authed }, async () => listAgentsPayload(ctx));

  app.get("/api/v1/agents/:id", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const listed = await listAgentsPayload(ctx);
    const agent = listed.agents.find((item) => item.id === id);
    if (!agent) {
      return sendError(reply, 404, "not_found", "Agent not found");
    }
    return { agent };
  });

  app.get("/api/v1/watchlists", { preHandler: authed }, async () => {
    const listed = await listAgentsPayload(ctx);
    return {
      watchlists: listed.agents
        .map((agent) =>
          agent.watchlist
            ? { ...agent.watchlist, agentId: agent.id, agentName: agent.name }
            : undefined,
        )
        .filter(Boolean),
    };
  });

  app.get("/api/v1/assets", { preHandler: authed }, async (request) => {
    const query = assetSearchQuerySchema.parse(request.query);
    const items = await searchAssets(ctx, query.q ?? "", query.limit ?? MAX_ASSET_SEARCH_RESULTS);
    return {
      assets: items.map((item) => ({
        canonicalId: item.canonicalId,
        assetClass: item.assetClass,
        symbol: item.symbol,
        name: item.name,
        marketCapRank: item.marketCapRank,
      })),
    };
  });

  app.post("/api/v1/agents", { preHandler: authed }, async (request, reply) => {
    const body = agentCreateSchema.parse(request.body);
    try {
      assertSupportedMarketDomains(body.marketDomainIds);
    } catch (error) {
      return sendError(
        reply,
        400,
        "coming_soon",
        error instanceof Error ? error.message : "Coming-soon domains cannot create agents.",
      );
    }
    const [{ value: existing } = { value: 0 }] = await ctx.db
      .select({ value: count() })
      .from(agents);
    if (Number(existing) >= ctx.config.RIDDLR_MAX_AGENTS) {
      return sendError(
        reply,
        400,
        "agent_limit",
        `At most ${ctx.config.RIDDLR_MAX_AGENTS} agents can exist.`,
      );
    }
    const [agent] = await ctx.db
      .insert(agents)
      .values({
        name: body.name,
        kind: "user",
        enabled: body.enabled ?? true,
        description: body.description?.trim() ?? "",
        objectives: body.objectives ?? [],
        schedule: body.schedule,
        customIntervalMs: body.customIntervalMs,
        tokenBudget: resolveDailyTokenBudget(
          body.tokenBudget,
          ctx.config.RIDDLR_DEFAULT_TOKEN_BUDGET,
        ),
        notificationPolicy: body.notificationPolicy ?? {
          minRisk: "moderate",
          cooldownMinutes: 30,
        },
      })
      .returning();
    if (!agent) {
      return sendError(reply, 500, "internal", "Failed to create agent.");
    }
    await ctx.db.insert(agentMarketDomains).values(
      body.marketDomainIds.map((marketDomainId) => ({
        agentId: agent.id,
        marketDomainId,
      })),
    );
    if (body.sourceIds?.length) {
      const sourceRows = await ctx.db
        .select()
        .from(sources)
        .where(inArray(sources.id, body.sourceIds))
        .limit(32);
      await ctx.db
        .insert(agentSources)
        .values(sourceRows.map((source) => ({ agentId: agent.id, sourceId: source.id })));
    } else {
      const sourceRows = await ctx.db
        .select()
        .from(sources)
        .where(eq(sources.enabled, true))
        .limit(32);
      if (sourceRows.length > 0) {
        await ctx.db
          .insert(agentSources)
          .values(sourceRows.map((source) => ({ agentId: agent.id, sourceId: source.id })));
      }
    }
    if (body.skillIds) {
      try {
        await attachSkills(ctx, agent.id, body.skillIds);
      } catch (error) {
        await ctx.db.delete(agentSkills).where(eq(agentSkills.agentId, agent.id));
        await ctx.db.delete(agentMarketDomains).where(eq(agentMarketDomains.agentId, agent.id));
        await ctx.db.delete(agents).where(eq(agents.id, agent.id));
        const status = (error as Error & { statusCode?: number }).statusCode ?? 500;
        return sendError(
          reply,
          status,
          (error as Error & { code?: string }).code ?? "unknown_skill",
          error instanceof Error ? error.message : "Unknown skill.",
        );
      }
    }
    try {
      await replaceWatchlist(
        ctx,
        agent.id,
        `${agent.name} ${DEFAULT_SEARCH_NAME}`,
        body.watchlistItems ?? [],
      );
    } catch (error) {
      const watchlist = await ctx.db
        .select()
        .from(watchlists)
        .where(eq(watchlists.agentId, agent.id))
        .limit(1);
      if (watchlist[0]) {
        await ctx.db.delete(watchlistItems).where(eq(watchlistItems.watchlistId, watchlist[0].id));
        await ctx.db.delete(watchlists).where(eq(watchlists.id, watchlist[0].id));
      }
      await ctx.db.delete(agentSkills).where(eq(agentSkills.agentId, agent.id));
      await ctx.db.delete(agentMarketDomains).where(eq(agentMarketDomains.agentId, agent.id));
      await ctx.db.delete(agents).where(eq(agents.id, agent.id));
      return failWatchlist(error, reply);
    }
    const auth = (request as FastifyRequest & { auth?: { user: { id: string } } }).auth;
    await ctx.db.insert(auditLogs).values({
      actorUserId: auth?.user.id,
      action: "agent.create",
      resource: agent.id,
    });
    const listed = await listAgentsPayload(ctx);
    return { agent: listed.agents.find((item) => item.id === agent.id), agents: listed.agents };
  });

  app.patch("/api/v1/agents/:id", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = agentUpdateSchema.parse(request.body);
    const [agent] = await ctx.db.select().from(agents).where(eq(agents.id, id)).limit(1);
    if (!agent) {
      return sendError(reply, 404, "not_found", "Agent not found");
    }
    if (body.name && agent.kind === "system_default") {
      return sendError(
        reply,
        400,
        "immutable_default",
        "The default agent name cannot be changed.",
      );
    }
    await ctx.db
      .update(agents)
      .set({
        name: body.name ?? agent.name,
        description: body.description?.trim() ?? agent.description,
        schedule: body.schedule ?? agent.schedule,
        customIntervalMs: body.customIntervalMs ?? agent.customIntervalMs,
        enabled: body.enabled ?? agent.enabled,
        tokenBudget: resolveDailyTokenBudget(body.tokenBudget, agent.tokenBudget),
        objectives: body.objectives ?? agent.objectives,
        notificationPolicy: body.notificationPolicy ?? agent.notificationPolicy,
      })
      .where(eq(agents.id, id));
    if (body.skillIds) {
      try {
        await attachSkills(ctx, id, body.skillIds);
      } catch (error) {
        const status = (error as Error & { statusCode?: number }).statusCode ?? 500;
        return sendError(
          reply,
          status,
          (error as Error & { code?: string }).code ?? "unknown_skill",
          error instanceof Error ? error.message : "Unknown skill.",
        );
      }
    }
    if (body.sourceIds) {
      await ctx.db.delete(agentSources).where(eq(agentSources.agentId, id));
      if (body.sourceIds.length > 0) {
        await ctx.db
          .insert(agentSources)
          .values(body.sourceIds.map((sourceId) => ({ agentId: id, sourceId })));
      }
    }
    if (body.watchlistItems) {
      try {
        await replaceWatchlist(
          ctx,
          id,
          `${agent.name} ${DEFAULT_SEARCH_NAME}`,
          body.watchlistItems,
        );
      } catch (error) {
        return failWatchlist(error, reply);
      }
    }
    const listed = await listAgentsPayload(ctx);
    return { agent: listed.agents.find((item) => item.id === id), agents: listed.agents };
  });

  app.post("/api/v1/agents/:id/duplicate", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const listed = await listAgentsPayload(ctx);
    const source = listed.agents.find((item) => item.id === id);
    if (!source) {
      return sendError(reply, 404, "not_found", "Agent not found");
    }
    const [{ value: existing } = { value: 0 }] = await ctx.db
      .select({ value: count() })
      .from(agents);
    if (Number(existing) >= ctx.config.RIDDLR_MAX_AGENTS) {
      return sendError(
        reply,
        400,
        "agent_limit",
        `At most ${ctx.config.RIDDLR_MAX_AGENTS} agents can exist.`,
      );
    }
    const [agent] = await ctx.db
      .insert(agents)
      .values({
        name: `${source.name} copy`.slice(0, 80),
        kind: "user",
        enabled: false,
        description: source.description ?? "",
        objectives: source.objectives,
        schedule: source.schedule,
        customIntervalMs: source.customIntervalMs,
        tokenBudget: source.tokenBudget,
        notificationPolicy: source.notificationPolicy,
      })
      .returning();
    if (!agent) {
      return sendError(reply, 500, "internal", "Failed to duplicate agent.");
    }
    await ctx.db
      .insert(agentMarketDomains)
      .values(source.domains.map((marketDomainId) => ({ agentId: agent.id, marketDomainId })));
    if (source.sourceIds.length > 0) {
      await ctx.db
        .insert(agentSources)
        .values(source.sourceIds.map((sourceId) => ({ agentId: agent.id, sourceId })));
    }
    if (source.skills.length > 0) {
      await ctx.db
        .insert(agentSkills)
        .values(source.skills.map((skill) => ({ agentId: agent.id, skillId: skill.id })));
    }
    await replaceWatchlist(ctx, agent.id, `${agent.name} Watchlist`, source.watchlist?.items ?? []);
    const auth = (request as FastifyRequest & { auth?: { user: { id: string } } }).auth;
    await ctx.db.insert(auditLogs).values({
      actorUserId: auth?.user.id,
      action: "agent.duplicate",
      resource: agent.id,
    });
    const next = await listAgentsPayload(ctx);
    return { agent: next.agents.find((item) => item.id === agent.id), agents: next.agents };
  });

  app.delete("/api/v1/agents/:id", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [agent] = await ctx.db.select().from(agents).where(eq(agents.id, id)).limit(1);
    if (!agent) {
      return sendError(reply, 404, "not_found", "Agent not found");
    }
    if (agent.kind === "system_default") {
      return sendError(reply, 409, "immutable_default", "The default agent cannot be deleted.");
    }
    const [{ value: scanCount } = { value: 0 }] = await ctx.db
      .select({ value: count() })
      .from(scans)
      .where(eq(scans.agentId, id));
    const [{ value: eventCount } = { value: 0 }] = await ctx.db
      .select({ value: count() })
      .from(events)
      .where(eq(events.agentId, id));
    const [{ value: signalCount } = { value: 0 }] = await ctx.db
      .select({ value: count() })
      .from(signals)
      .where(eq(signals.agentId, id));
    if (Number(scanCount) + Number(eventCount) + Number(signalCount) > 0) {
      return sendError(
        reply,
        409,
        "agent_in_use",
        "Disable the agent instead. Scans, events, or signals still reference it.",
      );
    }
    const watchlist = await ctx.db
      .select()
      .from(watchlists)
      .where(eq(watchlists.agentId, id))
      .limit(1);
    if (watchlist[0]) {
      await ctx.db.delete(watchlistItems).where(eq(watchlistItems.watchlistId, watchlist[0].id));
      await ctx.db.delete(watchlists).where(eq(watchlists.id, watchlist[0].id));
    }
    await ctx.db.delete(agentSkills).where(eq(agentSkills.agentId, id));
    await ctx.db.delete(agentMarketDomains).where(eq(agentMarketDomains.agentId, id));
    await ctx.db.delete(agents).where(eq(agents.id, id));
    const auth = (request as FastifyRequest & { auth?: { user: { id: string } } }).auth;
    await ctx.db.insert(auditLogs).values({
      actorUserId: auth?.user.id,
      action: "agent.delete",
      resource: id,
    });
    return { ok: true, agents: (await listAgentsPayload(ctx)).agents };
  });

  app.post("/api/v1/agents/:id/scan", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await enqueueAgentScan(ctx, id);
    } catch (error) {
      const status = (error as Error & { statusCode?: number }).statusCode;
      if (status) {
        return sendError(
          reply,
          status,
          (error as Error & { code?: string }).code ?? "scan_error",
          error instanceof Error ? error.message : "Scan failed.",
        );
      }
      throw error;
    }
  });

  app.get("/api/v1/skills", { preHandler: authed }, async () => {
    const rows = await ctx.db.select().from(skills).orderBy(asc(skills.slug)).limit(50);
    return {
      skills: rows.map((row) => presentSkill(row)),
    };
  });

  app.post("/api/v1/skills", { preHandler: authed }, async (request, reply) => {
    const body = skillCreateSchema.parse(request.body);
    try {
      assertSkillSlug(body.slug);
      assertSafeSkillMarkdown(body.markdownBody);
    } catch (error) {
      return failSkill(error, reply);
    }
    const existing = await ctx.db.select().from(skills).where(eq(skills.slug, body.slug)).limit(1);
    if (existing[0]?.origin === "shipped") {
      return sendError(reply, 409, "shipped_skill", "Shipped skills cannot be overwritten.");
    }
    if (existing[0]) {
      return sendError(reply, 409, "skill_exists", "A skill with that slug already exists.");
    }
    const [skill] = await ctx.db
      .insert(skills)
      .values({
        slug: body.slug,
        version: "1",
        origin: "user",
        description: skillOperatorCopy({
          slug: body.slug,
          description: body.description,
          markdownBody: body.markdownBody,
        }).description,
        markdownBody: body.markdownBody,
      })
      .returning();
    const auth = (request as FastifyRequest & { auth?: { user: { id: string } } }).auth;
    await ctx.db.insert(auditLogs).values({
      actorUserId: auth?.user.id,
      action: "skill.create",
      resource: skill?.id,
    });
    return { skill: skill ? presentSkill(skill) : undefined };
  });

  app.get("/api/v1/skills/:id", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [skill] = await ctx.db.select().from(skills).where(eq(skills.id, id)).limit(1);
    if (!skill) {
      return sendError(reply, 404, "not_found", "Skill not found");
    }
    return {
      skill: presentSkill(skill),
    };
  });

  app.patch("/api/v1/skills/:id", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = skillUpdateSchema.parse(request.body);
    const [skill] = await ctx.db.select().from(skills).where(eq(skills.id, id)).limit(1);
    if (!skill) {
      return sendError(reply, 404, "not_found", "Skill not found");
    }
    if (skill.origin === "shipped") {
      return sendError(reply, 409, "shipped_skill", "Shipped skills cannot be overwritten.");
    }
    const markdownBody = body.markdownBody ?? skill.markdownBody;
    try {
      assertSafeSkillMarkdown(markdownBody);
    } catch (error) {
      return failSkill(error, reply);
    }
    const [updated] = await ctx.db
      .update(skills)
      .set({
        description:
          body.description !== undefined
            ? skillOperatorCopy({
                slug: skill.slug,
                description: body.description,
                markdownBody,
              }).description
            : skill.description,
        markdownBody,
      })
      .where(eq(skills.id, id))
      .returning();
    return {
      skill: updated ? presentSkill(updated) : undefined,
    };
  });

  app.delete("/api/v1/skills/:id", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [skill] = await ctx.db.select().from(skills).where(eq(skills.id, id)).limit(1);
    if (!skill) {
      return sendError(reply, 404, "not_found", "Skill not found");
    }
    if (skill.origin === "shipped") {
      return sendError(reply, 409, "shipped_skill", "Shipped skills cannot be deleted.");
    }
    await ctx.db.delete(agentSkills).where(eq(agentSkills.skillId, id));
    await ctx.db.delete(skills).where(eq(skills.id, id));
    return { ok: true };
  });
}

export { attachSkills, replaceWatchlist };
