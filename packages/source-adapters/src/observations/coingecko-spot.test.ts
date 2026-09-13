import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyHttpStatus } from "../types.js";
import {
  COINGECKO_SPOT_PROVIDER_ID,
  createCoinGeckoSpotProvider,
  parseCoinGeckoSimplePrice,
} from "./coingecko-spot.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../../test/fixtures/coingecko");

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as unknown;
}

const fetchedAt = new Date("2026-09-13T17:54:54.000Z");

describe("CoinGecko simple/price observation provider", () => {
  it("maps a captured simple/price body onto spot, volume, cap, and 24h change", () => {
    const parsed = parseCoinGeckoSimplePrice(
      readJson("simple-price.json"),
      ["bitcoin", "ethereum", "tether"],
      fetchedAt,
    );
    expect(parsed.errors).toEqual([]);
    const btc = parsed.observations.filter(
      (item) => item.subjectCanonicalId === "coingecko:bitcoin",
    );
    expect(btc.find((item) => item.metric === "spot_price")).toEqual({
      provider: COINGECKO_SPOT_PROVIDER_ID,
      metric: "spot_price",
      subjectCanonicalId: "coingecko:bitcoin",
      value: 77333,
      unit: "usd",
      observedAt: new Date(1_789_322_000 * 1000),
      providerLastUpdatedAt: new Date(1_789_322_000 * 1000),
      stale: false,
    });
    expect(btc.find((item) => item.metric === "quoted_volume")?.value).toBe(15_935_284_654.178051);
    expect(btc.find((item) => item.metric === "quoted_market_cap")?.value).toBe(
      1_553_095_111_847.2744,
    );
    expect(btc.find((item) => item.metric === "price_change_24h")?.unit).toBe("percent");
    expect(parsed.observations.filter((item) => item.metric === "spot_price")).toHaveLength(3);
  });

  it("treats an empty object as zero rows, not invented zeros", () => {
    const parsed = parseCoinGeckoSimplePrice(
      readJson("simple-price-empty.json"),
      ["bitcoin"],
      fetchedAt,
    );
    expect(parsed.observations).toEqual([]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.partial).toBe(true);
  });

  it("skips a captured row whose usd field drifted away", () => {
    const parsed = parseCoinGeckoSimplePrice(
      readJson("simple-price-drift-missing-usd.json"),
      ["bitcoin", "ethereum", "tether"],
      fetchedAt,
    );
    expect(
      parsed.observations.some(
        (item) => item.subjectCanonicalId === "coingecko:bitcoin" && item.metric === "spot_price",
      ),
    ).toBe(false);
    expect(
      parsed.observations.some(
        (item) => item.subjectCanonicalId === "coingecko:ethereum" && item.metric === "spot_price",
      ),
    ).toBe(true);
    expect(parsed.partial).toBe(true);
  });

  it("classifies the captured missing vs_currencies object as malformed", () => {
    const parsed = parseCoinGeckoSimplePrice(
      readJson("simple-price-invalid.json"),
      ["bitcoin"],
      fetchedAt,
    );
    expect(parsed.observations).toEqual([]);
    expect(parsed.errors[0]?.class).toBe("malformed");
  });

  it("rejects an HTML body", () => {
    const parsed = parseCoinGeckoSimplePrice("<html>blocked</html>", ["bitcoin"], fetchedAt);
    expect(parsed.observations).toEqual([]);
    expect(parsed.errors[0]?.class).toBe("malformed");
  });

  it("uses HTTP status for 429", async () => {
    const provider = createCoinGeckoSpotProvider({
      fetchImpl: async () => new Response("rate limited", { status: 429 }),
    });
    const result = await provider.observe(
      {},
      {
        subjectCanonicalIds: ["coingecko:bitcoin"],
        observedAt: fetchedAt,
      },
    );
    expect(result.observations).toEqual([]);
    expect(result.errors[0]?.class).toBe("rate_limited");
    expect(classifyHttpStatus(429)).toBe("rate_limited");
  });

  it("does not follow redirects", async () => {
    const provider = createCoinGeckoSpotProvider({
      fetchImpl: async () =>
        new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
    });
    const result = await provider.observe(
      {},
      {
        subjectCanonicalIds: ["coingecko:bitcoin"],
        observedAt: fetchedAt,
      },
    );
    expect(result.observations).toEqual([]);
    expect(result.errors[0]?.class).toBe("unavailable");
  });
});
