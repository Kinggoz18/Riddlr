import { describe, expect, it } from "vitest";
import { parseSearxngPayload } from "./searxng.js";
import { assertSafeHttpUrl, classifyHttpStatus } from "./types.js";

describe("SearXNG contract fixtures", () => {
  it("treats unresponsive engines as partial success", () => {
    const result = parseSearxngPayload(
      {
        results: [
          { url: "https://example.com/a", title: "Bitcoin", content: "News" },
          { title: 1 },
        ],
        unresponsive_engines: ["wikipedia"],
      },
      new Date("2026-09-10T00:00:00Z"),
    );
    expect(result.evidence).toHaveLength(1);
    expect(result.partial).toBe(true);
    expect(result.unresponsiveEngines).toEqual(["wikipedia"]);
    expect(result.errors.some((item) => item.class === "malformed")).toBe(true);
  });

  it("does not walk more SearXNG hits than the explicit bound", () => {
    const results = Array.from({ length: 500 }, (_, index) => ({
      url: `https://example.com/${index}`,
      title: `Hit ${index}`,
    }));
    const parsed = parseSearxngPayload({ results }, new Date("2026-09-10T00:00:00Z"), 5);
    expect(parsed.evidence).toHaveLength(5);
    expect(parsed.evidence[0]?.url).toBe("https://example.com/0");
  });

  it("classifies HTTP failures without collapsing the scan", () => {
    expect(classifyHttpStatus(429)).toBe("rate_limited");
    expect(classifyHttpStatus(403)).toBe("capability_missing");
    expect(classifyHttpStatus(503)).toBe("unavailable");
  });

  it("blocks link-local SSRF hosts by default", () => {
    expect(() => assertSafeHttpUrl("http://127.0.0.1/search")).toThrow();
    expect(() => assertSafeHttpUrl("file:///etc/passwd")).toThrow();
    expect(() => assertSafeHttpUrl("http://169.254.169.254/latest")).toThrow();
    expect(() => assertSafeHttpUrl("http://10.0.0.1/")).toThrow();
    expect(() => assertSafeHttpUrl("http://[::ffff:127.0.0.1]/")).toThrow();
    expect(() => assertSafeHttpUrl("http://[::ffff:7f00:1]/")).toThrow();
    expect(() => assertSafeHttpUrl("http://localhost./")).toThrow();
    expect(() => assertSafeHttpUrl("http://LocalHost./")).toThrow();
    expect(assertSafeHttpUrl("http://searxng:8080", ["searxng"]).hostname).toBe("searxng");
    expect(assertSafeHttpUrl("https://api.openai.com").hostname).toBe("api.openai.com");
  });
});
