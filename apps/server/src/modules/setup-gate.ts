import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hashToken, randomToken, timingSafeEqualHex } from "@riddlr/crypto";
import {
  formatSetupCode,
  isLoopbackAddress,
  normalizeSetupCode,
  SETUP_CODE_BYTES,
  SETUP_CODE_HEX_LENGTH,
  SETUP_CODE_TTL_MINUTES,
  setupAccessView,
  setupCanContinue,
  setupCodeIsExpired,
} from "@riddlr/domain";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../context.js";
import { readSessionToken, sessionCookieOptions, signSessionToken } from "./sessions.js";

const GATE_FILE = "setup-gate.json";
const CODE_FILE = "setup-code";
export const SETUP_COOKIE = "riddlr_setup";
const SETUP_COOKIE_PREFIX = "setup:";
const SETUP_DENIED = "Enter the setup code from the first start of this instance.";
const SETUP_EXPIRED = `This setup code expired after ${SETUP_CODE_TTL_MINUTES} minutes. Print a new one from the host, then enter it.`;

type GateRecord = {
  hash: string;
  createdAt: string;
  claimedAt?: string;
  consumedAt?: string;
};

export type OperatorSetupCodeResult =
  | { kind: "code"; code: string; renewed: boolean }
  | { kind: "gone" }
  | { kind: "in_progress" };

function gatePath(dir: string) {
  return join(dir, GATE_FILE);
}

function codePath(dir: string) {
  return join(dir, CODE_FILE);
}

function readGate(dir: string): GateRecord | undefined {
  try {
    const parsed = JSON.parse(readFileSync(gatePath(dir), "utf8")) as GateRecord;
    if (typeof parsed.hash !== "string" || parsed.hash.length < 32) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function writeJson(path: string, value: GateRecord) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

function persistNewSetupCode(dir: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const raw = randomToken(SETUP_CODE_BYTES);
  const normalized = normalizeSetupCode(raw);
  const formatted = formatSetupCode(normalized);
  writeFileSync(codePath(dir), `${formatted}\n`, { mode: 0o600 });
  writeJson(gatePath(dir), {
    hash: hashToken(normalized),
    createdAt: new Date().toISOString(),
  });
  return formatted;
}

export function socketAddress(request: FastifyRequest): string | undefined {
  return request.socket.remoteAddress ?? request.raw.socket.remoteAddress;
}

export function hasSetupProof(ctx: AppContext, request: FastifyRequest): boolean {
  const record = readGate(ctx.config.RIDDLR_SECRETS_DIR);
  if (!record || record.consumedAt) {
    return false;
  }
  const payload = readSessionToken(ctx.config.cookieSecret, request.cookies[SETUP_COOKIE]);
  if (!payload?.startsWith(SETUP_COOKIE_PREFIX)) {
    return false;
  }
  const presented = payload.slice(SETUP_COOKIE_PREFIX.length).toLowerCase();
  return timingSafeEqualHex(presented, record.hash.toLowerCase());
}

export function setupStatusAccess(ctx: AppContext, request: FastifyRequest, completed: boolean) {
  const access = setupAccessView(ctx.config.RIDDLR_SETUP_ACCESS);
  const fromLoopback = isLoopbackAddress(socketAddress(request));
  const proof = hasSetupProof(ctx, request);
  const canContinue = setupCanContinue({
    completed,
    access,
    fromLoopback,
    hasSetupProof: proof,
  });
  const record = readGate(ctx.config.RIDDLR_SECRETS_DIR);
  const setupCodeExpired =
    access === "code" &&
    !completed &&
    !proof &&
    Boolean(record && !record.consumedAt && setupCodeIsExpired(record.createdAt));
  return { setupAccess: access, canContinue, setupCodeExpired };
}

export function ensureSetupGate(ctx: AppContext): {
  created: boolean;
  consumed: boolean;
  renewed: boolean;
} {
  const dir = ctx.config.RIDDLR_SECRETS_DIR;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const existing = readGate(dir);
  if (existing?.consumedAt) {
    return { created: false, consumed: true, renewed: false };
  }
  if (existing && setupCodeIsExpired(existing.createdAt) && !existing.claimedAt) {
    persistNewSetupCode(dir);
    return { created: true, consumed: false, renewed: true };
  }
  if (existing) {
    return { created: false, consumed: false, renewed: false };
  }
  const leftover = readLeftoverCode(dir);
  if (leftover) {
    writeJson(gatePath(dir), {
      hash: hashToken(leftover),
      createdAt: new Date().toISOString(),
    });
    return { created: false, consumed: false, renewed: false };
  }
  persistNewSetupCode(dir);
  return { created: true, consumed: false, renewed: false };
}

function readLeftoverCode(dir: string): string | undefined {
  try {
    const normalized = normalizeSetupCode(readFileSync(codePath(dir), "utf8"));
    if (normalized.length === SETUP_CODE_HEX_LENGTH) {
      return normalized;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function readOperatorSetupCode(dir: string): string | undefined {
  const record = readGate(dir);
  if (!record || record.consumedAt) {
    return undefined;
  }
  try {
    const formatted = formatSetupCode(readFileSync(codePath(dir), "utf8"));
    return formatted.length > 0 ? formatted : undefined;
  } catch {
    return undefined;
  }
}

export function readOrRenewOperatorSetupCode(dir: string): OperatorSetupCodeResult {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const record = readGate(dir);
  if (record?.consumedAt) {
    return { kind: "gone" };
  }
  if (record && setupCodeIsExpired(record.createdAt) && record.claimedAt) {
    return { kind: "in_progress" };
  }
  if (record && setupCodeIsExpired(record.createdAt) && !record.claimedAt) {
    return { kind: "code", code: persistNewSetupCode(dir), renewed: true };
  }
  const existing = readOperatorSetupCode(dir);
  if (existing) {
    return { kind: "code", code: existing, renewed: false };
  }
  return { kind: "code", code: persistNewSetupCode(dir), renewed: true };
}

export function markSetupClaimed(ctx: AppContext) {
  const dir = ctx.config.RIDDLR_SECRETS_DIR;
  const record = readGate(dir);
  if (!record || record.consumedAt || record.claimedAt) {
    return;
  }
  writeJson(gatePath(dir), { ...record, claimedAt: new Date().toISOString() });
}

export function consumeSetupGate(ctx: AppContext) {
  const dir = ctx.config.RIDDLR_SECRETS_DIR;
  const record = readGate(dir);
  if (record && !record.consumedAt) {
    writeJson(gatePath(dir), { ...record, consumedAt: new Date().toISOString() });
  }
  try {
    unlinkSync(codePath(dir));
  } catch {
    // already removed
  }
}

export function setupCodeRecordExpired(ctx: AppContext, now = Date.now()): boolean {
  const record = readGate(dirFor(ctx));
  if (!record || record.consumedAt) {
    return false;
  }
  return setupCodeIsExpired(record.createdAt, now);
}

export function verifySetupCode(ctx: AppContext, code: string): boolean {
  const record = readGate(dirFor(ctx));
  if (!record || record.consumedAt) {
    return false;
  }
  if (setupCodeIsExpired(record.createdAt)) {
    return false;
  }
  const normalized = normalizeSetupCode(code);
  if (normalized.length !== SETUP_CODE_HEX_LENGTH) {
    return false;
  }
  return timingSafeEqualHex(hashToken(normalized), record.hash.toLowerCase());
}

function dirFor(ctx: AppContext) {
  return ctx.config.RIDDLR_SECRETS_DIR;
}

export function issueSetupCookie(ctx: AppContext, reply: FastifyReply) {
  const record = readGate(ctx.config.RIDDLR_SECRETS_DIR);
  if (!record || record.consumedAt) {
    return;
  }
  reply.setCookie(
    SETUP_COOKIE,
    signSessionToken(ctx.config.cookieSecret, `${SETUP_COOKIE_PREFIX}${record.hash}`),
    sessionCookieOptions(ctx),
  );
}

export function clearSetupCookie(ctx: AppContext, reply: FastifyReply) {
  reply.clearCookie(SETUP_COOKIE, sessionCookieOptions(ctx));
}

export function setupDenied() {
  const error = new Error(SETUP_DENIED);
  (error as Error & { statusCode?: number; code?: string }).statusCode = 401;
  (error as Error & { code?: string }).code = "setup_code";
  return error;
}

export function setupExpired() {
  const error = new Error(SETUP_EXPIRED);
  (error as Error & { statusCode?: number; code?: string }).statusCode = 401;
  (error as Error & { code?: string }).code = "setup_code_expired";
  return error;
}

export function isSetupGateRoute(url: string, method: string): boolean {
  const path = url.split("?")[0] ?? "";
  if (!path.startsWith("/api/v1/setup/")) {
    return false;
  }
  if (method === "GET" && path === "/api/v1/setup/status") {
    return false;
  }
  if (method === "POST" && path === "/api/v1/setup/unlock") {
    return false;
  }
  return method !== "GET";
}

export async function assertSetupAccess(
  ctx: AppContext,
  request: FastifyRequest,
  completed: boolean,
) {
  if (!isSetupGateRoute(request.url, request.method)) {
    return;
  }
  const access = setupStatusAccess(ctx, request, completed);
  if (access.canContinue) {
    return;
  }
  if (access.setupCodeExpired) {
    throw setupExpired();
  }
  throw setupDenied();
}
