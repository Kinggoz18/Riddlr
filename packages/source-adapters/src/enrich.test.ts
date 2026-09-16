import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { enrichPublicDocument } from "./enrich.js";
import { pathDisallowedByRobots } from "./robots.js";
import { RIDDLR_HTTP_USER_AGENT } from "./user-agent.js";

const reutersRobots = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/robots/reuters-robots.txt"),
  "utf8",
);

describe("document enrichment", () => {
  it("parses robots disallow rules with path-boundary matching", () => {
    expect(pathDisallowedByRobots("User-agent: *\nDisallow: /private", "/private/x")).toBe(true);
    expect(pathDisallowedByRobots("User-agent: *\nDisallow: /private", "/news")).toBe(false);
    expect(pathDisallowedByRobots("User-agent: *\nDisallow: /fr", "/from-the-editor")).toBe(false);
    expect(pathDisallowedByRobots("User-agent: *\nDisallow: /fr", "/fr/monde")).toBe(true);
  });

  it("honors Allow, longest-match, and a Riddlr user-agent group", () => {
    const txt = [
      "User-agent: Riddlr",
      "Allow: /news/",
      "Disallow: /",
      "",
      "User-agent: *",
      "Disallow: /",
    ].join("\n");
    expect(pathDisallowedByRobots(txt, "/news/bitcoin", "Riddlr/0.1.0")).toBe(false);
    expect(pathDisallowedByRobots(txt, "/world/shipwreck", "Riddlr")).toBe(true);
    expect(pathDisallowedByRobots("User-agent: *\nAllow: /plus/\nDisallow: /", "/plus/story")).toBe(
      false,
    );
  });

  it("applies the Reuters robots.txt * group to Riddlr", () => {
    expect(pathDisallowedByRobots(reutersRobots, "/world/us-cryptocurrency-bill")).toBe(true);
    expect(pathDisallowedByRobots(reutersRobots, "/plus/markets")).toBe(false);
    expect(pathDisallowedByRobots(reutersRobots, "/from-the-editor")).toBe(true);
  });

  it("extracts main HTML and refuses robots-denied paths", async () => {
    const seenAgents: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const ua = headers.get("user-agent");
      if (ua) {
        seenAgents.push(ua);
      }
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nDisallow: /secret", { status: 200 });
      }
      return new Response(
        "<html><head><title>Bitcoin ETF inflows</title></head><body><article><p>Bitcoin ETF inflows rose after the latest issuer filing covering US listed products.</p></article></body></html>",
        { status: 200, headers: { "content-type": "text/html" } },
      );
    };
    const denied = await enrichPublicDocument({
      url: "https://example.com/secret",
      fetchImpl,
      skipDns: true,
    });
    expect(denied.status).toBe("robots_denied");
    const ok = await enrichPublicDocument({
      url: "https://example.com/bitcoin-etf",
      fetchImpl,
      skipDns: true,
    });
    expect(ok.status).toBe("extracted");
    expect(ok.cleanedText).toContain("Bitcoin ETF inflows rose");
    expect(ok.completeness).toBe("full_document");
    expect(seenAgents.every((item) => item === RIDDLR_HTTP_USER_AGENT)).toBe(true);
    expect(seenAgents.length).toBeGreaterThan(0);
  });

  it("does not fetch robots.txt or the page when a cached deny applies", async () => {
    const fetched: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      fetched.push(String(input));
      return new Response("should not fetch", { status: 500 });
    };
    const denied = await enrichPublicDocument({
      url: "https://www.reuters.com/world/us-cryptocurrency-bill",
      fetchImpl,
      skipDns: true,
      cachedRobotsTxt: reutersRobots,
    });
    expect(denied.status).toBe("robots_denied");
    expect(fetched).toEqual([]);
  });
});
