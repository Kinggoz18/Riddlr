import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomToken } from "@riddlr/crypto";
import { formatSetupCode } from "@riddlr/domain";
import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.js";
import {
  assertSetupAccess,
  consumeSetupGate,
  ensureSetupGate,
  hasSetupProof,
  isSetupGateRoute,
  issueSetupCookie,
  markSetupClaimed,
  readOperatorSetupCode,
  readOrRenewOperatorSetupCode,
  SETUP_COOKIE,
  setupStatusAccess,
  verifySetupCode,
} from "../../src/modules/setup-gate.js";

function ctxFor(dir: string): AppContext {
  return {
    config: {
      RIDDLR_SECRETS_DIR: dir,
      cookieSecret: randomToken(16),
      RIDDLR_SETUP_ACCESS: "public",
      RIDDLR_PUBLIC_URL: "http://localhost:8080",
    },
  } as AppContext;
}

function requestFor(input: {
  url?: string;
  method?: string;
  ip: string;
  cookie?: string;
  forwardedFor?: string;
}): FastifyRequest {
  return {
    url: input.url ?? "/api/v1/setup/admin",
    method: input.method ?? "POST",
    socket: { remoteAddress: input.ip },
    raw: { socket: { remoteAddress: input.ip } },
    cookies: input.cookie ? { [SETUP_COOKIE]: input.cookie } : {},
    headers: input.forwardedFor ? { "x-forwarded-for": input.forwardedFor } : {},
  } as unknown as FastifyRequest;
}

describe("setup gate files", () => {
  it("creates a code, accepts grouped input, and forgets the code after consume", () => {
    const dir = mkdtempSync(join(tmpdir(), "riddlr-gate-"));
    const ctx = ctxFor(dir);
    const first = ensureSetupGate(ctx);
    expect(first.created).toBe(true);
    const again = ensureSetupGate(ctx);
    expect(again.created).toBe(false);
    expect(again.renewed).toBe(false);
    const formatted = readOperatorSetupCode(dir);
    expect(formatted).toMatch(/^[a-f0-9]{4}(-[a-f0-9]{4})+$/);
    const stored = readFileSync(join(dir, "setup-gate.json"), "utf8");
    expect(stored).not.toContain(formatted);
    expect(stored).not.toContain(formatted?.replaceAll("-", ""));
    expect(verifySetupCode(ctx, formatted as string)).toBe(true);
    expect(verifySetupCode(ctx, formatted?.replaceAll("-", "") as string)).toBe(true);
    expect(verifySetupCode(ctx, "deadbeefdeadbeefdeadbeefdeadbeef")).toBe(false);
    expect(verifySetupCode(ctx, "")).toBe(false);
    expect(verifySetupCode(ctx, "abcd")).toBe(false);
    expect(verifySetupCode(ctx, "a".repeat(16))).toBe(false);
    expect(verifySetupCode(ctx, "a".repeat(31))).toBe(false);
    const raw = readFileSync(join(dir, "setup-code"), "utf8");
    expect(formatSetupCode(raw)).toBe(formatted);
    consumeSetupGate(ctx);
    expect(readOperatorSetupCode(dir)).toBeUndefined();
    expect(verifySetupCode(ctx, formatted as string)).toBe(false);
  });

  it("does not treat status or unlock as gated routes", () => {
    expect(isSetupGateRoute("/api/v1/setup/status", "GET")).toBe(false);
    expect(isSetupGateRoute("/api/v1/setup/unlock", "POST")).toBe(false);
    expect(isSetupGateRoute("/api/v1/setup/admin", "POST")).toBe(true);
    expect(isSetupGateRoute("/api/v1/setup/complete", "POST")).toBe(true);
    expect(isSetupGateRoute("/healthz", "GET")).toBe(false);
  });

  it("rebuilds the hash from a leftover operator code file", () => {
    const dir = mkdtempSync(join(tmpdir(), "riddlr-gate-"));
    const leftover = "abcd-ef01-2345-6789-aaaa-bbbb-cccc-dddd";
    writeFileSync(join(dir, "setup-code"), `${leftover}\n`, { mode: 0o600 });
    const ctx = ctxFor(dir);
    const recovered = ensureSetupGate(ctx);
    expect(recovered.created).toBe(false);
    expect(verifySetupCode(ctx, leftover)).toBe(true);
    expect(readOperatorSetupCode(dir)).toBe(leftover);
  });
});

describe("setup gate decisions", () => {
  it("allows loopback, blocks a published peer, and ignores forwarded-for", async () => {
    const dir = mkdtempSync(join(tmpdir(), "riddlr-gate-"));
    const ctx = ctxFor(dir);
    ensureSetupGate(ctx);

    const local = requestFor({ ip: "127.0.0.1" });
    expect(setupStatusAccess(ctx, local, false)).toEqual({
      setupAccess: "code",
      canContinue: true,
      setupCodeExpired: false,
    });
    await expect(assertSetupAccess(ctx, local, false)).resolves.toBeUndefined();

    const remote = requestFor({ ip: "203.0.113.8", forwardedFor: "127.0.0.1" });
    expect(setupStatusAccess(ctx, remote, false)).toEqual({
      setupAccess: "code",
      canContinue: false,
      setupCodeExpired: false,
    });
    await expect(assertSetupAccess(ctx, remote, false)).rejects.toMatchObject({
      statusCode: 401,
      code: "setup_code",
    });
  });

  it("lets a published client continue after the setup cookie is issued", async () => {
    const dir = mkdtempSync(join(tmpdir(), "riddlr-gate-"));
    const ctx = ctxFor(dir);
    ensureSetupGate(ctx);
    const cookies: Record<string, string> = {};
    const reply = {
      setCookie(name: string, value: string) {
        cookies[name] = value;
      },
    } as unknown as FastifyReply;
    issueSetupCookie(ctx, reply);
    expect(cookies[SETUP_COOKIE]).toBeTruthy();
    const remote = requestFor({ ip: "203.0.113.8", cookie: cookies[SETUP_COOKIE] });
    expect(hasSetupProof(ctx, remote)).toBe(true);
    expect(setupStatusAccess(ctx, remote, false).canContinue).toBe(true);
    await expect(assertSetupAccess(ctx, remote, false)).resolves.toBeUndefined();
  });

  it("does not require a setup code when the instance is local", async () => {
    const dir = mkdtempSync(join(tmpdir(), "riddlr-gate-"));
    const ctx = ctxFor(dir);
    ctx.config.RIDDLR_SETUP_ACCESS = "loopback";
    ensureSetupGate(ctx);
    const remote = requestFor({ ip: "203.0.113.8" });
    expect(setupStatusAccess(ctx, remote, false)).toEqual({
      setupAccess: "local",
      canContinue: true,
      setupCodeExpired: false,
    });
    await expect(assertSetupAccess(ctx, remote, false)).resolves.toBeUndefined();
  });
});

describe("setup code lifetime", () => {
  function ageGate(dir: string, minutes: number) {
    const path = join(dir, "setup-gate.json");
    const record = JSON.parse(readFileSync(path, "utf8")) as {
      hash: string;
      createdAt: string;
      claimedAt?: string;
    };
    record.createdAt = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    writeFileSync(path, `${JSON.stringify(record)}\n`);
  }

  it("rejects unlock after 15 minutes and renews an unclaimed code", () => {
    const dir = mkdtempSync(join(tmpdir(), "riddlr-gate-"));
    const ctx = ctxFor(dir);
    ensureSetupGate(ctx);
    const first = readOperatorSetupCode(dir);
    ageGate(dir, 16);
    expect(verifySetupCode(ctx, first as string)).toBe(false);
    expect(setupStatusAccess(ctx, requestFor({ ip: "203.0.113.8" }), false)).toEqual({
      setupAccess: "code",
      canContinue: false,
      setupCodeExpired: true,
    });
    const renewed = ensureSetupGate(ctx);
    expect(renewed.renewed).toBe(true);
    const second = readOperatorSetupCode(dir);
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(verifySetupCode(ctx, first as string)).toBe(false);
    expect(verifySetupCode(ctx, second as string)).toBe(true);
    const printed = readOrRenewOperatorSetupCode(dir);
    expect(printed).toEqual({ kind: "code", code: second, renewed: false });
  });

  it("keeps a claimed browser working after expiry without rotating", async () => {
    const dir = mkdtempSync(join(tmpdir(), "riddlr-gate-"));
    const ctx = ctxFor(dir);
    ensureSetupGate(ctx);
    const first = readOperatorSetupCode(dir);
    markSetupClaimed(ctx);
    const cookies: Record<string, string> = {};
    const reply = {
      setCookie(name: string, value: string) {
        cookies[name] = value;
      },
    } as unknown as FastifyReply;
    issueSetupCookie(ctx, reply);
    ageGate(dir, 16);
    expect(verifySetupCode(ctx, first as string)).toBe(false);
    const remote = requestFor({ ip: "203.0.113.8", cookie: cookies[SETUP_COOKIE] });
    expect(hasSetupProof(ctx, remote)).toBe(true);
    expect(setupStatusAccess(ctx, remote, false)).toEqual({
      setupAccess: "code",
      canContinue: true,
      setupCodeExpired: false,
    });
    await expect(assertSetupAccess(ctx, remote, false)).resolves.toBeUndefined();
    expect(ensureSetupGate(ctx).renewed).toBe(false);
    expect(readOrRenewOperatorSetupCode(dir)).toEqual({ kind: "in_progress" });
    expect(readOperatorSetupCode(dir)).toBe(first);
  });

  it("still accepts a code at 14 minutes", () => {
    const dir = mkdtempSync(join(tmpdir(), "riddlr-gate-"));
    const ctx = ctxFor(dir);
    ensureSetupGate(ctx);
    const formatted = readOperatorSetupCode(dir);
    ageGate(dir, 14);
    expect(verifySetupCode(ctx, formatted as string)).toBe(true);
    expect(ensureSetupGate(ctx).renewed).toBe(false);
  });
});
