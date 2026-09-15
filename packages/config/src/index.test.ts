import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEnv } from "./index.js";

describe("parseEnv", () => {
  it("fails closed when production secrets are missing", () => {
    expect(() =>
      parseEnv({
        RIDDLR_ENV: "production",
        RIDDLR_DATABASE_URL: "postgres://x",
        RIDDLR_REDIS_URL: "redis://x",
      }),
    ).toThrow(/required/);
  });

  it("does not generate secrets for production even when generate is requested", () => {
    expect(() =>
      parseEnv({
        RIDDLR_ENV: "production",
        RIDDLR_DATABASE_URL: "postgres://x",
        RIDDLR_REDIS_URL: "redis://x",
        RIDDLR_GENERATE_DEV_SECRETS: "true",
      }),
    ).toThrow(/required/);
  });

  it("generates local secrets for Compose-local mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "riddlr-"));
    const config = parseEnv({
      RIDDLR_ENV: "production",
      RIDDLR_DATABASE_URL: "postgres://x",
      RIDDLR_REDIS_URL: "redis://x",
      RIDDLR_SECRETS_DIR: dir,
      RIDDLR_LOCAL_COMPOSE: "true",
    });
    expect(config.cookieSecret.length).toBeGreaterThan(16);
    expect(config.encryptionMasterKey.length).toBeGreaterThan(16);
    expect(config.RIDDLR_SETUP_ACCESS).toBe("loopback");
  });

  it("rejects a Discord webhook origin that is not the Compose mock host", () => {
    const dir = mkdtempSync(join(tmpdir(), "riddlr-"));
    expect(() =>
      parseEnv({
        RIDDLR_ENV: "production",
        RIDDLR_DATABASE_URL: "postgres://x",
        RIDDLR_REDIS_URL: "redis://x",
        RIDDLR_SECRETS_DIR: dir,
        RIDDLR_LOCAL_COMPOSE: "true",
        RIDDLR_DISCORD_WEBHOOK_ORIGIN: "http://evil.example/steal",
      }),
    ).toThrow(/discord-webhook-mock/);
  });

  it("generates local secrets into the secrets directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "riddlr-"));
    const config = parseEnv({
      RIDDLR_ENV: "development",
      RIDDLR_DATABASE_URL: "postgres://x",
      RIDDLR_REDIS_URL: "redis://x",
      RIDDLR_SECRETS_DIR: dir,
      RIDDLR_GENERATE_DEV_SECRETS: "true",
    });
    expect(config.cookieSecret.length).toBeGreaterThan(16);
    expect(config.encryptionMasterKey.length).toBeGreaterThan(16);
    expect(config.RIDDLR_OBSERVE_PRICE_INTERVAL_SECONDS).toBe(60);
    expect(config.RIDDLR_OBSERVE_RETENTION_DAYS).toBe(90);
    expect(config.RIDDLR_SEARXNG_URL).toBe("http://127.0.0.1:8888");
  });

  it("defaults local database and redis URLs in development", () => {
    const dir = mkdtempSync(join(tmpdir(), "riddlr-"));
    const config = parseEnv({
      RIDDLR_ENV: "development",
      RIDDLR_SECRETS_DIR: dir,
    });
    expect(config.RIDDLR_DATABASE_URL).toBe("postgres://riddlr:riddlr@127.0.0.1:5432/riddlr");
    expect(config.RIDDLR_REDIS_URL).toBe("redis://127.0.0.1:6379");
  });

  it("requires database and redis URLs outside development", () => {
    expect(() =>
      parseEnv({
        RIDDLR_ENV: "test",
        RIDDLR_COOKIE_SECRET: "x".repeat(32),
        RIDDLR_ENCRYPTION_MASTER_KEY: "Y".repeat(44),
      }),
    ).toThrow(/RIDDLR_DATABASE_URL/);
  });
});
