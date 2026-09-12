import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "@riddlr/config";
import { decodeMasterKey, generateMasterKey, randomToken } from "@riddlr/crypto";
import { createDb, migrate } from "@riddlr/db";
import { DomainModuleRegistry } from "@riddlr/domain";
import { cryptoDomainModule } from "@riddlr/domain-crypto";
import { createLogger, createMetrics } from "@riddlr/observability";
import { QUEUE_NAMES } from "@riddlr/queue";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { GenericContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { AppContext } from "../src/context.js";
import { createHttpOnboardClient, runOnboard } from "../src/modules/onboard.js";
import { readOperatorSetupCode } from "../src/modules/setup-gate.js";

function cookieHeader(setCookie: string | string[] | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.map((item) => item.split(";")[0] ?? "").join("; ");
}

describe("setup access paths", () => {
  let stop: (() => Promise<void>) | undefined;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let ctx: AppContext;
  const secretsDir = mkdtempSync(join(tmpdir(), "riddlr-access-"));

  beforeAll(async () => {
    const postgres = await new GenericContainer("postgres:17-alpine")
      .withEnvironment({
        POSTGRES_USER: "riddlr",
        POSTGRES_PASSWORD: "riddlr",
        POSTGRES_DB: "riddlr",
      })
      .withTmpFs({ "/var/lib/postgresql/data": "rw,noexec,nosuid,size=256m" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();
    const valkey = await new GenericContainer("valkey/valkey:8-alpine")
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();
    const databaseUrl = `postgres://riddlr:riddlr@${postgres.getHost()}:${postgres.getMappedPort(5432)}/riddlr`;
    const redisUrl = `redis://${valkey.getHost()}:${valkey.getMappedPort(6379)}`;
    await migrate(databaseUrl);
    const { db, client } = createDb(databaseUrl);
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const master = generateMasterKey();
    const cookieSecret = randomToken();
    const domains = new DomainModuleRegistry();
    domains.register(cryptoDomainModule);
    const config = parseEnv({
      RIDDLR_ENV: "test",
      RIDDLR_HTTP_HOST: "127.0.0.1",
      RIDDLR_HTTP_PORT: "3001",
      RIDDLR_PUBLIC_URL: "http://localhost:8080",
      RIDDLR_DATABASE_URL: databaseUrl,
      RIDDLR_REDIS_URL: redisUrl,
      RIDDLR_COOKIE_SECRET: cookieSecret,
      RIDDLR_ENCRYPTION_MASTER_KEY: master,
      RIDDLR_SETUP_ACCESS: "public",
      RIDDLR_LOG_LEVEL: "error",
      RIDDLR_LOG_FORMAT: "json",
      RIDDLR_SEARXNG_URL: "http://searxng:8080",
      RIDDLR_EMAIL_FROM: "Riddlr <noreply@localhost>",
      RIDDLR_SECRETS_DIR: secretsDir,
      RIDDLR_GENERATE_DEV_SECRETS: "false",
      RIDDLR_PROCESS_ROLE: "api",
      RIDDLR_METRICS_PUBLIC: "false",
    });
    ctx = {
      config,
      db,
      redis,
      scanQueue: new Queue(QUEUE_NAMES.scanRun, { connection: redis }),
      analyzeQueue: new Queue(QUEUE_NAMES.analyzeEvent, { connection: redis }),
      notifyQueue: new Queue(QUEUE_NAMES.notifyDeliver, { connection: redis }),
      logger: createLogger({ level: "error", pretty: false }),
      metrics: createMetrics(),
      masterKey: decodeMasterKey(master),
      masterKeys: [decodeMasterKey(master)],
      domains,
    };
    app = await buildApp(ctx);
    stop = async () => {
      await app.close();
      await redis.quit();
      await client.end();
      await postgres.stop();
      await valkey.stop();
    };
  }, 120_000);

  afterAll(async () => {
    await stop?.();
  });

  it("keeps first-run on this host without a setup code (SSH tunnel / CLI)", async () => {
    const status = await app.inject({ method: "GET", url: "/api/v1/setup/status" });
    expect(status.statusCode).toBe(200);
    expect(status.json().setupAccess).toBe("code");
    expect(status.json().canContinue).toBe(true);
    expect(JSON.stringify(status.json())).not.toContain(readOperatorSetupCode(secretsDir));
  });

  it("rejects a published client until the setup code is accepted and ignores forwarded loopback", async () => {
    const remote = "203.0.113.8";
    const blockedStatus = await app.inject({
      method: "GET",
      url: "/api/v1/setup/status",
      remoteAddress: remote,
    });
    expect(blockedStatus.json().canContinue).toBe(false);
    expect(blockedStatus.json().setupAccess).toBe("code");
    expect(blockedStatus.json().setupCodeExpired).toBe(false);

    const spoofed = await app.inject({
      method: "POST",
      url: "/api/v1/setup/admin",
      remoteAddress: remote,
      headers: { "x-forwarded-for": "127.0.0.1" },
      payload: { email: "hijack@example.com", password: "correct horse battery" },
    });
    expect(spoofed.statusCode).toBe(401);
    expect(spoofed.json().error.code).toBe("setup_code");

    const wrong = await app.inject({
      method: "POST",
      url: "/api/v1/setup/unlock",
      remoteAddress: remote,
      payload: { code: "0000-0000-0000-0000-0000-0000-0000-0000" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(JSON.stringify(wrong.json())).not.toContain(readOperatorSetupCode(secretsDir));

    const unlock = await app.inject({
      method: "POST",
      url: "/api/v1/setup/unlock",
      remoteAddress: remote,
      payload: { code: readOperatorSetupCode(secretsDir) },
    });
    expect(unlock.statusCode).toBe(200);
    const unlockedCookie = cookieHeader(unlock.headers["set-cookie"]);

    const ready = await app.inject({
      method: "GET",
      url: "/api/v1/setup/status",
      remoteAddress: remote,
      headers: { cookie: unlockedCookie },
    });
    expect(ready.json().canContinue).toBe(true);
  });

  it("completes first-run through the host CLI client and then forgets the setup code", async () => {
    const origin = "http://onboard.test";
    const cookieJar = { value: "" };
    const client = createHttpOnboardClient(origin, (async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      const path = url.replace(origin, "");
      const injected = await app.inject({
        method: String(init?.method ?? "GET"),
        url: path,
        headers: init?.headers as Record<string, string> | undefined,
        payload: init?.body ? JSON.parse(String(init.body)) : undefined,
        remoteAddress: "127.0.0.1",
      });
      const headers = new Headers();
      const setCookie = injected.headers["set-cookie"];
      if (setCookie) {
        const list = Array.isArray(setCookie) ? setCookie : [setCookie];
        for (const line of list) {
          headers.append("set-cookie", line);
        }
        cookieJar.value = cookieHeader(setCookie);
      }
      return new Response(injected.body, { status: injected.statusCode, headers });
    }) as typeof fetch);

    await runOnboard(
      {
        nonInteractive: true,
        email: "cli@example.com",
        password: "correct horse battery",
        skipTotp: true,
        skipLlm: true,
      },
      client,
      { read: async () => "", write: () => undefined },
    );

    const locked = await app.inject({
      method: "POST",
      url: "/api/v1/setup/unlock",
      remoteAddress: "203.0.113.8",
      payload: { code: "abcd-ef01-2345-6789-aaaa-bbbb-cccc-dddd" },
    });
    expect(locked.statusCode).toBe(409);
    expect(readOperatorSetupCode(secretsDir)).toBeUndefined();
    void cookieJar;
  });
});
