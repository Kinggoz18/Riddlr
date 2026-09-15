import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateMasterKey, randomToken } from "@riddlr/crypto";
import {
  DEFAULT_DAILY_TOKEN_BUDGET,
  MAX_DAILY_TOKEN_BUDGET,
  MIN_DAILY_TOKEN_BUDGET,
} from "@riddlr/domain";
import { z } from "zod";

const envSchema = z.object({
  RIDDLR_ENV: z.enum(["development", "test", "production"]).default("development"),
  RIDDLR_HTTP_HOST: z.string().default("127.0.0.1"),
  RIDDLR_HTTP_PORT: z.coerce.number().default(3001),
  RIDDLR_PUBLIC_URL: z.string().url().default("http://localhost:8080"),
  RIDDLR_SETUP_ACCESS: z.enum(["loopback", "public"]).default("loopback"),
  RIDDLR_DATABASE_URL: z.string().min(1),
  RIDDLR_REDIS_URL: z.string().min(1),
  RIDDLR_COOKIE_SECRET: z.string().optional().default(""),
  RIDDLR_ENCRYPTION_MASTER_KEY: z.string().optional().default(""),
  RIDDLR_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  RIDDLR_LOG_FORMAT: z.enum(["json", "pretty"]).default("json"),
  RIDDLR_SEARXNG_URL: z.string().url().default("http://127.0.0.1:8080"),
  RIDDLR_SMTP_URL: z.string().optional(),
  RIDDLR_RESEND_API_KEY: z.string().optional(),
  RIDDLR_EMAIL_FROM: z.string().default("Riddlr <noreply@localhost>"),
  RIDDLR_SECRETS_DIR: z.string().default(".secrets"),
  RIDDLR_GENERATE_DEV_SECRETS: z.enum(["true", "false"]).optional().default("false"),
  RIDDLR_LOCAL_COMPOSE: z.enum(["true", "false"]).optional().default("false"),
  RIDDLR_DISCORD_WEBHOOK_ORIGIN: z.string().optional().default(""),
  RIDDLR_E2E_SEED_OBSERVATIONS: z.enum(["true", "false"]).optional().default("false"),
  RIDDLR_PROCESS_ROLE: z.enum(["api", "worker"]).optional().default("api"),
  RIDDLR_METRICS_PUBLIC: z.enum(["true", "false"]).optional().default("false"),
  RIDDLR_ENCRYPTION_MASTER_KEY_PREVIOUS: z.string().optional().default(""),
  RIDDLR_SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  RIDDLR_SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  RIDDLR_MAX_SESSIONS: z.coerce.number().int().min(1).max(32).default(8),
  RIDDLR_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(50),
  RIDDLR_SCAN_EVIDENCE_LIMIT: z.coerce.number().int().min(1).max(200).default(50),
  RIDDLR_ANALYSIS_EVIDENCE_LIMIT: z.coerce.number().int().min(1).max(50).default(20),
  RIDDLR_SCAN_SOURCE_LIMIT: z.coerce.number().int().min(1).max(32).default(16),
  RIDDLR_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  RIDDLR_ENRICH_PER_SCAN: z.coerce.number().int().min(1).max(32).default(12),
  RIDDLR_ENRICH_PER_HOST: z.coerce.number().int().min(1).max(8).default(3),
  RIDDLR_ENRICH_MAX_BYTES: z.coerce.number().int().min(20_000).max(2_000_000).default(500_000),
  RIDDLR_ENRICH_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
  RIDDLR_ENRICH_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
  RIDDLR_UNDERSTAND_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
  RIDDLR_EARLY_WARNING: z.enum(["true", "false"]).optional().default("false"),
  RIDDLR_SHADOW_ASSESSMENTS: z.enum(["true", "false"]).optional().default("false"),
  RIDDLR_SCHEDULER_ENABLED: z.enum(["true", "false"]).optional().default("true"),
  RIDDLR_SCHEDULER_AGENT_LIMIT: z.coerce.number().int().min(1).max(50).default(16),
  RIDDLR_MAX_AGENTS: z.coerce.number().int().min(1).max(32).default(16),
  RIDDLR_DEFAULT_TOKEN_BUDGET: z.coerce
    .number()
    .int()
    .min(MIN_DAILY_TOKEN_BUDGET)
    .max(MAX_DAILY_TOKEN_BUDGET)
    .default(DEFAULT_DAILY_TOKEN_BUDGET),
  RIDDLR_REGISTRY_TOP_N: z.coerce.number().int().min(1).max(2000).default(1000),
  RIDDLR_REGISTRY_SEED_INTERVAL_HOURS: z.coerce.number().int().min(6).max(168).default(24),
  RIDDLR_OBSERVE_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
  RIDDLR_OBSERVE_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(100),
  RIDDLR_OBSERVE_MAX_SUBJECTS: z.coerce.number().int().min(1).max(4000).default(1000),
  RIDDLR_OBSERVE_RETENTION_DAYS: z.coerce.number().int().min(14).max(365).default(90),
  RIDDLR_OBSERVE_PRICE_INTERVAL_SECONDS: z.coerce.number().int().min(60).max(300).default(60),
});

export type AppConfig = z.infer<typeof envSchema> & {
  cookieSecret: string;
  encryptionMasterKey: string;
  previousMasterKey?: string;
};

function persistGeneratedSecrets(
  dir: string,
  secrets: { cookieSecret: string; masterKey: string },
) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "local-secrets.json");
  writeFileSync(path, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  return path;
}

function loadGeneratedSecrets(dir: string): { cookieSecret?: string; masterKey?: string } {
  try {
    return JSON.parse(readFileSync(join(dir, "local-secrets.json"), "utf8")) as {
      cookieSecret?: string;
      masterKey?: string;
    };
  } catch {
    return {};
  }
}

export function parseEnv(raw: NodeJS.Dict<string> = process.env): AppConfig {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  const env = parsed.data;
  let cookieSecret = env.RIDDLR_COOKIE_SECRET;
  let masterKey = env.RIDDLR_ENCRYPTION_MASTER_KEY;
  const allowGenerate =
    env.RIDDLR_ENV !== "test" &&
    (env.RIDDLR_ENV === "development" || env.RIDDLR_LOCAL_COMPOSE === "true");

  if ((!cookieSecret || !masterKey) && allowGenerate) {
    const stored = loadGeneratedSecrets(env.RIDDLR_SECRETS_DIR);
    cookieSecret = cookieSecret || stored.cookieSecret || randomToken(32);
    masterKey = masterKey || stored.masterKey || generateMasterKey();
    persistGeneratedSecrets(env.RIDDLR_SECRETS_DIR, { cookieSecret, masterKey });
  }

  if (!cookieSecret || !masterKey) {
    throw new Error("RIDDLR_COOKIE_SECRET and RIDDLR_ENCRYPTION_MASTER_KEY are required.");
  }

  if (env.RIDDLR_DISCORD_WEBHOOK_ORIGIN) {
    if (env.RIDDLR_LOCAL_COMPOSE !== "true") {
      throw new Error("RIDDLR_DISCORD_WEBHOOK_ORIGIN requires RIDDLR_LOCAL_COMPOSE=true.");
    }
    let origin: URL;
    try {
      origin = new URL(env.RIDDLR_DISCORD_WEBHOOK_ORIGIN);
    } catch {
      throw new Error("RIDDLR_DISCORD_WEBHOOK_ORIGIN must be a URL.");
    }
    if (
      origin.protocol !== "http:" ||
      origin.hostname !== "discord-webhook-mock" ||
      (origin.port !== "" && origin.port !== "8080")
    ) {
      throw new Error("RIDDLR_DISCORD_WEBHOOK_ORIGIN must be http://discord-webhook-mock:8080");
    }
  }

  return {
    ...env,
    cookieSecret,
    encryptionMasterKey: masterKey,
    previousMasterKey: env.RIDDLR_ENCRYPTION_MASTER_KEY_PREVIOUS || undefined,
  };
}
