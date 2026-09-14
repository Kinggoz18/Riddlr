import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const ENCRYPTION_ALG = "aes-256-gcm";

export type EncryptedSecret = {
  ciphertext: string;
  nonce: string;
  tag: string;
  alg: typeof ENCRYPTION_ALG;
  keyVersion: number;
};

export function decodeMasterKey(value: string): Buffer {
  const buf = Buffer.from(value, "base64");
  if (buf.length !== 32) {
    throw new Error("RIDDLR_ENCRYPTION_MASTER_KEY must be 32 bytes, base64-encoded.");
  }
  return buf;
}

export function generateMasterKey(): string {
  return randomBytes(32).toString("base64");
}

export function derivePurposeKey(masterKey: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey, "riddlr", purpose, 32));
}

export function encryptSecret(params: {
  masterKey: Buffer;
  plaintext: string;
  purpose: string;
  keyVersion: number;
  aad: string;
}): EncryptedSecret {
  const key = derivePurposeKey(params.masterKey, params.purpose);
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALG, key, nonce);
  cipher.setAAD(Buffer.from(params.aad));
  const ciphertext = Buffer.concat([cipher.update(params.plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    tag: tag.toString("base64"),
    alg: ENCRYPTION_ALG,
    keyVersion: params.keyVersion,
  };
}

export function decryptSecret(params: {
  masterKey: Buffer;
  secret: EncryptedSecret;
  purpose: string;
  aad: string;
}): string {
  const key = derivePurposeKey(params.masterKey, params.purpose);
  const decipher = createDecipheriv(
    ENCRYPTION_ALG,
    key,
    Buffer.from(params.secret.nonce, "base64"),
  );
  decipher.setAAD(Buffer.from(params.aad));
  decipher.setAuthTag(Buffer.from(params.secret.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(params.secret.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

export function decryptSecretWithKeys(params: {
  keys: readonly Buffer[];
  secret: EncryptedSecret;
  purpose: string;
  aad: string;
}): string {
  if (params.keys.length === 0) {
    throw new Error("No encryption keys available.");
  }
  let lastError: unknown;
  for (const masterKey of params.keys) {
    try {
      return decryptSecret({
        masterKey,
        secret: params.secret,
        purpose: params.purpose,
        aad: params.aad,
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Unable to decrypt secret.");
}

export function hmacSha256(key: Buffer, value: string | Buffer): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

export function hmacSha256Utf8(key: string, value: string | Buffer): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

export function timingSafeEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  if (a.length === 0 || a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function verifyMetaSignature(input: {
  appSecret: string;
  rawBody: string | Buffer;
  header?: string | string[];
}): boolean {
  const header = Array.isArray(input.header) ? input.header[0] : input.header;
  if (!header?.startsWith("sha256=")) {
    return false;
  }
  const presented = header.slice("sha256=".length).trim().toLowerCase();
  const expected = hmacSha256Utf8(input.appSecret, input.rawBody).toLowerCase();
  return timingSafeEqualHex(presented, expected);
}

export function verifyAlchemySignature(input: {
  signingKey: string;
  rawBody: string | Buffer;
  header?: string | string[];
}): boolean {
  const header = Array.isArray(input.header) ? input.header[0] : input.header;
  if (!header?.trim()) {
    return false;
  }
  const presented = header.trim().toLowerCase();
  const expected = hmacSha256Utf8(input.signingKey, input.rawBody).toLowerCase();
  return timingSafeEqualHex(presented, expected);
}

export function verifyExactHeader(input: {
  expected: string;
  header?: string | string[];
}): boolean {
  const header = Array.isArray(input.header) ? input.header[0] : input.header;
  if (!header) {
    return false;
  }
  const presented = Buffer.from(header);
  const expected = Buffer.from(input.expected);
  if (presented.length === 0 || presented.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(presented, expected);
}
