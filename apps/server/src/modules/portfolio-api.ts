import {
  notificationPolicySchema,
  portfolioCreateSchema,
  portfolioHoldingSchema,
  portfolioWalletSchema,
  telegramSetupSchema,
  whatsappSetupSchema,
} from "@riddlr/api-contract";
import { encryptSecret, hashToken } from "@riddlr/crypto";
import {
  assets,
  auditLogs,
  encryptedSecrets,
  eventAssets,
  events,
  instanceSettings,
  portfolioHoldings,
  portfolioSnapshots,
  portfolios,
  portfolioWallets,
  providerConfigs,
} from "@riddlr/db";
import {
  assertCanonicalAssetId,
  assertPublicWalletAddress,
  InvalidWalletAddressError,
  MAX_PORTFOLIO_HOLDINGS,
  MAX_PORTFOLIO_WALLETS,
  MAX_PORTFOLIOS,
  PrivateMaterialError,
  takeBounded,
} from "@riddlr/domain";
import { count, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../context.js";
import { loadEnabledMarketQuotes } from "./market-sources.js";

export function registerPortfolioRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  authed: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
) {
  app.get("/api/v1/portfolios", { preHandler: authed }, async () => {
    const rows = await ctx.db.select().from(portfolios).limit(MAX_PORTFOLIOS);
    const ids = rows.map((row) => row.id);
    const wallets =
      ids.length > 0
        ? await ctx.db
            .select()
            .from(portfolioWallets)
            .where(inArray(portfolioWallets.portfolioId, ids))
            .limit(ids.length * MAX_PORTFOLIO_WALLETS)
        : [];
    const holdings =
      ids.length > 0
        ? await ctx.db
            .select()
            .from(portfolioHoldings)
            .where(inArray(portfolioHoldings.portfolioId, ids))
            .limit(ids.length * MAX_PORTFOLIO_HOLDINGS)
        : [];
    const market = await loadEnabledMarketQuotes(
      ctx,
      holdings.map((item) => item.canonicalId),
    );
    return {
      portfolios: rows.map((row) => ({
        ...row,
        wallets: wallets.filter((item) => item.portfolioId === row.id),
        holdings: holdings.filter((item) => item.portfolioId === row.id),
      })),
      market,
      onchain: {
        implemented: false,
        message:
          "On-chain scanning is not implemented. Holdings are operator-declared. Addresses are public identifiers only.",
      },
    };
  });

  app.post("/api/v1/portfolios", { preHandler: authed }, async (request, reply) => {
    const body = portfolioCreateSchema.parse(request.body);
    const [{ value: existing } = { value: 0 }] = await ctx.db
      .select({ value: count() })
      .from(portfolios);
    if (Number(existing) >= MAX_PORTFOLIOS) {
      return reply.code(400).send({
        error: { code: "portfolio_limit", message: `At most ${MAX_PORTFOLIOS} portfolios.` },
      });
    }
    const [row] = await ctx.db.insert(portfolios).values({ name: body.name }).returning();
    const auth = (request as FastifyRequest & { auth?: { user: { id: string } } }).auth;
    await ctx.db.insert(auditLogs).values({
      actorUserId: auth?.user.id,
      action: "portfolio.create",
      resource: row?.id,
    });
    return { portfolio: row };
  });

  app.post("/api/v1/portfolios/:id/wallets", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = portfolioWalletSchema.parse(request.body);
    const [portfolio] = await ctx.db
      .select()
      .from(portfolios)
      .where(eq(portfolios.id, id))
      .limit(1);
    if (!portfolio) {
      return reply.code(404).send({ error: { code: "not_found", message: "Portfolio not found" } });
    }
    let address: string;
    try {
      address = assertPublicWalletAddress(body.chain, body.address);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid address";
      const code =
        error instanceof PrivateMaterialError
          ? "private_material"
          : error instanceof InvalidWalletAddressError
            ? "invalid_address"
            : "invalid_address";
      return reply.code(400).send({ error: { code, message } });
    }
    const [{ value: existing } = { value: 0 }] = await ctx.db
      .select({ value: count() })
      .from(portfolioWallets)
      .where(eq(portfolioWallets.portfolioId, id));
    if (Number(existing) >= MAX_PORTFOLIO_WALLETS) {
      return reply.code(400).send({
        error: {
          code: "wallet_limit",
          message: `At most ${MAX_PORTFOLIO_WALLETS} wallets per portfolio.`,
        },
      });
    }
    const [wallet] = await ctx.db
      .insert(portfolioWallets)
      .values({ portfolioId: id, chain: body.chain, address })
      .onConflictDoNothing()
      .returning();
    return { wallet };
  });

  app.post("/api/v1/portfolios/:id/holdings", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = portfolioHoldingSchema.parse(request.body);
    const [portfolio] = await ctx.db
      .select()
      .from(portfolios)
      .where(eq(portfolios.id, id))
      .limit(1);
    if (!portfolio) {
      return reply.code(404).send({ error: { code: "not_found", message: "Portfolio not found" } });
    }
    try {
      assertCanonicalAssetId(body.canonicalId);
    } catch (error) {
      return reply.code(400).send({
        error: {
          code: "invalid_canonical_id",
          message: error instanceof Error ? error.message : "Invalid canonical id",
        },
      });
    }
    const [{ value: existing } = { value: 0 }] = await ctx.db
      .select({ value: count() })
      .from(portfolioHoldings)
      .where(eq(portfolioHoldings.portfolioId, id));
    if (Number(existing) >= MAX_PORTFOLIO_HOLDINGS) {
      return reply.code(400).send({
        error: {
          code: "holding_limit",
          message: `At most ${MAX_PORTFOLIO_HOLDINGS} holdings per portfolio.`,
        },
      });
    }
    const [holding] = await ctx.db
      .insert(portfolioHoldings)
      .values({
        portfolioId: id,
        assetClass: body.assetClass ?? "cryptocurrency",
        canonicalId: body.canonicalId,
        quantity: body.quantity,
        symbol: body.symbol,
        name: body.name,
      })
      .onConflictDoNothing()
      .returning();
    return { holding };
  });

  app.get("/api/v1/portfolios/:id", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [portfolio] = await ctx.db
      .select()
      .from(portfolios)
      .where(eq(portfolios.id, id))
      .limit(1);
    if (!portfolio) {
      return reply.code(404).send({ error: { code: "not_found", message: "Portfolio not found" } });
    }
    const wallets = await ctx.db
      .select()
      .from(portfolioWallets)
      .where(eq(portfolioWallets.portfolioId, id))
      .limit(MAX_PORTFOLIO_WALLETS);
    const holdings = await ctx.db
      .select()
      .from(portfolioHoldings)
      .where(eq(portfolioHoldings.portfolioId, id))
      .limit(MAX_PORTFOLIO_HOLDINGS);
    const canonicalIds = takeBounded(
      holdings.map((item) => item.canonicalId),
      MAX_PORTFOLIO_HOLDINGS,
    );
    const assetRows =
      canonicalIds.length > 0
        ? await ctx.db
            .select()
            .from(assets)
            .where(inArray(assets.canonicalId, canonicalIds))
            .limit(50)
        : [];
    const assetIds = assetRows.map((item) => item.id);
    const links =
      assetIds.length > 0
        ? await ctx.db
            .select()
            .from(eventAssets)
            .where(inArray(eventAssets.assetId, assetIds))
            .limit(50)
        : [];
    const eventIds = [...new Set(links.map((item) => item.eventId))];
    const affectedEvents =
      eventIds.length > 0
        ? await ctx.db
            .select()
            .from(events)
            .where(inArray(events.id, takeBounded(eventIds, 20)))
            .orderBy(desc(events.windowStart))
            .limit(20)
        : [];
    const market = await loadEnabledMarketQuotes(ctx, canonicalIds);
    return {
      portfolio,
      wallets,
      holdings,
      affectedEvents,
      market,
      onchainImplemented: false,
    };
  });

  app.delete("/api/v1/portfolios/:id", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [portfolio] = await ctx.db
      .select()
      .from(portfolios)
      .where(eq(portfolios.id, id))
      .limit(1);
    if (!portfolio) {
      return reply.code(404).send({ error: { code: "not_found", message: "Portfolio not found" } });
    }
    await ctx.db.delete(portfolios).where(eq(portfolios.id, id));
    return { ok: true };
  });

  app.delete(
    "/api/v1/portfolios/:id/holdings/:holdingId",
    { preHandler: authed },
    async (request, reply) => {
      const { id, holdingId } = request.params as { id: string; holdingId: string };
      const [holding] = await ctx.db
        .select()
        .from(portfolioHoldings)
        .where(eq(portfolioHoldings.id, holdingId))
        .limit(1);
      if (!holding || holding.portfolioId !== id) {
        return reply.code(404).send({ error: { code: "not_found", message: "Holding not found" } });
      }
      await ctx.db.delete(portfolioHoldings).where(eq(portfolioHoldings.id, holdingId));
      await ctx.db.insert(portfolioSnapshots).values({
        portfolioId: id,
        holdings: { removedHoldingId: holdingId, canonicalId: holding.canonicalId },
        note: "holding_removed",
      });
      return { ok: true };
    },
  );

  app.delete(
    "/api/v1/portfolios/:id/wallets/:walletId",
    { preHandler: authed },
    async (request, reply) => {
      const { id, walletId } = request.params as { id: string; walletId: string };
      const [wallet] = await ctx.db
        .select()
        .from(portfolioWallets)
        .where(eq(portfolioWallets.id, walletId))
        .limit(1);
      if (!wallet || wallet.portfolioId !== id) {
        return reply.code(404).send({ error: { code: "not_found", message: "Wallet not found" } });
      }
      await ctx.db.delete(portfolioWallets).where(eq(portfolioWallets.id, walletId));
      return { ok: true };
    },
  );

  app.get("/api/v1/portfolios/:id/snapshots", { preHandler: authed }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [portfolio] = await ctx.db
      .select()
      .from(portfolios)
      .where(eq(portfolios.id, id))
      .limit(1);
    if (!portfolio) {
      return reply.code(404).send({ error: { code: "not_found", message: "Portfolio not found" } });
    }
    const snapshots = await ctx.db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.portfolioId, id))
      .orderBy(desc(portfolioSnapshots.recordedAt))
      .limit(50);
    return { snapshots };
  });
}

export function registerNotificationSettingsRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  authed: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
) {
  app.post("/api/v1/settings/notifications", { preHandler: authed }, async (request) => {
    const body = notificationPolicySchema.parse(request.body);
    await ctx.db
      .update(instanceSettings)
      .set({
        notificationPolicy: {
          minRisk: body.minRisk,
          cooldownMinutes: body.cooldownMinutes,
          quietHours: body.quietHours,
        },
      })
      .where(eq(instanceSettings.id, 1));
    return { policy: body };
  });

  app.post("/api/v1/settings/whatsapp", { preHandler: authed }, async (request) => {
    const body = whatsappSetupSchema.parse(request.body);
    const settingsRows = await ctx.db.select().from(instanceSettings).limit(1);
    const keyVersion = settingsRows[0]?.keyVersion ?? 1;
    const encrypted = encryptSecret({
      masterKey: ctx.masterKey,
      plaintext: body.accessToken,
      purpose: "whatsapp",
      keyVersion,
      aad: `whatsapp|${keyVersion}`,
    });
    const appSecretEncrypted = encryptSecret({
      masterKey: ctx.masterKey,
      plaintext: body.appSecret,
      purpose: "whatsapp_app",
      keyVersion,
      aad: `whatsapp_app|${keyVersion}`,
    });
    const [secret] = await ctx.db
      .insert(encryptedSecrets)
      .values({
        purpose: "whatsapp",
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        tag: encrypted.tag,
        alg: encrypted.alg,
        keyVersion,
      })
      .returning();
    const [appSecret] = await ctx.db
      .insert(encryptedSecrets)
      .values({
        purpose: "whatsapp_app",
        ciphertext: appSecretEncrypted.ciphertext,
        nonce: appSecretEncrypted.nonce,
        tag: appSecretEncrypted.tag,
        alg: appSecretEncrypted.alg,
        keyVersion,
      })
      .returning();
    await ctx.db.delete(providerConfigs).where(eq(providerConfigs.kind, "whatsapp"));
    await ctx.db.insert(providerConfigs).values({
      kind: "whatsapp",
      secretId: secret?.id,
      settings: {
        phoneNumberId: body.phoneNumberId,
        to: body.to,
        templateName: body.templateName,
        templateLanguage: body.templateLanguage,
        verifyTokenHash: hashToken(body.verifyToken),
        graphVersion: body.graphVersion,
        appSecretId: appSecret?.id,
        configured: true,
      },
    });
    const auth = (request as FastifyRequest & { auth?: { user: { id: string } } }).auth;
    await ctx.db.insert(auditLogs).values({
      actorUserId: auth?.user.id,
      action: "settings.whatsapp",
      resource: "whatsapp",
    });
    return { ok: true };
  });

  app.delete("/api/v1/settings/whatsapp", { preHandler: authed }, async () => {
    await ctx.db.delete(providerConfigs).where(eq(providerConfigs.kind, "whatsapp"));
    return { ok: true };
  });

  app.post("/api/v1/settings/telegram", { preHandler: authed }, async (request) => {
    const body = telegramSetupSchema.parse(request.body);
    const settingsRows = await ctx.db.select().from(instanceSettings).limit(1);
    const keyVersion = settingsRows[0]?.keyVersion ?? 1;
    const encrypted = encryptSecret({
      masterKey: ctx.masterKey,
      plaintext: body.botToken,
      purpose: "telegram",
      keyVersion,
      aad: `telegram|${keyVersion}`,
    });
    const [secret] = await ctx.db
      .insert(encryptedSecrets)
      .values({
        purpose: "telegram",
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        tag: encrypted.tag,
        alg: encrypted.alg,
        keyVersion,
      })
      .returning();
    await ctx.db.delete(providerConfigs).where(eq(providerConfigs.kind, "telegram"));
    await ctx.db.insert(providerConfigs).values({
      kind: "telegram",
      secretId: secret?.id,
      settings: { chatId: body.chatId, configured: true },
    });
    return { ok: true };
  });

  app.delete("/api/v1/settings/telegram", { preHandler: authed }, async () => {
    await ctx.db.delete(providerConfigs).where(eq(providerConfigs.kind, "telegram"));
    return { ok: true };
  });
}
