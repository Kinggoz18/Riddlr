import {
  decryptSecretWithKeys,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotp,
} from "@riddlr/crypto";
import { authFactors, recoveryCodes } from "@riddlr/db";
import { eq } from "drizzle-orm";
import type { AppContext } from "../context.js";

export async function loadTotpFactor(ctx: AppContext, userId: string) {
  const [factor] = await ctx.db
    .select()
    .from(authFactors)
    .where(eq(authFactors.userId, userId))
    .limit(1);
  return factor;
}

export async function loadVerifiedTotpFactor(ctx: AppContext, userId: string) {
  const factor = await loadTotpFactor(ctx, userId);
  return factor?.verifiedAt ? factor : undefined;
}

export function decryptTotpSecret(
  ctx: AppContext,
  factor: NonNullable<Awaited<ReturnType<typeof loadTotpFactor>>>,
  userId: string,
) {
  return decryptSecretWithKeys({
    keys: ctx.masterKeys,
    secret: {
      ciphertext: factor.secretCiphertext,
      nonce: factor.secretNonce,
      tag: factor.secretTag,
      alg: "aes-256-gcm",
      keyVersion: factor.keyVersion,
    },
    purpose: "totp",
    aad: `totp|${userId}|${factor.keyVersion}`,
  });
}

export async function startTotpEnrollment(ctx: AppContext, userId: string, account: string) {
  const existing = await loadVerifiedTotpFactor(ctx, userId);
  if (existing) {
    const error = new Error("Authenticator is already enabled.");
    (error as Error & { statusCode?: number; code?: string }).statusCode = 409;
    (error as Error & { code?: string }).code = "totp_enabled";
    throw error;
  }
  const { secret, otpauth } = generateTotpSecret(account);
  const encrypted = encryptSecret({
    masterKey: ctx.masterKey,
    plaintext: secret,
    purpose: "totp",
    keyVersion: 1,
    aad: `totp|${userId}|1`,
  });
  await ctx.db.delete(authFactors).where(eq(authFactors.userId, userId));
  await ctx.db.insert(authFactors).values({
    userId,
    kind: "totp",
    secretCiphertext: encrypted.ciphertext,
    secretNonce: encrypted.nonce,
    secretTag: encrypted.tag,
    keyVersion: 1,
  });
  return { secret, otpauth };
}

export async function discardUnverifiedTotp(ctx: AppContext, userId: string) {
  const factor = await loadTotpFactor(ctx, userId);
  if (factor && !factor.verifiedAt) {
    await ctx.db.delete(authFactors).where(eq(authFactors.id, factor.id));
  }
}

export async function confirmTotpEnrollment(ctx: AppContext, userId: string, token: string) {
  const factor = await loadTotpFactor(ctx, userId);
  if (!factor) {
    return { ok: false as const, code: "missing_totp", message: "Start TOTP first." };
  }
  if (factor.verifiedAt) {
    return {
      ok: false as const,
      code: "totp_enabled",
      message: "Authenticator is already enabled.",
    };
  }
  const secret = decryptTotpSecret(ctx, factor, userId);
  if (!verifyTotp(secret, token)) {
    return { ok: false as const, code: "invalid_totp", message: "Invalid authenticator code." };
  }
  await ctx.db
    .update(authFactors)
    .set({ verifiedAt: new Date() })
    .where(eq(authFactors.id, factor.id));
  const codes = generateRecoveryCodes();
  await ctx.db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  await ctx.db
    .insert(recoveryCodes)
    .values(codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })));
  return { ok: true as const, recoveryCodes: codes };
}
