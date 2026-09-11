import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import { Secret, TOTP } from "otpauth";

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function generateTotpSecret(account = "Riddlr"): { secret: string; otpauth: string } {
  const totp = new TOTP({
    issuer: "Riddlr",
    label: account,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: new Secret({ size: 20 }),
  });
  return { secret: totp.secret.base32, otpauth: totp.toString() };
}

function totpFor(secret: string): TOTP {
  return new TOTP({
    issuer: "Riddlr",
    label: "Riddlr",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
}

export function currentTotp(secret: string): string {
  return totpFor(secret).generate();
}

export function verifyTotp(secret: string, token: string): boolean {
  return totpFor(secret).validate({ token: token.replace(/\s/g, ""), window: 1 }) !== null;
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => randomBytes(5).toString("hex"));
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.trim().toLowerCase()).digest("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}
