import { decryptSecretWithKeys, type EncryptedSecret, encryptSecret } from "@riddlr/crypto";
import { authFactors, encryptedSecrets, instanceSettings } from "@riddlr/db";
import { eq, lt } from "drizzle-orm";
import type { AppContext } from "../context.js";

const SECRET_BATCH = 50;

export async function rotateEncryptionKeys(ctx: AppContext) {
  const settings = await ctx.db.select().from(instanceSettings).limit(1);
  const currentVersion = settings[0]?.keyVersion ?? 1;
  const nextVersion = currentVersion + 1;
  for (;;) {
    const batch = await ctx.db
      .select()
      .from(encryptedSecrets)
      .where(lt(encryptedSecrets.keyVersion, nextVersion))
      .limit(SECRET_BATCH);
    if (batch.length === 0) {
      break;
    }
    for (const secret of batch) {
      const plaintext = decryptSecretWithKeys({
        keys: ctx.masterKeys,
        secret: toEnvelope(secret),
        purpose: secret.purpose,
        aad: `${secret.purpose}|${secret.keyVersion}`,
      });
      const rotated = encryptSecret({
        masterKey: ctx.masterKey,
        plaintext,
        purpose: secret.purpose,
        keyVersion: nextVersion,
        aad: `${secret.purpose}|${nextVersion}`,
      });
      await ctx.db
        .update(encryptedSecrets)
        .set({
          ciphertext: rotated.ciphertext,
          nonce: rotated.nonce,
          tag: rotated.tag,
          alg: rotated.alg,
          keyVersion: nextVersion,
        })
        .where(eq(encryptedSecrets.id, secret.id));
    }
  }

  for (;;) {
    const factors = await ctx.db
      .select()
      .from(authFactors)
      .where(lt(authFactors.keyVersion, nextVersion))
      .limit(SECRET_BATCH);
    if (factors.length === 0) {
      break;
    }
    for (const factor of factors) {
      const envelope: EncryptedSecret = {
        ciphertext: factor.secretCiphertext,
        nonce: factor.secretNonce,
        tag: factor.secretTag,
        alg: "aes-256-gcm",
        keyVersion: factor.keyVersion,
      };
      const plaintext = decryptSecretWithKeys({
        keys: ctx.masterKeys,
        secret: envelope,
        purpose: "totp",
        aad: `totp|${factor.userId}|${factor.keyVersion}`,
      });
      const rotated = encryptSecret({
        masterKey: ctx.masterKey,
        plaintext,
        purpose: "totp",
        keyVersion: nextVersion,
        aad: `totp|${factor.userId}|${nextVersion}`,
      });
      await ctx.db
        .update(authFactors)
        .set({
          secretCiphertext: rotated.ciphertext,
          secretNonce: rotated.nonce,
          secretTag: rotated.tag,
          keyVersion: nextVersion,
        })
        .where(eq(authFactors.id, factor.id));
    }
  }

  await ctx.db
    .update(instanceSettings)
    .set({ keyVersion: nextVersion })
    .where(eq(instanceSettings.id, 1));
  return { keyVersion: nextVersion };
}

function toEnvelope(secret: {
  ciphertext: string;
  nonce: string;
  tag: string;
  alg: string;
  keyVersion: number;
}): EncryptedSecret {
  return {
    ciphertext: secret.ciphertext,
    nonce: secret.nonce,
    tag: secret.tag,
    alg: "aes-256-gcm",
    keyVersion: secret.keyVersion,
  };
}
