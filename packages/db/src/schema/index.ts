import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    username: text("username"),
    passwordHash: text("password_hash").notNull(),
    isAdmin: boolean("is_admin").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    uniqueIndex("users_username_idx").on(table.username),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    twoFactorSatisfied: boolean("two_factor_satisfied").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("sessions_token_hash_idx").on(table.tokenHash)],
);

export const authFactors = pgTable("auth_factors", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  kind: text("kind").notNull(),
  secretCiphertext: text("secret_ciphertext").notNull(),
  secretNonce: text("secret_nonce").notNull(),
  secretTag: text("secret_tag").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  keyVersion: integer("key_version").notNull().default(1),
});

export const recoveryCodes = pgTable("recovery_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  codeHash: text("code_hash").notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export const instanceSettings = pgTable("instance_settings", {
  id: integer("id").primaryKey().default(1),
  setupStep: text("setup_step").notNull().default("admin"),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  keyVersion: integer("key_version").notNull().default(1),
  notificationPolicy: jsonb("notification_policy")
    .$type<{
      minRisk: "low" | "moderate" | "high" | "critical";
      cooldownMinutes: number;
      quietHours?: { startHour: number; endHour: number };
    }>()
    .notNull()
    .default({ minRisk: "moderate", cooldownMinutes: 30 }),
});

export const marketDomains = pgTable("market_domains", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull(),
  comingSoon: boolean("coming_soon").notNull(),
  documentationReference: text("documentation_reference").notNull(),
});

export const assetClasses = pgTable("asset_classes", {
  id: text("id").primaryKey(),
  marketDomainId: text("market_domain_id")
    .notNull()
    .references(() => marketDomains.id),
  name: text("name").notNull(),
});

export const encryptedSecrets = pgTable("encrypted_secrets", {
  id: uuid("id").primaryKey().defaultRandom(),
  purpose: text("purpose").notNull(),
  ciphertext: text("ciphertext").notNull(),
  nonce: text("nonce").notNull(),
  tag: text("tag").notNull(),
  alg: text("alg").notNull(),
  keyVersion: integer("key_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const providerConfigs = pgTable("provider_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  secretId: uuid("secret_id").references(() => encryptedSecrets.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  objectives: jsonb("objectives").$type<string[]>().notNull().default([]),
  schedule: text("schedule").notNull().default("1h"),
  customIntervalMs: integer("custom_interval_ms"),
  tokenBudget: integer("token_budget").notNull().default(8000),
  notificationPolicy: jsonb("notification_policy")
    .$type<{
      minRisk: "low" | "moderate" | "high" | "critical";
      cooldownMinutes: number;
      quietHours?: { startHour: number; endHour: number };
    }>()
    .notNull()
    .default({ minRisk: "moderate", cooldownMinutes: 30 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentMarketDomains = pgTable(
  "agent_market_domains",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    marketDomainId: text("market_domain_id")
      .notNull()
      .references(() => marketDomains.id),
  },
  (table) => [primaryKey({ columns: [table.agentId, table.marketDomainId] })],
);

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    version: text("version").notNull(),
    origin: text("origin").notNull(),
    markdownBody: text("markdown_body").notNull(),
  },
  (table) => [uniqueIndex("skills_slug_idx").on(table.slug)],
);

export const agentSkills = pgTable(
  "agent_skills",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id),
  },
  (table) => [primaryKey({ columns: [table.agentId, table.skillId] })],
);

export const watchlists = pgTable(
  "watchlists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("watchlists_agent_idx").on(table.agentId)],
);

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    watchlistId: uuid("watchlist_id")
      .notNull()
      .references(() => watchlists.id, { onDelete: "cascade" }),
    assetClass: text("asset_class").notNull(),
    canonicalId: text("canonical_id").notNull(),
    symbol: text("symbol"),
    name: text("name"),
  },
  (table) => [
    uniqueIndex("watchlist_items_canonical_idx").on(table.watchlistId, table.canonicalId),
  ],
);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetClass: text("asset_class").notNull(),
    canonicalId: text("canonical_id").notNull(),
    symbol: text("symbol"),
    name: text("name"),
  },
  (table) => [uniqueIndex("assets_class_canonical_idx").on(table.assetClass, table.canonicalId)],
);

export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  family: text("family").notNull(),
  adapterId: text("adapter_id").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  name: text("name").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  lastHealthOk: boolean("last_health_ok"),
  lastHealthMessage: text("last_health_message"),
  lastHealthAt: timestamp("last_health_at", { withTimezone: true }),
  secretId: uuid("secret_id").references(() => encryptedSecrets.id),
});

export const agentSources = pgTable(
  "agent_sources",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.agentId, table.sourceId] })],
);

export const scans = pgTable(
  "scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    status: text("status").notNull(),
    partial: boolean("partial").notNull().default(false),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    retryAttempt: integer("retry_attempt").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("scans_idempotency_idx").on(table.idempotencyKey)],
);

export const scanSourceRuns = pgTable("scan_source_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  scanId: uuid("scan_id")
    .notNull()
    .references(() => scans.id),
  sourceId: uuid("source_id")
    .notNull()
    .references(() => sources.id),
  status: text("status").notNull(),
  errorClass: text("error_class"),
  errorMessage: text("error_message"),
  evidenceCount: integer("evidence_count").notNull().default(0),
});

export const evidenceItems = pgTable(
  "evidence_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id),
    fingerprint: text("fingerprint").notNull(),
    contentHash: text("content_hash").notNull(),
    canonicalUrl: text("canonical_url"),
    title: text("title"),
    bodyText: text("body_text"),
    author: text("author"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    adapterPayload: jsonb("adapter_payload").$type<Record<string, unknown>>(),
    sourceFamily: text("source_family"),
    adapterId: text("adapter_id"),
    externalId: text("external_id"),
    language: text("language"),
    fetchRequestId: uuid("fetch_request_id"),
  },
  (table) => [uniqueIndex("evidence_fingerprint_idx").on(table.fingerprint)],
);

export const sourceFetchRequests = pgTable("source_fetch_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  scanId: uuid("scan_id")
    .notNull()
    .references(() => scans.id),
  sourceId: uuid("source_id")
    .notNull()
    .references(() => sources.id),
  adapterId: text("adapter_id").notNull(),
  requestHash: text("request_hash").notNull(),
  requestUrl: text("request_url"),
  providerRequestId: text("provider_request_id"),
  paginationCursor: text("pagination_cursor"),
  status: text("status").notNull(),
  errorClass: text("error_class"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  evidenceCount: integer("evidence_count").notNull().default(0),
});

export const evidenceOccurrences = pgTable(
  "evidence_occurrences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidenceItems.id),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id),
    fetchRequestId: uuid("fetch_request_id").references(() => sourceFetchRequests.id),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("evidence_occurrences_scan_evidence_idx").on(table.scanId, table.evidenceId),
  ],
);

export const evidenceRelations = pgTable(
  "evidence_relations",
  {
    fromId: uuid("from_id")
      .notNull()
      .references(() => evidenceItems.id),
    toId: uuid("to_id")
      .notNull()
      .references(() => evidenceItems.id),
    kind: text("kind").notNull(),
  },
  (table) => [primaryKey({ columns: [table.fromId, table.toId, table.kind] })],
);

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id),
  scanId: uuid("scan_id")
    .notNull()
    .references(() => scans.id),
  title: text("title").notNull(),
  status: text("status").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  independentCount: integer("independent_count").notNull().default(0),
  derivedCount: integer("derived_count").notNull().default(0),
  clusterFingerprint: text("cluster_fingerprint"),
  materialityReason: text("materiality_reason"),
});

export const eventEvidence = pgTable(
  "event_evidence",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidenceItems.id),
    role: text("role").notNull(),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.evidenceId] })],
);

export const eventAssets = pgTable(
  "event_assets",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.assetId] })],
);

export const observations = pgTable("observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  kind: text("kind").notNull(),
  assetCanonicalId: text("asset_canonical_id"),
  value: jsonb("value").$type<number | string | boolean | null>().notNull(),
  unit: text("unit"),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  sourceId: text("source_id").notNull(),
});

export const portfolios = pgTable("portfolios", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const portfolioWallets = pgTable(
  "portfolio_wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id, { onDelete: "cascade" }),
    chain: text("chain").notNull(),
    address: text("address").notNull(),
  },
  (table) => [
    uniqueIndex("portfolio_wallets_addr_idx").on(table.portfolioId, table.chain, table.address),
  ],
);

export const portfolioHoldings = pgTable(
  "portfolio_holdings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id, { onDelete: "cascade" }),
    assetClass: text("asset_class").notNull(),
    canonicalId: text("canonical_id").notNull(),
    quantity: text("quantity"),
    symbol: text("symbol"),
    name: text("name"),
  },
  (table) => [
    uniqueIndex("portfolio_holdings_canonical_idx").on(table.portfolioId, table.canonicalId),
  ],
);

export const agentPortfolios = pgTable(
  "agent_portfolios",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.agentId, table.portfolioId] })],
);

export const portfolioSnapshots = pgTable("portfolio_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  portfolioId: uuid("portfolio_id")
    .notNull()
    .references(() => portfolios.id, { onDelete: "cascade" }),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  holdings: jsonb("holdings").$type<Record<string, unknown>>().notNull(),
  note: text("note"),
});

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    canonicalId: text("canonical_id").notNull(),
    displayName: text("display_name").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [uniqueIndex("entities_kind_canonical_idx").on(table.kind, table.canonicalId)],
);

export const entityAliases = pgTable(
  "entity_aliases",
  {
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
  },
  (table) => [primaryKey({ columns: [table.entityId, table.alias] })],
);

export const instruments = pgTable("instruments", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id),
  venue: text("venue"),
  pair: text("pair"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
});

export const eventEntities = pgTable(
  "event_entities",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.entityId] })],
);

export const whatsappSessions = pgTable(
  "whatsapp_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    toE164: text("to_e164").notNull(),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }).notNull(),
    windowUntil: timestamp("window_until", { withTimezone: true }).notNull(),
    lastMessageId: text("last_message_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("whatsapp_sessions_to_idx").on(table.toE164)],
);

export const whatsappWebhookMessages = pgTable(
  "whatsapp_webhook_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: text("message_id").notNull(),
    fromE164: text("from_e164").notNull(),
    inboundAt: timestamp("inbound_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("whatsapp_webhook_messages_id_idx").on(table.messageId)],
);

export const analyses = pgTable("analyses", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  model: text("model").notNull(),
  schemaVersion: text("schema_version").notNull(),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  latencyMs: integer("latency_ms"),
  rawOutput: jsonb("raw_output"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const signals = pgTable(
  "signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    headline: text("headline").notNull(),
    whyItMatters: text("why_it_matters").notNull(),
    proof: jsonb("proof").$type<{ evidenceIds: string[]; summary: string }>().notNull(),
    action: text("action").notNull(),
    risk: text("risk").notNull(),
    confidence: text("confidence").notNull(),
    marketContext: text("market_context"),
    contradictoryEvidence: text("contradictory_evidence"),
    invalidationConditions: text("invalidation_conditions"),
    schemaVersion: text("schema_version").notNull().default("1"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("signals_event_agent_schema_idx").on(
      table.eventId,
      table.agentId,
      table.schemaVersion,
    ),
  ],
);

export const aiUsageEvents = pgTable("ai_usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").references(() => agents.id),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  completionTotal: integer("completion_total"),
  estimatedCostUsd: text("estimated_cost_usd"),
  cacheHit: boolean("cache_hit").notNull().default(false),
  providerRequestId: text("provider_request_id"),
  reservationTokens: integer("reservation_tokens"),
  status: text("status").notNull().default("recorded"),
  latencyMs: integer("latency_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const analysisCache = pgTable(
  "analysis_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    schemaVersion: text("schema_version").notNull(),
    promptHash: text("prompt_hash").notNull(),
    skillHash: text("skill_hash").notNull(),
    contextHash: text("context_hash").notNull(),
    rawOutput: jsonb("raw_output").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("analysis_cache_identity_idx").on(
      table.provider,
      table.model,
      table.schemaVersion,
      table.promptHash,
      table.skillHash,
      table.contextHash,
    ),
  ],
);

export const tokenBudgetReservations = pgTable("token_budget_reservations", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id),
  dayUtc: text("day_utc").notNull(),
  reservedTokens: integer("reserved_tokens").notNull(),
  consumedTokens: integer("consumed_tokens").notNull().default(0),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const llmPriceTable = pgTable(
  "llm_price_table",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptUsdPerMillion: text("prompt_usd_per_million").notNull(),
    completionUsdPerMillion: text("completion_usd_per_million").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("llm_price_table_model_idx").on(table.provider, table.model)],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id),
    channel: text("channel").notNull(),
    destination: text("destination"),
    status: text("status").notNull(),
    attempt: integer("attempt").notNull().default(1),
    errorClass: text("error_class"),
    providerMessageId: text("provider_message_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("notification_idempotency_idx").on(table.idempotencyKey)],
);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: uuid("actor_user_id"),
  action: text("action").notNull(),
  resource: text("resource"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
