import {
  AGENT_SCHEDULES,
  CATALYST_KINDS,
  MARKET_DOMAIN_IDS,
  MAX_DAILY_TOKEN_BUDGET,
  MIN_DAILY_TOKEN_BUDGET,
  SETUP_STEPS,
} from "@riddlr/domain";
import { z } from "zod";

export const dailyTokenBudgetSchema = z
  .number()
  .int()
  .min(MIN_DAILY_TOKEN_BUDGET)
  .max(MAX_DAILY_TOKEN_BUDGET)
  .nullable();

export const catalystKindSchema = z.enum(CATALYST_KINDS);

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const setupAdminSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(64).optional(),
  password: z.string().min(12),
});

export const totpVerifySchema = z.object({
  token: z.string().min(6).max(8),
});

export const setupUnlockSchema = z.object({
  code: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

export const twoFactorSchema = z.object({
  token: z.string().min(6),
});

export const recoveryRotateSchema = z.object({
  token: z.string().min(6),
});

export const keyRotateSchema = z.object({
  currentPassword: z.string().min(1),
  token: z.string().min(6).optional(),
});

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  before: z.string().optional(),
});

export const llmSetupSchema = z.object({
  provider: z.enum(["openai_compatible", "anthropic_compatible"]),
  baseUrl: z.string().url(),
  model: z.string().min(1),
  apiKey: z.string().min(1),
});

export const completeSetupSchema = z.object({
  marketDomainIds: z.array(z.enum(MARKET_DOMAIN_IDS)).min(1),
  searxngUrl: z.string().url().optional(),
  telegramBotToken: z.string().optional(),
  telegramChatId: z.string().optional(),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().email(),
});

export const passwordResetCompleteSchema = z.object({
  token: z.string().min(16),
  newPassword: z.string().min(12),
});

export const setupStatusSchema = z.object({
  initialized: z.boolean(),
  completed: z.boolean(),
  currentStep: z.enum([...SETUP_STEPS, "complete"]),
  stepCount: z.literal(4),
  setupAccess: z.enum(["local", "code"]),
  canContinue: z.boolean(),
  setupCodeExpired: z.boolean(),
});

export const watchlistItemSchema = z.object({
  canonicalId: z.string().min(3).max(160),
  assetClass: z.enum(["cryptocurrency", "meme_coin", "stablecoin"]).optional(),
  symbol: z.string().max(24).optional(),
  name: z.string().max(80).optional(),
});

export const assetSearchQuerySchema = z.object({
  q: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

export const observationLatestQuerySchema = z.object({
  q: z.string().max(4000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const observationPinSchema = z.object({
  subjectCanonicalId: z.string().min(3).max(160),
  metric: z
    .enum(["spot_price", "quoted_volume", "quoted_market_cap", "price_change_24h"])
    .optional(),
  provider: z.string().min(3).max(80).optional(),
});

export const notificationPolicySchema = z.object({
  minRisk: z.enum(["low", "moderate", "high", "critical"]).default("moderate"),
  cooldownMinutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .default(30),
  quietHours: z
    .object({
      startHour: z.number().int().min(0).max(23),
      endHour: z.number().int().min(0).max(23),
    })
    .optional(),
  earlyWarnings: z.boolean().optional(),
  shadowAssessments: z.boolean().optional(),
});

export const agentUpdateSchema = z.object({
  name: z.string().min(3).max(80).optional(),
  description: z.string().max(280).optional(),
  schedule: z.enum(AGENT_SCHEDULES).optional(),
  customIntervalMs: z
    .number()
    .int()
    .min(5 * 60 * 1000)
    .max(24 * 60 * 60 * 1000)
    .optional(),
  skillIds: z.array(z.string().uuid()).max(8).optional(),
  enabled: z.boolean().optional(),
  tokenBudget: dailyTokenBudgetSchema.optional(),
  objectives: z.array(z.string().min(3).max(80)).max(16).optional(),
  sourceIds: z.array(z.string().uuid()).max(32).optional(),
  portfolioIds: z.array(z.string().uuid()).max(16).optional(),
  notificationPolicy: notificationPolicySchema.optional(),
  watchlistItems: z.array(watchlistItemSchema).max(50).optional(),
});

export const skillCreateSchema = z.object({
  slug: z.string().min(3).max(64),
  description: z.string().max(280).optional(),
  markdownBody: z.string().min(8).max(32_768),
});

export const skillUpdateSchema = z.object({
  description: z.string().max(280).optional(),
  markdownBody: z.string().min(8).max(32_768).optional(),
});

export const watchlistReplaceSchema = z.object({
  items: z.array(watchlistItemSchema).max(50),
});

export const coingeckoSourceSchema = z.object({
  name: z.string().min(3).max(80).default("CoinGecko"),
  apiKey: z.string().min(8).max(200).optional(),
  assetIds: z.array(z.string().min(2).max(80)).max(16).optional(),
});

export const coinmarketcapSourceSchema = z.object({
  name: z.string().min(3).max(80).default("CoinMarketCap"),
  apiKey: z.string().min(8).max(200),
  assetIds: z.array(z.string().min(2).max(80)).max(16).optional(),
});

export const cryptocomSourceSchema = z.object({
  name: z.string().min(3).max(80).default("Crypto.com Exchange"),
  assetIds: z.array(z.string().min(2).max(80)).max(16).optional(),
});

export const discordSourceSchema = z.object({
  name: z.string().min(3).max(80).default("Discord"),
  botToken: z.string().min(8).max(200),
  guildId: z
    .string()
    .regex(/^\d{17,20}$/)
    .optional(),
  channelIds: z
    .array(z.string().regex(/^\d{17,20}$/))
    .min(1)
    .max(8),
  excludeChannelIds: z
    .array(z.string().regex(/^\d{17,20}$/))
    .max(8)
    .optional(),
  keywords: z.array(z.string().min(2).max(48)).max(16).optional(),
  lookbackHours: z.number().int().min(1).max(24).optional(),
});

export const xSourceSchema = z
  .object({
    name: z.string().min(3).max(80).default("X"),
    bearerToken: z.string().min(8).max(512),
    authors: z
      .array(z.string().regex(/^@?[A-Za-z0-9_]{1,15}$/))
      .max(8)
      .optional(),
    mentions: z
      .array(z.string().regex(/^@?[A-Za-z0-9_]{1,15}$/))
      .max(8)
      .optional(),
    keywords: z.array(z.string().min(2).max(48)).max(16).optional(),
    lookbackHours: z.number().int().min(1).max(168).optional(),
  })
  .refine(
    (value) =>
      (value.authors?.length ?? 0) + (value.mentions?.length ?? 0) + (value.keywords?.length ?? 0) >
      0,
    { message: "Provide authors, mentions, or keywords." },
  );

export const whatsappSetupSchema = z.object({
  accessToken: z.string().min(8).max(512),
  appSecret: z.string().min(8).max(512),
  phoneNumberId: z.string().regex(/^\d{6,20}$/),
  to: z.string().regex(/^\+?\d{8,15}$/),
  templateName: z.string().min(1).max(512),
  templateLanguage: z.string().min(2).max(16).default("en_US"),
  verifyToken: z.string().min(8).max(128),
  graphVersion: z
    .string()
    .regex(/^v\d{2}$/)
    .default("v22"),
});

export const telegramSetupSchema = z.object({
  botToken: z.string().min(8).max(200),
  chatId: z.string().min(1).max(64),
});

export const emailSetupSchema = z.object({
  apiKey: z.string().min(8).max(200),
  from: z
    .string()
    .min(3)
    .max(200)
    .refine((value) => value.includes("@"), { message: "From must include an email address." }),
});

export const sourceIdentityPolicySchema = z.object({
  trustTier: z.enum(["unknown", "community", "known_analyst", "official_firsthand", "blocked"]),
  allowedUses: z.array(z.enum(["discovery", "analysis", "early_warning", "confirmation"])).min(1),
  notes: z.string().max(280).optional(),
});

export const publisherHostPolicySchema = z.object({
  hostname: z.string().min(1).max(253),
  trustTier: z.enum(["unknown", "community", "known_analyst", "official_firsthand", "blocked"]),
  blocked: z.boolean().optional(),
  notes: z.string().max(280).optional(),
});

export const sourcePatchSchema = z.object({
  name: z.string().min(3).max(80).optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  token: z.string().min(8).max(512).optional(),
  agentIds: z.array(z.string().uuid()).max(16).optional(),
});

export const agentCreateSchema = z.object({
  name: z.string().min(3).max(80),
  description: z.string().max(280).optional(),
  marketDomainIds: z.array(z.enum(MARKET_DOMAIN_IDS)).min(1),
  schedule: z.enum(AGENT_SCHEDULES).default("1h"),
  customIntervalMs: z
    .number()
    .int()
    .min(5 * 60 * 1000)
    .max(24 * 60 * 60 * 1000)
    .optional(),
  skillIds: z.array(z.string().uuid()).max(8).optional(),
  enabled: z.boolean().optional(),
  tokenBudget: dailyTokenBudgetSchema.optional(),
  objectives: z.array(z.string().min(3).max(80)).max(16).optional(),
  sourceIds: z.array(z.string().uuid()).max(32).optional(),
  portfolioIds: z.array(z.string().uuid()).max(16).optional(),
  notificationPolicy: notificationPolicySchema.optional(),
  watchlistItems: z.array(watchlistItemSchema).max(50).optional(),
});

export const portfolioCreateSchema = z.object({
  name: z.string().min(3).max(80),
});

export const portfolioWalletSchema = z.object({
  chain: z.enum(["ethereum", "bitcoin", "solana", "other"]),
  address: z.string().min(8).max(128),
});

export const portfolioHoldingSchema = z.object({
  canonicalId: z.string().min(3).max(160),
  assetClass: z.enum(["cryptocurrency", "meme_coin", "stablecoin"]).optional(),
  quantity: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .max(40)
    .optional(),
  symbol: z.string().max(24).optional(),
  name: z.string().max(80).optional(),
});

export type LlmSetupInput = z.infer<typeof llmSetupSchema>;
export type CompleteSetupInput = z.infer<typeof completeSetupSchema>;
export type AgentCreateInput = z.infer<typeof agentCreateSchema>;
export type AgentUpdateInput = z.infer<typeof agentUpdateSchema>;
