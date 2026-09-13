import { describe, expect, it } from "vitest";
import { enrichPublicDocument } from "./enrich.js";
import { pathDisallowedByRobots } from "./robots.js";

describe("document enrichment", () => {
  it("parses robots disallow rules", () => {
    expect(pathDisallowedByRobots("User-agent: *\nDisallow: /private", "/private/x")).toBe(true);
    expect(pathDisallowedByRobots("User-agent: *\nDisallow: /private", "/news")).toBe(false);
  });

  it("extracts main HTML and refuses robots-denied paths", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
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
  });
});
