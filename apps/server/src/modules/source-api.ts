import {
  alchemySourceSchema,
  binanceFuturesSourceSchema,
  coingeckoSourceSchema,
  coinmarketcapSourceSchema,
  cryptocomSourceSchema,
  defillamaSourceSchema,
  discordSourceSchema,
  edgarSourceSchema,
  feedSourceSchema,
  heliusSourceSchema,
  hyperliquidSourceSchema,
  kalshiSourceSchema,
  labeledAddressSchema,
  pageQuerySchema,
  polymarketSourceSchema,
  publisherHostPolicySchema,
  snapshotSourceSchema,
  sourceIdentityPolicySchema,
  sourcePatchSchema,
  xSourceSchema,
} from "@riddlr/api-contract";
import { encryptSecret, randomToken } from "@riddlr/crypto";
import {
  auditLogs,
  claimEvidence,
  encryptedSecrets,
  evidenceItems,
  instanceSettings,
  labeledAddresses,
  publisherHostPolicies,
  scanSourceRuns,
  sourceIdentities,
  sourceIdentityPolicies,
  sources,
} from "@riddlr/db";
import {
  assertPublicWalletAddress,
  clampPageSize,
  computeIdentityTrackRecords,
  DEFAULT_X_MONTHLY_READ_BUDGET,
  type IdentityClaimObservation,
  MAX_IDENTITY_TRACK_ROWS,
  MAX_LABELED_ADDRESSES,
  parsePageCursor,
  type TrustTier,
} from "@riddlr/domain";
import {
  clampFeedPollIntervalSeconds,
  createAlchemyAdapter,
  createAlchemyAddressWebhook,
  createBinanceFuturesAdapter,
  createCoinGeckoAdapter,
  createCoinMarketCapAdapter,
  createCryptoComAdapter,
  createDefiLlamaAdapter,
  createDiscordAdapter,
  createEdgarAdapter,
  createFeedsAdapter,
  createHeliusAdapter,
  createHeliusTransferWebhook,
  createHyperliquidAdapter,
  createKalshiAdapter,
  createPolymarketAdapter,
  createSearxngAdapter,
  createSnapshotAdapter,
  createXAdapter,
  DISCORD_BOT_PERMISSIONS,
  defaultTrustForFeedUrl,
  parseSearxngEngines,
  parseSnapshotSpaces,
  SUGGESTED_FEEDS,
} from "@riddlr/source-adapters";
import { and, count, desc, eq, inArray, lt } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../context.js";
import { monitoredAddresses, syncAddressActivityWebhooks } from "./inbound-webhooks.js";
import {
  ensureDefaultPriceTrackerHostPolicies,
  ensureOfficialSnapshotSpace,
  upsertSourceIdentity,
} from "./intelligence.js";
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
  delete config.notifySecretId;
  delete config.authHeaderSecretId;
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
  const defillama = createDefiLlamaAdapter();
  const hyperliquid = createHyperliquidAdapter();
  const binanceFutures = createBinanceFuturesAdapter();
  const polymarket = createPolymarketAdapter();
  const kalshi = createKalshiAdapter();
  const snapshot = createSnapshotAdapter();
  const edgar = createEdgarAdapter();
  const alchemy = createAlchemyAdapter();
  const helius = createHeliusAdapter();

  function adapterForHealth(adapterId: string) {
    switch (adapterId) {
      case "discord":
        return discord;
      case "x":
        return x;
      case "feeds":
        return feeds;
      case "defillama":
        return defillama;
      case "hyperliquid":
        return hyperliquid;
      case "binance-futures":
        return binanceFutures;
      case "polymarket":
        return polymarket;
      case "kalshi":
        return kalshi;
      case "snapshot":
        return snapshot;
      case "edgar":
        return edgar;
      case "alchemy":
        return alchemy;
      case "helius":
        return helius;
      default:
        return marketAdapter(adapterId) ?? searxng;
    }
  }

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
          id: defillama.id,
          family: defillama.family,
          capabilities: defillama.capabilities,
        },
        {
          id: hyperliquid.id,
          family: hyperliquid.family,
          capabilities: hyperliquid.capabilities,
        },
        {
          id: binanceFutures.id,
          family: binanceFutures.family,
          capabilities: binanceFutures.capabilities,
        },
        {
          id: polymarket.id,
          family: polymarket.family,
          capabilities: polymarket.capabilities,
        },
        {
          id: kalshi.id,
          family: kalshi.family,
          capabilities: kalshi.capabilities,
        },
        {
          id: snapshot.id,
          family: snapshot.family,
          capabilities: snapshot.capabilities,
        },
        {
          id: edgar.id,
          family: edgar.family,
          capabilities: edgar.capabilities,
        },
        {
          id: alchemy.id,
          family: alchemy.family,
          capabilities: alchemy.capabilities,
        },
        {
          id: helius.id,
          family: helius.family,
          capabilities: helius.capabilities,
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
      monthlyReadBudget: body.monthlyReadBudget ?? DEFAULT_X_MONTHLY_READ_BUDGET,
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
        monthlyReadBudget: body.monthlyReadBudget ?? DEFAULT_X_MONTHLY_READ_BUDGET,
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

  app.post("/api/v1/sources/defillama", { preHandler: authed }, async (request, reply) => {
    const body = defillamaSourceSchema.parse(request.body);
    const chainSlugs = body.chainSlugs ?? [];
    const protocolSlugs = body.protocolSlugs ?? [];
    const validated = await defillama.validate({ chainSlugs, protocolSlugs });
    if (!validated.ok) {
      return reply
        .code(400)
        .send({ error: { code: "invalid_source", message: validated.message } });
    }
    return insertUniqueSource(ctx, request, reply, {
      family: "observation",
      adapterId: "defillama",
      name: body.name,
      config: { chainSlugs, protocolSlugs },
    });
  });

  app.post("/api/v1/sources/hyperliquid", { preHandler: authed }, async (request, reply) => {
    const body = hyperliquidSourceSchema.parse(request.body);
    const validated = await hyperliquid.validate({});
    if (!validated.ok) {
      return reply
        .code(400)
        .send({ error: { code: "invalid_source", message: validated.message } });
    }
    return insertUniqueSource(ctx, request, reply, {
      family: "observation",
      adapterId: "hyperliquid",
      name: body.name,
      config: {},
    });
  });

  app.post("/api/v1/sources/binance-futures", { preHandler: authed }, async (request, reply) => {
    const body = binanceFuturesSourceSchema.parse(request.body);
    const quoteAssets = body.quoteAssets ?? [];
    const validated = await binanceFutures.validate({ quoteAssets });
    if (!validated.ok) {
      return reply
        .code(400)
        .send({ error: { code: "invalid_source", message: validated.message } });
    }
    return insertUniqueSource(ctx, request, reply, {
      family: "observation",
      adapterId: "binance-futures",
      name: body.name,
      config: quoteAssets.length > 0 ? { quoteAssets } : {},
    });
  });

  app.post("/api/v1/sources/polymarket", { preHandler: authed }, async (request, reply) => {
    const body = polymarketSourceSchema.parse(request.body);
    const marketSlugs = body.marketSlugs ?? [];
    const validated = await polymarket.validate({ marketSlugs });
    if (!validated.ok) {
      return reply
        .code(400)
        .send({ error: { code: "invalid_source", message: validated.message } });
    }
    return insertUniqueSource(ctx, request, reply, {
      family: "observation",
      adapterId: "polymarket",
      name: body.name,
      config: marketSlugs.length > 0 ? { marketSlugs } : {},
    });
  });

  app.post("/api/v1/sources/kalshi", { preHandler: authed }, async (request, reply) => {
    const body = kalshiSourceSchema.parse(request.body);
    const seriesTickers = body.seriesTickers ?? [];
    const marketTickers = body.marketTickers ?? [];
    const validated = await kalshi.validate({ seriesTickers, marketTickers });
    if (!validated.ok) {
      return reply
        .code(400)
        .send({ error: { code: "invalid_source", message: validated.message } });
    }
    return insertUniqueSource(ctx, request, reply, {
      family: "observation",
      adapterId: "kalshi",
      name: body.name,
      config: {
        ...(seriesTickers.length > 0 ? { seriesTickers } : {}),
        ...(marketTickers.length > 0 ? { marketTickers } : {}),
      },
    });
  });

  app.post("/api/v1/sources/snapshot", { preHandler: authed }, async (request, reply) => {
    const body = snapshotSourceSchema.parse(request.body);
    const spaces = parseSnapshotSpaces(body.spaces ?? []);
    const validated = await snapshot.validate({ spaces });
    if (!validated.ok) {
      return reply
        .code(400)
        .send({ error: { code: "invalid_source", message: validated.message } });
    }
    const existing = await ctx.db.select().from(sources).limit(ctx.config.RIDDLR_SCAN_SOURCE_LIMIT);
    if (existing.length >= ctx.config.RIDDLR_SCAN_SOURCE_LIMIT) {
      return reply.code(400).send({
        error: {
          code: "source_limit",
          message: `At most ${ctx.config.RIDDLR_SCAN_SOURCE_LIMIT} sources can be enabled.`,
        },
      });
    }
    if (existing.some((row) => row.adapterId === "snapshot")) {
      return reply.code(409).send({
        error: { code: "source_exists", message: "Snapshot is already configured." },
      });
    }
    const [source] = await ctx.db
      .insert(sources)
      .values({
        family: "governance",
        adapterId: "snapshot",
        enabled: true,
        name: body.name,
        config: spaces.length > 0 ? { spaces } : {},
      })
      .returning();
    if (source) {
      await attachSourceToAgents(ctx, source.id);
      for (const space of spaces) {
        await ensureOfficialSnapshotSpace(ctx, space);
      }
    }
    const auth = (request as FastifyRequest & { auth?: { user: { id: string } } }).auth;
    await ctx.db.insert(auditLogs).values({
      actorUserId: auth?.user.id,
      action: "source.create",
      resource: source?.id,
    });
    return { source: source ? publicSource(source) : undefined };
  });

  app.post("/api/v1/sources/edgar", { preHandler: authed }, async (request, reply) => {
    const body = edgarSourceSchema.parse(request.body);
    const validated = await edgar.validate({ contactEmail: body.contactEmail });
    if (!validated.ok) {
      return reply
        .code(400)
        .send({ error: { code: "invalid_source", message: validated.message } });
    }
    return insertUniqueSource(ctx, request, reply, {
      family: "filing",
      adapterId: "edgar",
      name: body.name,
      config: { contactEmail: body.contactEmail },
    });
  });

  app.post("/api/v1/sources/alchemy", { preHandler: authed }, async (request, reply) => {
    const body = alchemySourceSchema.parse(request.body);
    const existing = await ctx.db.select().from(sources).limit(ctx.config.RIDDLR_SCAN_SOURCE_LIMIT);
    if (existing.length >= ctx.config.RIDDLR_SCAN_SOURCE_LIMIT) {
      return reply.code(400).send({
        error: {
          code: "source_limit",
          message: `At most ${ctx.config.RIDDLR_SCAN_SOURCE_LIMIT} sources can be enabled.`,
        },
      });
    }
    if (existing.some((row) => row.adapterId === "alchemy")) {
      return reply.code(409).send({
        error: { code: "source_exists", message: "Alchemy is already configured." },
      });
    }
    const notify = encryptSecret({
      masterKey: ctx.masterKey,
      plaintext: body.notifyToken,
      purpose: "alchemy_notify",
      keyVersion: 1,
      aad: "alchemy_notify|1",
    });
    const [notifyRow] = await ctx.db
      .insert(encryptedSecrets)
      .values({
        purpose: "alchemy_notify",
        keyVersion: 1,
        ciphertext: notify.ciphertext,
        nonce: notify.nonce,
        tag: notify.tag,
        alg: notify.alg,
      })
      .returning();
    const [source] = await ctx.db
      .insert(sources)
      .values({
        family: "onchain",
        adapterId: "alchemy",
        enabled: true,
        name: body.name,
        config: {
          network: body.network,
          notifySecretId: notifyRow?.id,
          webhookUrl: "",
        },
      })
      .returning();
    if (!source) {
      return reply
        .code(500)
        .send({ error: { code: "internal", message: "Could not create source." } });
    }
    await attachSourceToAgents(ctx, source.id);
    const webhookUrl = `${ctx.config.RIDDLR_PUBLIC_URL}/hooks/alchemy/${source.id}`;
    const addresses = await monitoredAddresses(ctx, "ethereum");
    let lastHealthOk: boolean | undefined;
    let lastHealthMessage = "Alchemy source saved. Webhook registration pending addresses.";
    let secretId: string | undefined;
    if (addresses.length > 0 && ctx.config.RIDDLR_ENV !== "test") {
      const created = await createAlchemyAddressWebhook({
        notifyToken: body.notifyToken,
        webhookUrl,
        network: body.network,
        addresses,
      });
      if (created.webhookId && created.signingKey) {
        const signing = encryptSecret({
          masterKey: ctx.masterKey,
          plaintext: created.signingKey,
          purpose: "alchemy_signing",
          keyVersion: 1,
          aad: "alchemy_signing|1",
        });
        const [signingRow] = await ctx.db
          .insert(encryptedSecrets)
          .values({
            purpose: "alchemy_signing",
            keyVersion: 1,
            ciphertext: signing.ciphertext,
            nonce: signing.nonce,
            tag: signing.tag,
            alg: signing.alg,
          })
          .returning();
        secretId = signingRow?.id;
        lastHealthOk = true;
        lastHealthMessage = "Alchemy webhook registered.";
        await ctx.db
          .update(sources)
          .set({
            secretId,
            lastHealthOk,
            lastHealthMessage,
            lastHealthAt: new Date(),
            config: {
              network: body.network,
              notifySecretId: notifyRow?.id,
              webhookId: created.webhookId,
              webhookUrl,
              syncedAddresses: addresses,
            },
          })
          .where(eq(sources.id, source.id));
      } else {
        lastHealthOk = false;
        lastHealthMessage = created.errors[0]?.message ?? "Alchemy create-webhook failed.";
        await ctx.db
          .update(sources)
          .set({
            lastHealthOk,
            lastHealthMessage,
            lastHealthAt: new Date(),
            config: {
              network: body.network,
              notifySecretId: notifyRow?.id,
              webhookUrl,
            },
          })
          .where(eq(sources.id, source.id));
      }
    } else {
      await ctx.db
        .update(sources)
        .set({
          config: {
            network: body.network,
            notifySecretId: notifyRow?.id,
            webhookUrl,
          },
        })
        .where(eq(sources.id, source.id));
    }
    const auth = (request as FastifyRequest & { auth?: { user: { id: string } } }).auth;
    await ctx.db.insert(auditLogs).values({
      actorUserId: auth?.user.id,
      action: "source.create",
      resource: source.id,
    });
    const [fresh] = await ctx.db.select().from(sources).where(eq(sources.id, source.id)).limit(1);
    return { source: fresh ? publicSource(fresh) : publicSource(source) };
  });

  app.post("/api/v1/sources/helius", { preHandler: authed }, async (request, reply) => {
    const body = heliusSourceSchema.parse(request.body);
    const existing = await ctx.db.select().from(sources).limit(ctx.config.RIDDLR_SCAN_SOURCE_LIMIT);
    if (existing.length >= ctx.config.RIDDLR_SCAN_SOURCE_LIMIT) {
      return reply.code(400).send({
        error: {
          code: "source_limit",
          message: `At most ${ctx.config.RIDDLR_SCAN_SOURCE_LIMIT} sources can be enabled.`,
        },
      });
    }
    if (existing.some((row) => row.adapterId === "helius")) {
      return reply.code(409).send({
        error: { code: "source_exists", message: "Helius is already configured." },
      });
    }
    const apiKey = encryptSecret({
      masterKey: ctx.masterKey,
      plaintext: body.apiKey,
      purpose: "helius",
      keyVersion: 1,
      aad: "helius|1",
    });
    const [apiRow] = await ctx.db
      .insert(encryptedSecrets)
      .values({
        purpose: "helius",
        keyVersion: 1,
        ciphertext: apiKey.ciphertext,
        nonce: apiKey.nonce,
        tag: apiKey.tag,
        alg: apiKey.alg,
      })
      .returning();
    const authHeader = randomToken(24);
    const auth = encryptSecret({
      masterKey: ctx.masterKey,
      plaintext: authHeader,
      purpose: "helius_auth",
      keyVersion: 1,
      aad: "helius_auth|1",
    });
    const [authRow] = await ctx.db
      .insert(encryptedSecrets)
      .values({
        purpose: "helius_auth",
        keyVersion: 1,
        ciphertext: auth.ciphertext,
        nonce: auth.nonce,
        tag: auth.tag,
        alg: auth.alg,
      })
      .returning();
    const [source] = await ctx.db
      .insert(sources)
      .values({
        family: "onchain",
        adapterId: "helius",
        enabled: true,
        name: body.name,
        secretId: apiRow?.id,
        config: { authHeaderSecretId: authRow?.id },
      })
      .returning();
    if (!source) {
      return reply
        .code(500)
        .send({ error: { code: "internal", message: "Could not create source." } });
    }
    await attachSourceToAgents(ctx, source.id);
    const webhookUrl = `${ctx.config.RIDDLR_PUBLIC_URL}/hooks/helius/${source.id}`;
    const addresses = await monitoredAddresses(ctx, "solana");
    if (addresses.length > 0 && ctx.config.RIDDLR_ENV !== "test") {
      const created = await createHeliusTransferWebhook({
        apiKey: body.apiKey,
        webhookUrl,
        authHeader,
        addresses,
      });
      await ctx.db
        .update(sources)
        .set({
          lastHealthOk: Boolean(created.webhookId),
          lastHealthMessage: created.webhookId
            ? "Helius webhook registered."
            : (created.errors[0]?.message ?? "Helius create-webhook failed."),
          lastHealthAt: new Date(),
          config: {
            authHeaderSecretId: authRow?.id,
            webhookUrl,
            ...(created.webhookId ? { webhookId: created.webhookId } : {}),
          },
        })
        .where(eq(sources.id, source.id));
    } else {
      await ctx.db
        .update(sources)
        .set({
          config: { authHeaderSecretId: authRow?.id, webhookUrl },
        })
        .where(eq(sources.id, source.id));
    }
    const actor = (request as FastifyRequest & { auth?: { user: { id: string } } }).auth;
    await ctx.db.insert(auditLogs).values({
      actorUserId: actor?.user.id,
      action: "source.create",
      resource: source.id,
    });
    const [fresh] = await ctx.db.select().from(sources).where(eq(sources.id, source.id)).limit(1);
    return { source: fresh ? publicSource(fresh) : publicSource(source) };
  });

  app.get("/api/v1/labeled-addresses", { preHandler: authed }, async () => {
    const rows = await ctx.db.select().from(labeledAddresses).limit(MAX_LABELED_ADDRESSES);
    return { addresses: rows };
  });

  app.post("/api/v1/labeled-addresses", { preHandler: authed }, async (request, reply) => {
    const body = labeledAddressSchema.parse(request.body);
    let address: string;
    try {
      address = assertPublicWalletAddress(body.chain, body.address);
    } catch (error) {
      return reply.code(400).send({
        error: {
          code: "invalid_address",
          message: error instanceof Error ? error.message : "Invalid address",
        },
      });
    }
    const [{ value: existing } = { value: 0 }] = await ctx.db
      .select({ value: count() })
      .from(labeledAddresses);
    if (Number(existing) >= MAX_LABELED_ADDRESSES) {
      return reply.code(400).send({
        error: {
          code: "labeled_address_limit",
          message: `At most ${MAX_LABELED_ADDRESSES} labeled addresses.`,
        },
      });
    }
    const [row] = await ctx.db
      .insert(labeledAddresses)
      .values({
        chain: body.chain,
        address,
        label: body.label,
        role: body.role,
        shipped: false,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      return reply.code(409).send({
        error: { code: "address_exists", message: "That labeled address already exists." },
      });
    }
    if (ctx.config.RIDDLR_ENV !== "test") {
      await syncAddressActivityWebhooks(ctx);
    }
    return { address: row };
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
    const adapter = adapterForHealth(row.adapterId);
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
    const latestPolicy = new Map<string, (typeof policies)[number]>();
    for (const policy of policies) {
      if (!policy.active) {
        continue;
      }
      const current = latestPolicy.get(policy.identityId);
      if (!current || policy.revision > current.revision) {
        latestPolicy.set(policy.identityId, policy);
      }
    }
    const identityIds = identities.map((item) => item.id);
    const claimRows =
      identityIds.length === 0
        ? []
        : await ctx.db
            .select({
              identityId: claimEvidence.sourceIdentityId,
              claimId: claimEvidence.claimId,
              publishedAt: evidenceItems.publishedAt,
            })
            .from(claimEvidence)
            .innerJoin(evidenceItems, eq(claimEvidence.evidenceId, evidenceItems.id))
            .where(inArray(claimEvidence.sourceIdentityId, identityIds))
            .limit(MAX_IDENTITY_TRACK_ROWS);
    const observations: IdentityClaimObservation[] = [];
    for (const row of claimRows) {
      if (!row.identityId || !row.publishedAt) {
        continue;
      }
      observations.push({
        identityId: row.identityId,
        claimId: row.claimId,
        publishedAt: row.publishedAt,
        trustTier: (latestPolicy.get(row.identityId)?.trustTier ?? "unknown") as TrustTier,
      });
    }
    const tracks = computeIdentityTrackRecords(observations);
    const byId = new Map(identities.map((item) => [item.id, item]));
    return {
      identities: identities.map((identity) => ({
        ...identity,
        parentExternalId: identity.parentId ? byId.get(identity.parentId)?.externalId : undefined,
        policy: latestPolicy.get(identity.id),
        trackRecord: tracks.get(identity.id) ?? {
          claims: 0,
          laterCorroborated: 0,
          medianLeadHours: null,
        },
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

async function insertUniqueSource(
  ctx: AppContext,
  request: FastifyRequest,
  reply: FastifyReply,
  input: {
    family: string;
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
        message: `${input.name} is already configured.`,
      },
    });
  }
  const [source] = await ctx.db
    .insert(sources)
    .values({
      family: input.family,
      adapterId: input.adapterId,
      enabled: true,
      name: input.name,
      config: input.config,
    })
    .returning();
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
