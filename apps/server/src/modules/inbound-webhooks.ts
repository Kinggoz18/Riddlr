import { decryptSecretWithKeys, verifyAlchemySignature, verifyExactHeader } from "@riddlr/crypto";
import {
  agentSources,
  agents,
  auditLogs,
  claimEvidence,
  claims,
  encryptedSecrets,
  evidenceItems,
  evidenceOccurrences,
  inboundWebhookReceipts,
  labeledAddresses,
  observationSeries,
  portfolioWallets,
  scans,
  sources,
} from "@riddlr/db";
import {
  excerptHash,
  fingerprintClaim,
  INBOUND_WEBHOOK_MAX_AGE_MS,
  MAX_ADDRESS_ACTIVITY_ITEMS,
  MAX_WEBHOOK_ADDRESSES,
  normalizeEvidence,
  takeBounded,
} from "@riddlr/domain";
import { labeledAddressLookup } from "@riddlr/domain-crypto";
import {
  addressActivityEvidence,
  classifyTransfer,
  parseAlchemyAddressActivity,
  parseHeliusEnhancedPayload,
  shouldPersistTransfer,
  subjectCanonicalIdForTransfer,
  updateAlchemyWebhookAddresses,
  updateHeliusWebhookAddresses,
} from "@riddlr/source-adapters";
import { and, asc, desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../context.js";
import { clusterScanEvents } from "./pipeline.js";

const SOURCE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decryptPurpose(ctx: AppContext, secret: typeof encryptedSecrets.$inferSelect): string {
  return decryptSecretWithKeys({
    keys: ctx.masterKeys,
    secret: {
      ciphertext: secret.ciphertext,
      nonce: secret.nonce,
      tag: secret.tag,
      alg: "aes-256-gcm",
      keyVersion: secret.keyVersion,
    },
    purpose: secret.purpose,
    aad: `${secret.purpose}|${secret.keyVersion}`,
  });
}

async function decryptSecretById(ctx: AppContext, id?: string): Promise<string | undefined> {
  if (!id) {
    return undefined;
  }
  const [secret] = await ctx.db
    .select()
    .from(encryptedSecrets)
    .where(eq(encryptedSecrets.id, id))
    .limit(1);
  return secret ? decryptPurpose(ctx, secret) : undefined;
}

async function latestSpotPrices(ctx: AppContext): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  for (const subject of ["coingecko:ethereum", "coingecko:solana"]) {
    const [row] = await ctx.db
      .select()
      .from(observationSeries)
      .where(
        and(
          eq(observationSeries.metric, "spot_price"),
          eq(observationSeries.subjectCanonicalId, subject),
        ),
      )
      .orderBy(desc(observationSeries.observedAt))
      .limit(1);
    if (row) {
      prices[subject] = row.value;
    }
  }
  return prices;
}

export async function monitoredAddresses(
  ctx: AppContext,
  chain: "ethereum" | "solana",
): Promise<string[]> {
  const wallets = await ctx.db.select().from(portfolioWallets).limit(MAX_WEBHOOK_ADDRESSES);
  const labels = await ctx.db.select().from(labeledAddresses).limit(MAX_WEBHOOK_ADDRESSES);
  const out: string[] = [];
  for (const row of wallets) {
    if (row.chain === chain) {
      out.push(row.address);
    }
  }
  for (const row of labels) {
    if (row.chain === chain) {
      out.push(row.address);
    }
  }
  return takeBounded([...new Set(out)], MAX_WEBHOOK_ADDRESSES);
}

async function selectInboundAgent(ctx: AppContext, sourceId: string) {
  const [attached] = await ctx.db
    .select({ agent: agents })
    .from(agents)
    .innerJoin(agentSources, eq(agentSources.agentId, agents.id))
    .where(and(eq(agentSources.sourceId, sourceId), eq(agents.enabled, true)))
    .orderBy(asc(agents.createdAt))
    .limit(1);
  if (attached?.agent) {
    return attached.agent;
  }
  const [fallback] = await ctx.db
    .select()
    .from(agents)
    .where(eq(agents.enabled, true))
    .orderBy(asc(agents.createdAt))
    .limit(1);
  return fallback;
}

export async function processInboundReceipt(
  ctx: AppContext,
  receiptId: string,
  offset = 0,
): Promise<void> {
  const [receipt] = await ctx.db
    .select()
    .from(inboundWebhookReceipts)
    .where(eq(inboundWebhookReceipts.id, receiptId))
    .limit(1);
  if (!receipt) {
    return;
  }
  const fetchedAt = receipt.receivedAt;
  const labelsRows = await ctx.db.select().from(labeledAddresses).limit(MAX_WEBHOOK_ADDRESSES);
  const wallets = await ctx.db.select().from(portfolioWallets).limit(MAX_WEBHOOK_ADDRESSES);
  const labels = labeledAddressLookup(labelsRows);
  const portfolio = new Set(wallets.map((row) => `${row.chain}:${row.address.toLowerCase()}`));
  const prices = await latestSpotPrices(ctx);
  const transfers =
    receipt.adapterId === "alchemy"
      ? (parseAlchemyAddressActivity(receipt.payload).envelope?.transfers ?? [])
      : parseHeliusEnhancedPayload(receipt.payload).envelopes.flatMap((item) => item.transfers);
  const slice = takeBounded(transfers.slice(offset), MAX_ADDRESS_ACTIVITY_ITEMS);
  const evidenceIds: string[] = [];
  let scanRow: typeof scans.$inferSelect | undefined;
  for (const transfer of slice) {
    const classification = classifyTransfer(transfer, { labels, portfolio, prices });
    if (!shouldPersistTransfer(classification)) {
      continue;
    }
    const raw = addressActivityEvidence({
      transfer,
      classification,
      adapterId: receipt.adapterId,
      fetchedAt,
      subjectCanonicalId: subjectCanonicalIdForTransfer(transfer),
    });
    const agent = await selectInboundAgent(ctx, receipt.sourceId);
    if (!agent) {
      continue;
    }
    const normalized = normalizeEvidence(raw);
    const day = fetchedAt.toISOString().slice(0, 10);
    const [insertedScan] = await ctx.db
      .insert(scans)
      .values({
        agentId: agent.id,
        status: "observe",
        windowStart: fetchedAt,
        idempotencyKey: `observe:${agent.id}:${day}`,
      })
      .onConflictDoNothing()
      .returning();
    scanRow =
      insertedScan ??
      (
        await ctx.db
          .select()
          .from(scans)
          .where(eq(scans.idempotencyKey, `observe:${agent.id}:${day}`))
          .limit(1)
      )[0];
    if (!scanRow) {
      continue;
    }
    const [evidence] = await ctx.db
      .insert(evidenceItems)
      .values({
        sourceId: receipt.sourceId,
        scanId: scanRow.id,
        fingerprint: normalized.fingerprint,
        contentHash: normalized.contentHash,
        canonicalUrl: normalized.canonicalUrl,
        title: normalized.title,
        bodyText: normalized.bodyText,
        publishedAt: normalized.publishedAt,
        fetchedAt: normalized.fetchedAt,
        adapterPayload: raw.adapterPayload,
        sourceFamily: "onchain",
        adapterId: receipt.adapterId,
        externalId: raw.externalId,
        contentCompleteness: "native_complete",
        originKey: normalized.originKey,
      })
      .onConflictDoNothing()
      .returning();
    const evidenceRow =
      evidence ??
      (
        await ctx.db
          .select()
          .from(evidenceItems)
          .where(eq(evidenceItems.fingerprint, normalized.fingerprint))
          .limit(1)
      )[0];
    if (!evidenceRow) {
      continue;
    }
    evidenceIds.push(evidenceRow.id);
    await ctx.db
      .insert(evidenceOccurrences)
      .values({
        evidenceId: evidenceRow.id,
        scanId: scanRow.id,
        sourceId: receipt.sourceId,
        observedAt: fetchedAt,
      })
      .onConflictDoNothing();
    if (!classification.aboveLargeThreshold) {
      continue;
    }
    const subjectCanonicalId = subjectCanonicalIdForTransfer(transfer);
    const objectText =
      `${classification.fromLabel} → ${classification.toLabel} ${classification.reasonCodes.join(" ")}`.trim();
    const claim = {
      marketDomainId: "crypto" as const,
      kind: "crypto:large_transfer",
      subjectCanonicalId,
      predicate: "large_transfer",
      objectText,
      value: classification.usdNotional ?? null,
      unit: classification.usdNotional != null ? "usd" : undefined,
      polarity: "asserted" as const,
      modality: "asserted" as const,
      fingerprint: fingerprintClaim({
        marketDomainId: "crypto",
        kind: "crypto:large_transfer",
        subjectCanonicalId,
        polarity: "asserted",
        objectText,
        value: classification.usdNotional,
        timeBucket: day,
      }),
      title: normalized.title ?? "Large transfer",
    };
    const [savedClaim] = await ctx.db
      .insert(claims)
      .values({
        marketDomainId: claim.marketDomainId,
        kind: claim.kind,
        subjectCanonicalId: claim.subjectCanonicalId,
        predicate: claim.predicate,
        objectText: claim.objectText,
        value: claim.value,
        unit: claim.unit,
        polarity: claim.polarity,
        modality: claim.modality,
        fingerprint: claim.fingerprint,
        title: claim.title,
        policyVersion: "address-activity-v1",
        extractionVersion: "inbound-address-activity.v1",
        effectiveStart: fetchedAt,
      })
      .onConflictDoNothing()
      .returning();
    const persistedClaim =
      savedClaim ??
      (
        await ctx.db.select().from(claims).where(eq(claims.fingerprint, claim.fingerprint)).limit(1)
      )[0];
    if (persistedClaim) {
      const excerpt = objectText.slice(0, 180);
      await ctx.db
        .insert(claimEvidence)
        .values({
          claimId: persistedClaim.id,
          evidenceId: evidenceRow.id,
          stance: "supports",
          excerpt,
          excerptHash: excerptHash(excerpt),
        })
        .onConflictDoNothing();
    }
  }
  await ctx.db
    .update(inboundWebhookReceipts)
    .set({ processedOffset: offset + slice.length })
    .where(eq(inboundWebhookReceipts.id, receiptId));
  if (scanRow && evidenceIds.length > 0) {
    await clusterScanEvents(ctx, scanRow, evidenceIds);
  }
  const remaining = transfers.length - (offset + slice.length);
  if (remaining > 0) {
    const next = offset + slice.length;
    if (ctx.observeQueue && ctx.config.RIDDLR_ENV !== "test") {
      await ctx.observeQueue.add(
        "inbound",
        {
          kind: "inbound",
          receiptId,
          offset: next,
          idempotencyKey: `inbound:${receiptId}:${next}`,
        },
        { jobId: `inbound:${receiptId}:${next}` },
      );
    } else if (ctx.config.RIDDLR_ENV === "test") {
      await processInboundReceipt(ctx, receiptId, next);
    }
  }
}

async function enqueueReceipt(ctx: AppContext, receiptId: string) {
  if (ctx.observeQueue && ctx.config.RIDDLR_ENV !== "test") {
    await ctx.observeQueue.add(
      "inbound",
      { kind: "inbound", receiptId, offset: 0, idempotencyKey: `inbound:${receiptId}:0` },
      { jobId: `inbound:${receiptId}:0` },
    );
  }
}

async function insertReceipt(input: {
  ctx: AppContext;
  sourceId: string;
  adapterId: string;
  webhookId: string;
  eventId: string;
  createdAt?: Date;
  payload: unknown;
}): Promise<{ id?: string; duplicate: boolean }> {
  const [row] = await input.ctx.db
    .insert(inboundWebhookReceipts)
    .values({
      sourceId: input.sourceId,
      adapterId: input.adapterId,
      webhookId: input.webhookId,
      eventId: input.eventId,
      eventCreatedAt: input.createdAt,
      payload: input.payload,
    })
    .onConflictDoNothing()
    .returning();
  return { id: row?.id, duplicate: !row };
}

function staleCreatedAt(createdAt: Date | undefined, now: Date): boolean {
  if (!createdAt || !Number.isFinite(createdAt.getTime())) {
    return false;
  }
  return now.getTime() - createdAt.getTime() > INBOUND_WEBHOOK_MAX_AGE_MS;
}

export function registerInboundWebhookRoutes(app: FastifyInstance, ctx: AppContext) {
  const hookLimit = {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: "1 minute",
        keyGenerator: (request: FastifyRequest) =>
          `hook:${(request.params as { sourceId?: string }).sourceId ?? request.ip}`,
      },
    },
  };

  app.post("/hooks/alchemy/:sourceId", hookLimit, async (request, reply) => {
    return handleAlchemy(ctx, request, reply);
  });
  app.post("/hooks/helius/:sourceId", hookLimit, async (request, reply) => {
    return handleHelius(ctx, request, reply);
  });
}

async function handleAlchemy(ctx: AppContext, request: FastifyRequest, reply: FastifyReply) {
  const { sourceId } = request.params as { sourceId: string };
  if (!SOURCE_ID_RE.test(sourceId)) {
    return reply.code(404).send({ error: { code: "not_found", message: "Source not found." } });
  }
  const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
  if (!rawBody || rawBody.byteLength === 0) {
    return reply.code(400).send({ error: { code: "invalid_request", message: "Empty body." } });
  }
  const [source] = await ctx.db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
  if (!source || source.adapterId !== "alchemy" || !source.enabled) {
    return reply.code(404).send({ error: { code: "not_found", message: "Source not found." } });
  }
  const signingKey = await decryptSecretById(ctx, source.secretId ?? undefined);
  const header = request.headers["x-alchemy-signature"];
  if (
    !signingKey ||
    !verifyAlchemySignature({
      signingKey,
      rawBody,
      header: typeof header === "string" ? header : undefined,
    })
  ) {
    await ctx.db.insert(auditLogs).values({
      action: "webhook.signature_mismatch",
      resource: sourceId,
    });
    return reply.code(401).send({ error: { code: "unauthorized", message: "Invalid signature." } });
  }
  const parsed = parseAlchemyAddressActivity(request.body);
  if (!parsed.envelope) {
    return reply
      .code(400)
      .send({ error: { code: "malformed", message: parsed.errors[0]?.message } });
  }
  const now = new Date();
  if (staleCreatedAt(parsed.envelope.createdAt, now)) {
    return { ok: true, ignored: "stale" };
  }
  const inserted = await insertReceipt({
    ctx,
    sourceId,
    adapterId: "alchemy",
    webhookId: parsed.envelope.webhookId,
    eventId: parsed.envelope.eventId,
    createdAt: parsed.envelope.createdAt,
    payload: request.body,
  });
  if (inserted.id) {
    await enqueueReceipt(ctx, inserted.id);
  }
  return { ok: true };
}

async function handleHelius(ctx: AppContext, request: FastifyRequest, reply: FastifyReply) {
  const { sourceId } = request.params as { sourceId: string };
  if (!SOURCE_ID_RE.test(sourceId)) {
    return reply.code(404).send({ error: { code: "not_found", message: "Source not found." } });
  }
  const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
  if (!rawBody || rawBody.byteLength === 0) {
    return reply.code(400).send({ error: { code: "invalid_request", message: "Empty body." } });
  }
  const [source] = await ctx.db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
  if (!source || source.adapterId !== "helius" || !source.enabled) {
    return reply.code(404).send({ error: { code: "not_found", message: "Source not found." } });
  }
  const authHeaderId =
    typeof source.config.authHeaderSecretId === "string"
      ? source.config.authHeaderSecretId
      : undefined;
  const expected = await decryptSecretById(ctx, authHeaderId);
  const header = request.headers.authorization;
  if (
    !expected ||
    !verifyExactHeader({ expected, header: typeof header === "string" ? header : undefined })
  ) {
    await ctx.db.insert(auditLogs).values({
      action: "webhook.signature_mismatch",
      resource: sourceId,
    });
    return reply.code(401).send({ error: { code: "unauthorized", message: "Invalid signature." } });
  }
  const parsed = parseHeliusEnhancedPayload(request.body);
  if (parsed.envelopes.length === 0) {
    if (parsed.errors.length > 0) {
      return reply
        .code(400)
        .send({ error: { code: "malformed", message: parsed.errors[0]?.message } });
    }
    return { ok: true };
  }
  const now = new Date();
  const first = parsed.envelopes[0];
  if (staleCreatedAt(first?.createdAt, now)) {
    return { ok: true, ignored: "stale" };
  }
  const webhookId =
    typeof source.config.webhookId === "string" ? source.config.webhookId : "helius";
  const eventId = first?.eventId ?? `helius:${now.toISOString()}`;
  const inserted = await insertReceipt({
    ctx,
    sourceId,
    adapterId: "helius",
    webhookId,
    eventId,
    createdAt: first?.createdAt,
    payload: request.body,
  });
  if (inserted.id) {
    await enqueueReceipt(ctx, inserted.id);
  }
  return { ok: true };
}

export async function syncAddressActivityWebhooks(ctx: AppContext): Promise<void> {
  const eth = await monitoredAddresses(ctx, "ethereum");
  const sol = await monitoredAddresses(ctx, "solana");
  const rows = await ctx.db.select().from(sources).limit(ctx.config.RIDDLR_SCAN_SOURCE_LIMIT);
  for (const row of rows) {
    if (!row.enabled) {
      continue;
    }
    if (row.adapterId === "alchemy") {
      const webhookId = typeof row.config.webhookId === "string" ? row.config.webhookId : "";
      const notifyId =
        typeof row.config.notifySecretId === "string" ? row.config.notifySecretId : undefined;
      const token = await decryptSecretById(ctx, notifyId);
      if (!webhookId || !token) {
        continue;
      }
      const previous = Array.isArray(row.config.syncedAddresses)
        ? row.config.syncedAddresses.filter((item): item is string => typeof item === "string")
        : [];
      const add = eth.filter((item) => !previous.includes(item));
      const remove = previous.filter((item) => !eth.includes(item));
      if (add.length === 0 && remove.length === 0) {
        continue;
      }
      const result = await updateAlchemyWebhookAddresses({
        notifyToken: token,
        webhookId,
        add,
        remove,
      });
      if (result.errors.length === 0) {
        await ctx.db
          .update(sources)
          .set({ config: { ...row.config, syncedAddresses: eth } })
          .where(eq(sources.id, row.id));
      }
    }
    if (row.adapterId === "helius") {
      const webhookId = typeof row.config.webhookId === "string" ? row.config.webhookId : "";
      const token = await decryptSecretById(ctx, row.secretId ?? undefined);
      const authHeaderId =
        typeof row.config.authHeaderSecretId === "string"
          ? row.config.authHeaderSecretId
          : undefined;
      const authHeader = await decryptSecretById(ctx, authHeaderId);
      if (!webhookId || !token || !authHeader) {
        continue;
      }
      const webhookUrl = `${ctx.config.RIDDLR_PUBLIC_URL}/hooks/helius/${row.id}`;
      await updateHeliusWebhookAddresses({
        apiKey: token,
        webhookId,
        webhookUrl,
        authHeader,
        addresses: sol,
      });
    }
  }
}
