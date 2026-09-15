import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_SEARXNG_ENGINES } from "@riddlr/domain";
import { describe, expect, it } from "vitest";
import {
  createSearxngAdapter,
  parseSearxngEngines,
  parseSearxngPayload,
  SEARXNG_SAFE_HOSTS,
} from "./searxng.js";
import { assertSafeHttpUrl, classifyHttpStatus } from "./types.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/searxng");
const fetchedAt = new Date("2026-09-14T13:30:00.000Z");

function readFixture(name: string): string {
  return readFileSync(join(fixtures, name), "utf8");
}

describe("SearXNG contract fixtures", () => {
  it("parses a captured categories=news response into snippet evidence", () => {
    const payload = JSON.parse(readFixture("news-bitcoin.json")) as {
      results: unknown;
      unresponsive_engines: unknown;
    };
    const parsed = parseSearxngPayload(payload, fetchedAt);
    expect(parsed.errors).toEqual([]);
    expect(parsed.evidence).toHaveLength(3);
    expect(parsed.evidence[0]?.url).toBe(
      "https://www.investopedia.com/a-big-crypto-vote-is-coming-this-week-here-s-what-you-need-to-know-bitcoin-clarity-act-12114898",
    );
    expect(parsed.evidence[0]?.title).toBe(
      "A Big Crypto Vote Is Coming This Week. Here’s What You Need to Know.",
    );
    expect(parsed.evidence[0]?.contentCompleteness).toBe("snippet");
    expect(parsed.evidence[0]?.adapterPayload).toEqual({ engine: "bing news" });
    expect(parsed.evidence[1]?.url).toContain("reuters.com");
    expect(parsed.unresponsiveEngines).toEqual([]);
  });

  it("treats a captured empty results array as an empty success", () => {
    const payload = JSON.parse(readFixture("empty.json")) as { results: unknown };
    const parsed = parseSearxngPayload(payload, fetchedAt);
    expect(parsed.evidence).toEqual([]);
    expect(parsed.partial).toBe(false);
    expect(parsed.errors).toEqual([]);
  });

  it("records schema drift when url and title are both missing", () => {
    const payload = JSON.parse(readFixture("news-bitcoin-drift-missing-url-title.json")) as {
      results: unknown;
    };
    const parsed = parseSearxngPayload(payload, fetchedAt);
    expect(parsed.evidence).toHaveLength(0);
    expect(parsed.partial).toBe(true);
    expect(parsed.errors.some((item) => item.class === "malformed")).toBe(true);
  });

  it("treats unresponsive engines as partial success", () => {
    const result = parseSearxngPayload(
      {
        results: [
          { url: "https://example.com/a", title: "Bitcoin", content: "News" },
          { title: 1 },
        ],
        unresponsive_engines: ["wikipedia"],
      },
      fetchedAt,
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
    const parsed = parseSearxngPayload({ results }, fetchedAt, 5);
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
    expect(assertSafeHttpUrl("http://127.0.0.1:8888", [...SEARXNG_SAFE_HOSTS]).port).toBe("8888");
    expect(assertSafeHttpUrl("https://api.openai.com").hostname).toBe("api.openai.com");
  });

  it("defaults fetch to categories=news language=en time_range=day", async () => {
    const seen: string[] = [];
    const adapter = createSearxngAdapter(async (input) => {
      seen.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return new Response(readFixture("news-bitcoin.json"), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const result = await adapter.fetch(
      { endpoint: "http://searxng:8080", engines: ["bing news", "reuters"] },
      { query: '"Bitcoin" OR "BTC" (hack OR exploit)' },
    );
    expect(seen[0]).toContain("categories=news");
    expect(seen[0]).toContain("language=en");
    expect(seen[0]).toContain("time_range=day");
    expect(seen[0]).toContain("engines=bing+news%2Creuters");
    expect(result.evidence).toHaveLength(3);
    expect(result.errors).toEqual([]);
  });

  it("drops blocked publisher hosts from search hits", async () => {
    const adapter = createSearxngAdapter(async () => {
      return new Response(readFixture("news-bitcoin.json"), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const result = await adapter.fetch(
      { endpoint: "http://searxng:8080" },
      { query: "bitcoin", blockedHosts: ["investopedia.com"] },
    );
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence.some((item) => item.url?.includes("investopedia.com"))).toBe(false);
  });

  it("classifies empty, HTML 200, oversized, 429 with and without Retry-After, and 5xx", async () => {
    const adapter = createSearxngAdapter(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("empty")) {
        return new Response(readFixture("empty.json"), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("html")) {
        return new Response("<!doctype html><title>SearXNG</title>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      if (url.includes("large")) {
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "2000000" },
        });
      }
      if (url.includes("retry")) {
        return new Response("slow down", { status: 429, headers: { "retry-after": "12" } });
      }
      if (url.includes("norat")) {
        return new Response("slow down", { status: 429 });
      }
      if (url.includes("fail")) {
        return new Response("nope", { status: 503 });
      }
      if (url.includes("abort")) {
        throw new Error("The operation was aborted due to timeout");
      }
      return new Response("nope", { status: 404 });
    });
    const config = { endpoint: "http://searxng:8080" };
    const empty = await adapter.fetch(config, { query: "empty" });
    expect(empty.evidence).toEqual([]);
    expect(empty.errors).toEqual([]);
    const html = await adapter.fetch(config, { query: "html" });
    expect(html.errors[0]?.class).toBe("malformed");
    const large = await adapter.fetch(config, { query: "large" });
    expect(large.errors[0]?.class).toBe("too_large");
    const retry = await adapter.fetch(config, { query: "retry" });
    expect(retry.errors[0]?.class).toBe("rate_limited");
    expect(retry.errors[0]?.message).toContain("Retry-After 12");
    const norat = await adapter.fetch(config, { query: "norat" });
    expect(norat.errors[0]?.class).toBe("rate_limited");
    expect(norat.errors[0]?.message).toBe("SearXNG HTTP 429");
    const fail = await adapter.fetch(config, { query: "fail" });
    expect(fail.errors[0]?.class).toBe("unavailable");
    const abort = await adapter.fetch(config, { query: "abort" });
    expect(abort.errors[0]?.class).toBe("timeout");
  });

  it("parses an engine allowlist and drops names past the bound", () => {
    expect(parseSearxngEngines("bing news, reuters")).toEqual(["bing news", "reuters"]);
    expect(parseSearxngEngines("")).toEqual([]);
    expect(() => parseSearxngEngines("bad;engine")).toThrow(/Invalid SearXNG engine/);
    const many = Array.from({ length: MAX_SEARXNG_ENGINES + 4 }, (_, index) => `engine${index}`);
    expect(parseSearxngEngines(many)).toHaveLength(MAX_SEARXNG_ENGINES);
  });
});
