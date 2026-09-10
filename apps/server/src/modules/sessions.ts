import { hashToken, hmacSha256Utf8, randomToken, timingSafeEqualHex } from "@riddlr/crypto";
import { sessions } from "@riddlr/db";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../context.js";

export const COOKIE = "riddlr_session";

export function sessionCookieOptions(ctx: AppContext) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    path: "/",
    signed: false as const,
    secure: ctx.config.RIDDLR_PUBLIC_URL.startsWith("https"),
  };
}

export function signSessionToken(cookieSecret: string, token: string): string {
  return `${token}.${hmacSha256Utf8(cookieSecret, token)}`;
}

export function readSessionToken(cookieSecret: string, signed?: string): string | undefined {
  if (!signed) {
    return undefined;
  }
  const lastDot = signed.lastIndexOf(".");
  if (lastDot <= 0) {
    return undefined;
  }
  const token = signed.slice(0, lastDot);
  const mac = signed.slice(lastDot + 1).toLowerCase();
  const expected = hmacSha256Utf8(cookieSecret, token).toLowerCase();
  if (!timingSafeEqualHex(mac, expected)) {
    return undefined;
  }
  return token;
}

export function requestIp(request: FastifyRequest): string | undefined {
  return request.ip?.slice(0, 64);
}

export function requestUserAgent(request: FastifyRequest): string | undefined {
  const value = request.headers["user-agent"];
  return typeof value === "string" ? value.slice(0, 240) : undefined;
}

export function absoluteExpiry(ctx: AppContext, from = Date.now()): Date {
  return new Date(from + ctx.config.RIDDLR_SESSION_ABSOLUTE_HOURS * 60 * 60 * 1000);
}

export function isIdleExpired(ctx: AppContext, lastSeenAt: Date, now = Date.now()): boolean {
  return now - lastSeenAt.getTime() > ctx.config.RIDDLR_SESSION_IDLE_MINUTES * 60 * 1000;
}

export async function issueSession(
  ctx: AppContext,
  request: FastifyRequest,
  reply: FastifyReply,
  input: { userId: string; twoFactorSatisfied: boolean },
) {
  const token = randomToken();
  const [session] = await ctx.db
    .insert(sessions)
    .values({
      userId: input.userId,
      tokenHash: hashToken(token),
      expiresAt: absoluteExpiry(ctx),
      twoFactorSatisfied: input.twoFactorSatisfied,
      ip: requestIp(request),
      userAgent: requestUserAgent(request),
      lastSeenAt: new Date(),
    })
    .returning();
  if (!session) {
    throw new Error("Failed to create session");
  }
  await enforceSessionCap(ctx, input.userId, session.id);
  reply.setCookie(
    COOKIE,
    signSessionToken(ctx.config.cookieSecret, token),
    sessionCookieOptions(ctx),
  );
  return session;
}

export async function enforceSessionCap(ctx: AppContext, userId: string, keepId: string) {
  const cap = ctx.config.RIDDLR_MAX_SESSIONS;
  const active = await ctx.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .orderBy(asc(sessions.createdAt))
    .limit(cap + 32);
  const overflow = active.length - cap;
  if (overflow <= 0) {
    return;
  }
  const revoke = active.filter((row) => row.id !== keepId).slice(0, overflow);
  for (const row of revoke) {
    await ctx.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, row.id));
  }
}

export async function touchSession(ctx: AppContext, sessionId: string) {
  await ctx.db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function revokeSession(ctx: AppContext, sessionId: string) {
  await ctx.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function revokeOtherSessions(ctx: AppContext, userId: string, keepId: string) {
  await ctx.db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), ne(sessions.id, keepId)));
}

export async function rotateSessionCookie(
  ctx: AppContext,
  request: FastifyRequest,
  reply: FastifyReply,
  input: { userId: string; twoFactorSatisfied: boolean; keepId?: string },
) {
  if (input.keepId) {
    await revokeSession(ctx, input.keepId);
  }
  return issueSession(ctx, request, reply, input);
}
