import { createHmac } from "node:crypto";

function decodeBase32(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of cleaned) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function byteAt(buffer: Buffer, index: number): number {
  return buffer[index] ?? 0;
}

export function totpFromOtpauth(otpauth: string, now = Date.now()): string {
  const url = new URL(otpauth);
  const secret = url.searchParams.get("secret");
  if (!secret) {
    throw new Error("otpauth URL missing secret");
  }
  const key = decodeBase32(secret);
  const counter = Math.floor(now / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = byteAt(hmac, hmac.length - 1) & 0xf;
  const code =
    ((byteAt(hmac, offset) & 0x7f) << 24) |
    ((byteAt(hmac, offset + 1) & 0xff) << 16) |
    ((byteAt(hmac, offset + 2) & 0xff) << 8) |
    (byteAt(hmac, offset + 3) & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}
