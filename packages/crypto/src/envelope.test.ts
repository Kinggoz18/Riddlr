import { createHmac } from "node:crypto";
import { Secret, TOTP } from "otpauth";
import { describe, expect, it } from "vitest";
import {
  currentTotp,
  decodeMasterKey,
  decryptSecret,
  decryptSecretWithKeys,
  encryptSecret,
  generateMasterKey,
  generateTotpSecret,
  hashPassword,
  hashRecoveryCode,
  verifyAlchemySignature,
  verifyExactHeader,
  verifyMetaSignature,
  verifyPassword,
  verifyTotp,
} from "./index.js";

describe("envelope encryption", () => {
  it("round-trips plaintext and binds AAD", () => {
    const masterKey = decodeMasterKey(generateMasterKey());
    const secret = encryptSecret({
      masterKey,
      plaintext: "sk-test",
      purpose: "llm",
      keyVersion: 1,
      aad: "secret:1|1|llm",
    });
    expect(secret.alg).toBe("aes-256-gcm");
    expect(secret.nonce).not.toBe(secret.tag);
    expect(decryptSecret({ masterKey, secret, purpose: "llm", aad: "secret:1|1|llm" })).toBe(
      "sk-test",
    );
    expect(() => decryptSecret({ masterKey, secret, purpose: "llm", aad: "tampered" })).toThrow();
  });

  it("verifies Meta X-Hub-Signature-256 with a timing-safe compare", () => {
    const rawBody = Buffer.from('{"object":"whatsapp_business_account"}');
    const appSecret = "meta-app-secret";
    const header = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
    expect(verifyMetaSignature({ appSecret, rawBody, header })).toBe(true);
    expect(verifyMetaSignature({ appSecret, rawBody, header: "sha256=00" })).toBe(false);
    expect(verifyMetaSignature({ appSecret, rawBody })).toBe(false);
  });

  it("verifies Alchemy X-Alchemy-Signature with a timing-safe compare", () => {
    const rawBody = Buffer.from('{"type":"ADDRESS_ACTIVITY"}');
    const signingKey = "alchemy-signing-key";
    const header = createHmac("sha256", signingKey).update(rawBody).digest("hex");
    expect(verifyAlchemySignature({ signingKey, rawBody, header })).toBe(true);
    expect(verifyAlchemySignature({ signingKey, rawBody, header: "00" })).toBe(false);
    expect(verifyAlchemySignature({ signingKey, rawBody })).toBe(false);
    expect(verifyExactHeader({ expected: "riddlr-helius", header: "riddlr-helius" })).toBe(true);
    expect(verifyExactHeader({ expected: "riddlr-helius", header: "nope" })).toBe(false);
  });

  it("decrypts with a previous master key then re-encrypts under the current key", () => {
    const previous = decodeMasterKey(generateMasterKey());
    const current = decodeMasterKey(generateMasterKey());
    const secret = encryptSecret({
      masterKey: previous,
      plaintext: "sk-rotated",
      purpose: "llm",
      keyVersion: 1,
      aad: "llm|1",
    });
    const plaintext = decryptSecretWithKeys({
      keys: [current, previous],
      secret,
      purpose: "llm",
      aad: "llm|1",
    });
    expect(plaintext).toBe("sk-rotated");
    const rotated = encryptSecret({
      masterKey: current,
      plaintext,
      purpose: "llm",
      keyVersion: 2,
      aad: "llm|2",
    });
    expect(
      decryptSecret({ masterKey: current, secret: rotated, purpose: "llm", aad: "llm|2" }),
    ).toBe("sk-rotated");
    expect(() =>
      decryptSecret({ masterKey: current, secret, purpose: "llm", aad: "llm|1" }),
    ).toThrow();
  });
});

describe("passwords and totp", () => {
  it("hashes with argon2id and verifies", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "correct horse battery")).toBe(true);
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });

  it("verifies a current TOTP token", () => {
    const { secret } = generateTotpSecret();
    const token = new TOTP({ secret: Secret.fromBase32(secret) }).generate();
    expect(verifyTotp(secret, token)).toBe(true);
    expect(verifyTotp(secret, "000000")).toBe(false);
    expect(currentTotp(secret)).toMatch(/^\d{6}$/);
  });

  it("hashes recovery codes case-insensitively", () => {
    expect(hashRecoveryCode("AbC")).toBe(hashRecoveryCode("abc"));
  });
});
