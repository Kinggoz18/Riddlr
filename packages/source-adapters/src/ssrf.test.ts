import { describe, expect, it } from "vitest";
import {
  assertSafeHttpUrl,
  assertSafeResolvedHttpUrl,
  isBlockedSsrfHost,
  safeFetch,
} from "./types.js";

describe("SSRF guards", () => {
  it("blocks loopback, link-local, encoded IPv4, and rebinding helper domains by hostname", () => {
    expect(() => assertSafeHttpUrl("http://127.0.0.1/search")).toThrow();
    expect(() => assertSafeHttpUrl("http://169.254.169.254/latest")).toThrow();
    expect(() => assertSafeHttpUrl("http://[::ffff:127.0.0.1]/")).toThrow();
    expect(() => assertSafeHttpUrl("http://localtest.me/")).toThrow();
    expect(() => assertSafeHttpUrl("http://127.0.0.1.nip.io/")).toThrow();
    expect(() => assertSafeHttpUrl("http://10.0.0.1.sslip.io/")).toThrow();
    expect(isBlockedSsrfHost("localtest.me")).toBe(true);
  });

  it("rejects DNS records that resolve to blocked addresses", async () => {
    await expect(
      assertSafeResolvedHttpUrl("https://example.test", [], async () => [
        { address: "169.254.169.254", family: 4 },
      ]),
    ).rejects.toThrow(/blocked/);
    await expect(
      assertSafeResolvedHttpUrl("https://example.test", [], async () => [
        { address: "127.0.0.1", family: 4 },
      ]),
    ).rejects.toThrow(/blocked/);
  });

  it("does not follow redirects onto link-local metadata", async () => {
    await expect(
      safeFetch("https://example.test/start", {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        fetchImpl: async () =>
          new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data/" },
          }),
      } as Parameters<typeof safeFetch>[1] & { fetchImpl?: typeof fetch }),
    ).rejects.toThrow();
  });
});
