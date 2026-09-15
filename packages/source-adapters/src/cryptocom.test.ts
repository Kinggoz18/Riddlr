import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createCryptoComAdapter, parseCryptoComTickers } from "./cryptocom.js";
import { classifyHttpStatus } from "./types.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/cryptocom");

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as unknown;
}

const fetchedAt = new Date("2026-09-15T07:29:06.000Z");

describe("Crypto.com Exchange public ticker adapter", () => {
  it("parses a captured BTC_USD ticker without treating it as a trade signal", () => {
    const parsed = parseCryptoComTickers(readJson("get-tickers-btc-usd.json"), fetchedAt);
    expect(parsed.errors).toEqual([]);
    expect(parsed.evidence[0]?.adapterPayload?.canonicalId).toBe("coingecko:bitcoin");
    expect(parsed.evidence[0]?.adapterPayload?.priceUsd).toBe(77257.8);
    expect(parsed.evidence[0]?.adapterPayload?.change24h).toBeCloseTo(-0.56);
    expect(parsed.evidence[0]?.publishedAt).toEqual(new Date(1_789_457_345_303));
  });

  it("classifies an empty data array as malformed", () => {
    const parsed = parseCryptoComTickers(readJson("get-tickers-empty.json"), fetchedAt);
    expect(parsed.evidence).toEqual([]);
    expect(parsed.errors[0]?.class).toBe("malformed");
  });

  it("classifies an empty object as malformed", () => {
    const parsed = parseCryptoComTickers(readJson("get-tickers-empty-object.json"), fetchedAt);
    expect(parsed.evidence).toEqual([]);
    expect(parsed.errors[0]?.class).toBe("malformed");
  });

  it("classifies a captured row missing last price as malformed", () => {
    const parsed = parseCryptoComTickers(
      readJson("get-tickers-drift-missing-last.json"),
      fetchedAt,
    );
    expect(parsed.evidence).toEqual([]);
    expect(parsed.errors[0]?.class).toBe("malformed");
  });

  it("classifies HTTP 429 as rate_limited and HTML 200 as malformed", async () => {
    expect(classifyHttpStatus(429)).toBe("rate_limited");
    const limited = createCryptoComAdapter(
      async () => new Response("rate limited", { status: 429 }),
    );
    const limitedResult = await limited.fetch({ instruments: ["BTC_USD"] }, { query: "" });
    expect(limitedResult.errors[0]?.class).toBe("rate_limited");
    const html = createCryptoComAdapter(
      async () =>
        new Response("<html>ok</html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    const htmlResult = await html.fetch({ instruments: ["BTC_USD"] }, { query: "" });
    expect(htmlResult.errors[0]?.class).toBe("malformed");
  });
});
