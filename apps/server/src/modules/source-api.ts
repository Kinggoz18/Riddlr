import {
  coingeckoSourceSchema,
  coinmarketcapSourceSchema,
  cryptocomSourceSchema,
  discordSourceSchema,
  feedSourceSchema,
  pageQuerySchema,
  publisherHostPolicySchema,
  sourceIdentityPolicySchema,
  sourcePatchSchema,
  xSourceSchema,
} from "@riddlr/api-contract";
import { encryptSecret } from "@riddlr/crypto";
import {
  auditLogs,
  encryptedSecrets,
  evidenceItems,
  instanceSettings,
  publisherHostPolicies,
  scanSourceRuns,
  sourceIdentities,
  sourceIdentityPolicies,
  sources,
} from "@riddlr/db";
import { clampPageSize, parsePageCursor, type TrustTier } from "@riddlr/domain";
import {
  clampFeedPollIntervalSeconds,
  createCoinGeckoAdapter,
  createCoinMarketCapAdapter,
  createCryptoComAdapter,
  createDiscordAdapter,
  createFeedsAdapter,
  createSearxngAdapter,
  createXAdapter,
  DISCORD_BOT_PERMISSIONS,
  defaultTrustForFeedUrl,
  parseSearxngEngines,
  SUGGESTED_FEEDS,
} from "@riddlr/source-adapters";
import { and, count, desc, eq, lt } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../context.js";
import { ensureDefaultPriceTrackerHostPolicies, upsertSourceIdentity } from "./intelligence.js";
import {
  attachSourceToAgents,
  isMarketDataAdapter,
  marketAdapter,
  replaceSourceAgents,
  setActiveMarketSource,
  sourceRuntimeConfig,
} from "./market-sources.js";

export function publicSource(row: typeof sources.$inferSelect) {
  const config = { ...(row.config ?? {}) };
  delete config.token;
  return {
    id: row.id,
    family: row.family,
    adapterId: row.adapterId,
    enabled: row.enabled,
    name: row.name,
    config,
    lastHealthOk: row.lastHealthOk,
    lastHealthMessage: row.lastHealthMessage,
    lastHealthAt: row.lastHealthAt,
    tokenConfigured: Boolean(row.secretId),
  };
}

export function registerSourceRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  authed: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
) {
  const discord = createDiscordAdapter();
  const searxng = createSearxngAdapter();
  const x = createXAdapter();
  const feeds = createFeedsAdapter();
  const coingecko = createCoinGeckoAdapter();
  const coinmarketcap = createCoinMarketCapAdapter();
  const cryptocom = createCryptoComAdapter();

  app.get("/api/v1/sources", { preHandler: authed }, async () => {
    const rows = await ctx.db.select().from(sources).limit(ctx.config.RIDDLR_SCAN_SOURCE_LIMIT);
    return {
      sources: rows.map(publicSource),
      adapters: [
        {
          id: searxng.id,
          family: searxng.family,
          capabilities: searxng.capabilities,
        },
        {
          id: discord.id,
          family: discord.family,
          capabilities: discord.capabilities,
          botPermissions: DISCORD_BOT_PERMISSIONS,
        },
        {
          id: x.id,
          family: x.family,
          capabilities: x.capabilities,
        },
        {
          id: feeds.id,
          family: feeds.family,
          capabilities: feeds.capabilities,
          suggestedFeeds: SUGGESTED_FEEDS,
        },
        {
          id: coingecko.id,
          family: coingecko.family,
          capabilities: coingecko.capabilities,
        },
        {
          id: coinmarketcap.id,
          family: coinmarketcap.family,
          capabilities: coinmarketcap.capabilities,
        },
        {
          id: cryptocom.id,
          family: cryptocom.family,
          capabilities: cryptocom.capabilities,
        },
        {
          id: "onchain",
          family: "onchain",
          comingSoon: true,
          capabilities: {
            modes: [],
            supportsTimeRange: false,
            supportsPagination: false,
            supportsDomainFilter: false,
            lookbackNotes:
              "On-chain scanning is not implemented. Wallet addresses on Portfolios are identifiers only. Never paste a seed phrase or private key.",
            partialResults: false,
          },
        },
      ],
    };
  });

  app.post("/api/v1/sources/discord", { preHandler: authed }, async (request, reply) => {
    const body = discordSourceSchema.parse(request.body);
    const validated = await discord.validate({
      token: body.botToken,
      guildId: body.guildId,
      channelIds: body.channelIds,
      excludeChannelIds: body.excludeChannelIds,
      keywords: body.keywords,
      lookbackHours: body.lookbackHours,
      liveValidate: ctx.config.RIDDLR_ENV !== "test",
    });
    if (!validated.ok) {
      return reply
        .code(400)
        .send({ error: { code: "invalid_source", message: validated.message } });
    }
    return insertSecretSource(ctx, request, reply, {
      family: "discord",
      adapterId: "discord",
      name: body.name,
      purpose: "discord",
      token: body.botToken,
      config: {
        guildId: body.guildId,
        channelIds: body.channelIds,
        excludeChannelIds: body.excludeChannelIds ?? [],
        keywords: body.keywords ?? [],
        lookbackHours: body.lookbackHours ?? 6,
      },
    });
  });

  app.post("/api/v1/sources/x", { preHandler: authed }, async (request, reply) => {
    const body = xSourceSchema.parse(request.body);
    const validated = await x.validate({
      token: body.bearerToken,
      authors: body.authors,
      mentions: body.mentions,
      keywords: body.keywords,
      lookbackHours: body.lookbackHours,
    });
    if (!validated.ok) {
      return reply
        .code(400)
        .send({ error: { code: "invalid_source", message: validated.message } });
    }
    return insertSecretSource(ctx, request, reply, {
      family: "x",
      adapterId: "x",
      name: body.name,
      purpose: "x",
      token: body.bearerToken,
      config: {
        authors: body.authors ?? [],
        mentions: body.mentions ?? [],
        keywords: body.keywords ?? [],
        lookbackHours: body.lookbackHours ?? 24,
      },
    });
  });

  app.post("/api/v1/sources/coingecko", { preHandler: authed }, async (request, reply) => {
    const body = coingeckoSourceSchema.parse(request.body);
    const assetIds = body.assetIds?.length ? body.assetIds : ["bitcoin", "ethereum", "tether"];
    const validated = await coingecko.validate({ assetIds, token: body.apiKey });
    if (!validated.ok) {
      return reply
        .code(400)
        .send({ error: { code: "invalid_source", message: validated.message } });
    }
    if (body.apiKey) {
      return insertSecretSource(ctx, request, reply, {
        family: "market_data",
        adapterId: "coingecko",
        name: body.name,
        purpose: "coingecko",
        token: body.apiKey,
        config: { assetIds },
      });
    }
    return insertMarketSource(ctx, request, reply, {
      adapterId: "coingecko",
      name: body.name,
      config: { assetIds },
    });
  });

  app.post("/api/v1/sources/coinmarketcap", { preHandler: authed }, async (request, reply) => {
    const body = coinmarketcapSourceSchema.parse(request.body);
    const assetIds = body.assetIds?.length ? body.assetIds : ["bitcoin", "ethereum", "tether"];
    const validated = await coinmarketcap.validate({ assetIds, token: body.apiKey });
    if (!validated.ok) {
      return reply
        .code(400)
        .send({ error: { code: "invalid_source", message: validated.message } });
    }
    return insertSecretSource(ctx, request, reply, {
      family: "market_data",
      adapterId: "coinmarketcap",
      name: body.name,
      purpose: "coinmarketcap",
      token: body.apiKey,
      config: { assetIds },
    });
  });

  app.post("/api/v1/sources/cryptocom", { preHandler: authed }, async (request, reply) => {
    const body = cryptocomSourceSchema.parse(request.body);
    const assetIds = body.assetIds?.length ? body.assetIds : ["bitcoin", "ethereum", "tether"];
    const validated = await cryptocom.validate({ assetIds });
    if (!validated.ok) {
      return reply
        .code(400)
        .send({ error: { code: "invalid_source", message: validated.message } });
    }
    return insertMarketSource(ctx, request, reply, {
      adapterId: "cryptocom",
      name: body.name,
      config: { assetIds },
    });
  });

  app.post("/api/v1/sources/feeds", { preHandler: authed }, async (request, reply) => {
    const body = feedSourceSchema.parse(request.body);
    const feedUrl = new URL(body.feedUrl).href;
    const trustTier: TrustTier = body.trustTier ?? defaultTrustForFeedUrl(feedUrl);
    const pollIntervalSeconds = clampFeedPollIntervalSeconds(body.pollIntervalSeconds);
    const validated = await feeds.validate({ feedUrl, trustTier, pollIntervalSeconds });
    if (!validated.ok) {
      return reply
        .code(400)
        .send({ error: { code: "invalid_source", message: validated.message } });
    }
    return insertFeedSource(ctx, request, reply, {
      name: body.name,
      feedUrl,
      trustTier,
      pollIntervalSeconds,
    });
  });

  app.get("/api/v1/sources/:id", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await ctx.db.select().from(sources).where(eq(sources.id, id)).limit(1);
    if (!row) {
      return reply.code(404).send({ error: { code: "not_found", message: "Source not found" } });
    }
    return { source: publicSource(row) };
  });

  app.patch("/api/v1/sources/:id", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = sourcePatchSchema.parse(request.body);
    const [row] = await ctx.db.select().from(sources).where(eq(sources.id, id)).limit(1);
    if (!row) {
      return reply.code(404).send({ error: { code: "not_found", message: "Source not found" } });
    }
    let nextConfig = { ...row.config, ...(body.config ?? {}) };
    if (row.adapterId === "searxng") {
      let engines: string[] = [];
      try {
        engines = parseSearxngEngines(
          body.config && Object.hasOwn(body.config, "engines")
            ? body.config.engines
            : row.config.engines,
        );
      } catch (error) {
        return reply.code(400).send({
          error: {
            code: "invalid_source",
            message: error instanceof Error ? error.message : "Invalid SearXNG engines.",
          },
        });
      }
      nextConfig = { endpoint: row.config.endpoint, engines };
    }
    let secretId = row.secretId;
    if (body.token) {
      const settingsRows = await ctx.db.select().from(instanceSettings).limit(1);
      const keyVersion = settingsRows[0]?.keyVersion ?? 1;
      const encrypted = encryptSecret({
        masterKey: ctx.masterKey,
        plaintext: body.token,
        purpose: row.adapterId,
        keyVersion,
        aad: `${row.adapterId}|${keyVersion}`,
      });
      const [secret] = await ctx.db
        .insert(encryptedSecrets)
        .values({
          purpose: row.adapterId,
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce,
          tag: encrypted.tag,
          alg: encrypted.alg,
          keyVersion,
        })
        .returning();
      secretId = secret?.id ?? row.secretId;
    }
    const [updated] = await ctx.db
      .update(sources)
      .set({
        name: body.name ?? row.name,
        enabled: body.enabled ?? row.enabled,
        config: nextConfig,
        secretId,
      })
      .where(eq(sources.id, id))
      .returning();
    if (updated && isMarketDataAdapter(updated.adapterId) && updated.enabled) {
      await setActiveMarketSource(ctx, updated.id);
    }
    if (body.agentIds) {
      await replaceSourceAgents(ctx, id, body.agentIds);
    }
    return { source: updated ? publicSource(updated) : publicSource(row) };
  });

  app.post("/api/v1/sources/:id/test", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await ctx.db.select().from(sources).where(eq(sources.id, id)).limit(1);
    if (!row) {
      return reply.code(404).send({ error: { code: "not_found", message: "Source not found" } });
    }
    const adapter =
      row.adapterId === "discord"
        ? discord
        : row.adapterId === "x"
          ? x
          : row.adapterId === "feeds"
            ? feeds
            : (marketAdapter(row.adapterId) ?? searxng);
    const health = await adapter.healthCheck(await sourceRuntimeConfig(ctx, row));
    await ctx.db
      .update(sources)
      .set({
        lastHealthOk: health.ok,
        lastHealthMessage: health.message,
        lastHealthAt: new Date(),
      })
      .where(eq(sources.id, id));
    return { ok: health.ok, message: health.message };
  });

  app.get("/api/v1/sources/:id/evidence", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = pageQuerySchema.parse(request.query);
    const limit = clampPageSize(query.limit, 50);
    const before = parsePageCursor(query.before);
    const [row] = await ctx.db.select().from(sources).where(eq(sources.id, id)).limit(1);
    if (!row) {
      return reply.code(404).send({ error: { code: "not_found", message: "Source not found" } });
    }
    const items = before
      ? await ctx.db
          .select()
          .from(evidenceItems)
          .where(and(eq(evidenceItems.sourceId, id), lt(evidenceItems.fetchedAt, before)))
          .orderBy(desc(evidenceItems.fetchedAt))
          .limit(limit)
      : await ctx.db
          .select()
          .from(evidenceItems)
          .where(eq(evidenceItems.sourceId, id))
          .orderBy(desc(evidenceItems.fetchedAt))
          .limit(limit);
    return {
      evidence: items.map((item) => ({
        id: item.id,
        title: item.title,
        canonicalUrl: item.canonicalUrl,
        fetchedAt: item.fetchedAt,
      })),
    };
  });

  app.get("/api/v1/sources/:id/errors", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await ctx.db.select().from(sources).where(eq(sources.id, id)).limit(1);
    if (!row) {
      return reply.code(404).send({ error: { code: "not_found", message: "Source not found" } });
    }
    const errors = await ctx.db
      .select()
      .from(scanSourceRuns)
      .where(eq(scanSourceRuns.sourceId, id))
      .orderBy(desc(scanSourceRuns.id))
      .limit(50);
    return {
      errors: errors
        .filter((item) => item.errorClass)
        .map((item) => ({
          scanId: item.scanId,
          class: item.errorClass,
          message: item.errorMessage,
          status: item.status,
        })),
    };
  });

  app.delete("/api/v1/sources/:id", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await ctx.db.select().from(sources).where(eq(sources.id, id)).limit(1);
    if (!row) {
      return reply.code(404).send({ error: { code: "not_found", message: "Source not found" } });
    }
    if (row.adapterId === "searxng") {
      return reply.code(409).send({
        error: {
          code: "immutable_source",
          message: "SearXNG cannot be removed from this page.",
        },
      });
    }
    const [{ value: runCount } = { value: 0 }] = await ctx.db
      .select({ value: count() })
      .from(scanSourceRuns)
      .where(eq(scanSourceRuns.sourceId, id));
    if (Number(runCount) > 0) {
      await ctx.db.update(sources).set({ enabled: false }).where(eq(sources.id, id));
      return {
        ok: true,
        disabled: true,
        message: "Source was disabled because scans still reference it.",
      };
    }
    await ctx.db.delete(sources).where(eq(sources.id, id));
    if (row.secretId) {
      await ctx.db.delete(encryptedSecrets).where(eq(encryptedSecrets.id, row.secretId));
    }
    return { ok: true };
  });

  app.get("/api/v1/source-identities", { preHandler: authed }, async () => {
    const identities = await ctx.db.select().from(sourceIdentities).limit(100);
    const policies = await ctx.db.select().from(sourceIdentityPolicies).limit(200);
    return {
      identities: identities.map((identity) => ({
        ...identity,
        policy: policies
          .filter((item) => item.identityId === identity.id && item.active)
          .sort((left, right) => right.revision - left.revision)[0],
      })),
    };
  });

  app.post(
    "/api/v1/source-identities/:id/policy",
    { preHandler: authed },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = sourceIdentityPolicySchema.parse(request.body);
      const [identity] = await ctx.db
        .select()
        .from(sourceIdentities)
        .where(eq(sourceIdentities.id, id))
        .limit(1);
      if (!identity) {
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "Identity not found" } });
      }
      const existing = await ctx.db
        .select()
        .from(sourceIdentityPolicies)
        .where(eq(sourceIdentityPolicies.identityId, id))
        .limit(50);
      const revision = existing.reduce((max, row) => Math.max(max, row.revision), 0) + 1;
      await ctx.db
        .update(sourceIdentityPolicies)
        .set({ active: false })
        .where(eq(sourceIdentityPolicies.identityId, id));
      const [policy] = await ctx.db
        .insert(sourceIdentityPolicies)
        .values({
          identityId: id,
          revision,
          trustTier: body.trustTier,
          allowedUses: body.allowedUses,
          notes: body.notes,
          active: true,
        })
        .returning();
      return { policy };
    },
  );

  app.get("/api/v1/publisher-hosts", { preHandler: authed }, async () => {
    await ensureDefaultPriceTrackerHostPolicies(ctx);
    const rows = await ctx.db.select().from(publisherHostPolicies).limit(200);
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const current = latest.get(row.hostname);
      if (!current || row.revision > current.revision) {
        latest.set(row.hostname, row);
      }
    }
    return { hosts: [...latest.values()] };
  });

  app.post("/api/v1/publisher-hosts", { preHandler: authed }, async (request) => {
    const body = publisherHostPolicySchema.parse(request.body);
    const hostname = body.hostname.toLowerCase();
    const existing = await ctx.db
      .select()
      .from(publisherHostPolicies)
      .where(eq(publisherHostPolicies.hostname, hostname))
      .limit(50);
    const revision = existing.reduce((max, row) => Math.max(max, row.revision), 0) + 1;
    const [policy] = await ctx.db
      .insert(publisherHostPolicies)
      .values({
        hostname,
        revision,
        trustTier: body.trustTier,
        blocked: body.blocked ?? false,
        notes: body.notes,
      })
      .returning();
    return { policy };
  });
}

async function insertSecretSource(
  ctx: AppContext,
  request: FastifyRequest,
  reply: FastifyReply,
  input: {
    family: string;
    adapterId: string;
    name: string;
    purpose: string;
    token: string;
    config: Record<string, unknown>;
  },
) {
  const existing = await ctx.db.select().from(sources).limit(ctx.config.RIDDLR_SCAN_SOURCE_LIMIT);
  if (existing.length >= ctx.config.RIDDLR_SCAN_SOURCE_LIMIT) {
    return reply.code(400).send({
      error: {
        code: "source_limit",
        message: `At most ${ctx.config.RIDDLR_SCAN_SOURCE_LIMIT} sources can be enabled.`,
      },
    });
  }
  if (
    isMarketDataAdapter(input.adapterId) &&
    existing.some((row) => row.adapterId === input.adapterId)
  ) {
    return reply.code(409).send({
      error: {
        code: "source_exists",
        message: `${input.name} is already configured. Enable it to make it the active market source.`,
      },
    });
  }
  const settingsRows = await ctx.db.select().from(instanceSettings).limit(1);
  const keyVersion = settingsRows[0]?.keyVersion ?? 1;
  const encrypted = encryptSecret({
    masterKey: ctx.masterKey,
    plaintext: input.token,
    purpose: input.purpose,
    keyVersion,
    aad: `${input.purpose}|${keyVersion}`,
  });
  const [secret] = await ctx.db
    .insert(encryptedSecrets)
    .values({
      purpose: input.purpose,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      tag: encrypted.tag,
      alg: encrypted.alg,
      keyVersion,
    })
    .returning();
  const [source] = await ctx.db
    .insert(sources)
    .values({
      family: input.family,
      adapterId: input.adapterId,
      enabled: true,
      name: input.name,
      secretId: secret?.id,
      config: input.config,
    })
    .returning();
  if (source && isMarketDataAdapter(source.adapterId)) {
    await setActiveMarketSource(ctx, source.id);
  }
  if (source) {
    await attachSourceToAgents(ctx, source.id);
  }
  const auth = (request as FastifyRequest & { auth?: { user: { id: string } } }).auth;
  await ctx.db.insert(auditLogs).values({
    actorUserId: auth?.user.id,
    action: "source.create",
    resource: source?.id,
  });
  return { source: source ? publicSource(source) : undefined };
}

async function insertMarketSource(
  ctx: AppContext,
  request: FastifyRequest,
  reply: FastifyReply,
  input: {
    adapterId: string;
    name: string;
    config: Record<string, unknown>;
  },
) {
  const existing = await ctx.db.select().from(sources).limit(ctx.config.RIDDLR_SCAN_SOURCE_LIMIT);
  if (existing.length >= ctx.config.RIDDLR_SCAN_SOURCE_LIMIT) {
    return reply.code(400).send({
      error: {
        code: "source_limit",
        message: `At most ${ctx.config.RIDDLR_SCAN_SOURCE_LIMIT} sources can be enabled.`,
      },
    });
  }
  if (existing.some((row) => row.adapterId === input.adapterId)) {
    return reply.code(409).send({
      error: {
        code: "source_exists",
        message: `${input.name} is already configured. Enable it to make it the active market source.`,
      },
    });
  }
  const [source] = await ctx.db
    .insert(sources)
    .values({
      family: "market_data",
      adapterId: input.adapterId,
      enabled: true,
      name: input.name,
      config: input.config,
    })
    .returning();
  if (source) {
    await setActiveMarketSource(ctx, source.id);
    await attachSourceToAgents(ctx, source.id);
  }
  const auth = (request as FastifyRequest & { auth?: { user: { id: string } } }).auth;
  await ctx.db.insert(auditLogs).values({
    actorUserId: auth?.user.id,
    action: "source.create",
    resource: source?.id,
  });
  return { source: source ? publicSource(source) : undefined };
}

function allowedUsesForTier(tier: TrustTier): string[] {
  if (tier === "blocked") {
    return ["discovery"];
  }
  if (tier === "official_firsthand") {
    return ["discovery", "analysis", "early_warning", "confirmation"];
  }
  return ["discovery", "analysis"];
}

async function insertFeedSource(
  ctx: AppContext,
  request: FastifyRequest,
  reply: FastifyReply,
  input: {
    name: string;
    feedUrl: string;
    trustTier: TrustTier;
    pollIntervalSeconds: number;
  },
) {
  const existing = await ctx.db.select().from(sources).limit(ctx.config.RIDDLR_SCAN_SOURCE_LIMIT);
  if (existing.length >= ctx.config.RIDDLR_SCAN_SOURCE_LIMIT) {
    return reply.code(400).send({
      error: {
        code: "source_limit",
        message: `At most ${ctx.config.RIDDLR_SCAN_SOURCE_LIMIT} sources can be enabled.`,
      },
    });
  }
  const duplicate = existing.find(
    (row) =>
      row.adapterId === "feeds" &&
      typeof row.config.feedUrl === "string" &&
      row.config.feedUrl === input.feedUrl,
  );
  if (duplicate) {
    return reply.code(409).send({
      error: {
        code: "source_exists",
        message: "That feed URL is already configured.",
      },
    });
  }
  const [source] = await ctx.db
    .insert(sources)
    .values({
      family: "feed",
      adapterId: "feeds",
      enabled: true,
      name: input.name,
      config: {
        feedUrl: input.feedUrl,
        trustTier: input.trustTier,
        pollIntervalSeconds: input.pollIntervalSeconds,
      },
    })
    .returning();
  if (source) {
    await attachSourceToAgents(ctx, source.id);
    const hostname = new URL(input.feedUrl).hostname.toLowerCase();
    const identityId = await upsertSourceIdentity(ctx, {
      platform: "feed",
      externalId: hostname,
      displayName: input.name,
      hostname,
    });
    if (identityId) {
      const existingPolicies = await ctx.db
        .select()
        .from(sourceIdentityPolicies)
        .where(eq(sourceIdentityPolicies.identityId, identityId))
        .limit(50);
      const revision = existingPolicies.reduce((max, row) => Math.max(max, row.revision), 0) + 1;
      await ctx.db
        .update(sourceIdentityPolicies)
        .set({ active: false })
        .where(eq(sourceIdentityPolicies.identityId, identityId));
      await ctx.db.insert(sourceIdentityPolicies).values({
        identityId,
        revision,
        trustTier: input.trustTier,
        allowedUses: allowedUsesForTier(input.trustTier),
        notes: `Feed ${input.feedUrl}`,
        active: true,
      });
    }
  }
  const auth = (request as FastifyRequest & { auth?: { user: { id: string } } }).auth;
  await ctx.db.insert(auditLogs).values({
    actorUserId: auth?.user.id,
    action: "source.create",
    resource: source?.id,
  });
  return { source: source ? publicSource(source) : undefined };
}
