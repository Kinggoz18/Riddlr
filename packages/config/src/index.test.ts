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
  });
});
