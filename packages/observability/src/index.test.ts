import { describe, expect, it } from "vitest";
import { containsSecretLeak, snapshotProcessMemory } from "./index.js";

describe("log redaction helpers", () => {
  it("detects leaked API keys", () => {
    expect(containsSecretLeak('{"apiKey":"sk-abc"}')).toBe(true);
    expect(containsSecretLeak('{"password":"secret"}')).toBe(true);
    expect(containsSecretLeak('{"password":"[redacted]"}')).toBe(false);
  });
});

describe("process memory snapshot", () => {
  it("reports resident set size as a positive byte count", () => {
    const snapshot = snapshotProcessMemory();
    expect(snapshot.rss).toBeGreaterThan(1_000_000);
    expect(snapshot.heapUsed).toBeGreaterThan(0);
    expect(snapshot.peakRss).toBeGreaterThanOrEqual(snapshot.rss);
  });
});
