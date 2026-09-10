import { discordSourceSchema, sourcePatchSchema, xSourceSchema } from "@riddlr/api-contract";
import { encryptSecret } from "@riddlr/crypto";
import {
  auditLogs,
  encryptedSecrets,
  evidenceItems,
  instanceSettings,
  scanSourceRuns,
  sources,
} from "@riddlr/db";
import {
  createCoinGeckoAdapter,
  createDiscordAdapter,
  createSearxngAdapter,
  createXAdapter,
  DISCORD_BOT_PERMISSIONS,
} from "@riddlr/source-adapters";
import { count, desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../context.js";

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
  const coingecko = createCoinGeckoAdapter();

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
          inviteUrl: `https://discord.com/oauth2/authorize?scope=bot&permissions=${DISCORD_BOT_PERMISSIONS}`,
        },
        {
          id: x.id,
          family: x.family,
          capabilities: x.capabilities,
        },
        {
          id: coingecko.id,
          family: coingecko.family,
          capabilities: coingecko.capabilities,
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

  app.patch("/api/v1/sources/:id", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = sourcePatchSchema.parse(request.body);
    const [row] = await ctx.db.select().from(sources).where(eq(sources.id, id)).limit(1);
    if (!row) {
      return reply.code(404).send({ error: { code: "not_found", message: "Source not found" } });
    }
    const nextConfig = { ...row.config, ...(body.config ?? {}) };
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
          : row.adapterId === "coingecko"
            ? coingecko
            : searxng;
    const health = await adapter.healthCheck(row.config);
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
    const [row] = await ctx.db.select().from(sources).where(eq(sources.id, id)).limit(1);
    if (!row) {
      return reply.code(404).send({ error: { code: "not_found", message: "Source not found" } });
    }
    const items = await ctx.db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.sourceId, id))
      .orderBy(desc(evidenceItems.fetchedAt))
      .limit(20);
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
      .limit(20);
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
    if (row.adapterId !== "discord" && row.adapterId !== "x" && row.adapterId !== "coingecko") {
      return reply.code(409).send({
        error: {
          code: "immutable_source",
          message: "Only Discord and X sources can be removed from this page.",
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
  const auth = (request as FastifyRequest & { auth?: { user: { id: string } } }).auth;
  await ctx.db.insert(auditLogs).values({
    actorUserId: auth?.user.id,
    action: "source.create",
    resource: source?.id,
  });
  return { source: source ? publicSource(source) : undefined };
}
