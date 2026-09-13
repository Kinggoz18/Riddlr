import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createCoinGeckoAdapter,
  joinCoinGeckoRegistry,
  parseCoinGeckoMarkets,
  parseCoinGeckoRegistryList,
  parseCoinGeckoRegistryMarkets,
} from "./coingecko.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/coingecko");

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as unknown;
}

describe("CoinGecko market-data adapter", () => {
  it("parses official markets rows with price, volume, and market cap", () => {
    const parsed = parseCoinGeckoMarkets(
      [
        {
          id: "bitcoin",
          symbol: "btc",
          name: "Bitcoin",
          current_price: 64000,
          market_cap: 1,
          total_volume: 2,
          last_updated: "2026-09-10T00:00:00.000Z",
        },
      ],
      new Date("2026-09-10T00:00:00Z"),
    );
    expect(parsed.evidence[0]?.adapterPayload?.canonicalId).toBe("coingecko:bitcoin");
    expect(parsed.evidence[0]?.adapterPayload?.priceUsd).toBe(64000);
    expect(parsed.evidence[0]?.bodyText).toContain("USD 64000");
  });

  it("joins a captured markets page with the truncated coins list", () => {
    const markets = parseCoinGeckoRegistryMarkets(readJson("markets-page1.json"));
    const list = parseCoinGeckoRegistryList(readJson("coins-list-truncated.json"));
    expect(markets.error).toBeUndefined();
    expect(list.error).toBeUndefined();
    expect(markets.rows[0]?.id).toBe("bitcoin");
    expect(markets.rows[0]?.marketCapRank).toBe(1);
    const joined = joinCoinGeckoRegistry(markets.rows, list.rows, 5);
    expect(joined.map((item) => item.id)).toEqual([
      "bitcoin",
      "ethereum",
      "tether",
      "binancecoin",
      "ripple",
    ]);
    expect(joined.find((item) => item.id === "tether")?.platforms.ethereum).toMatch(/^0x/i);
  });

  it("keeps the first CoinGecko id when a markets page repeats it", () => {
    const markets = parseCoinGeckoRegistryMarkets([
      { id: "bitcoin", symbol: "btc", name: "Bitcoin", market_cap_rank: 1 },
      { id: "bitcoin", symbol: "btc", name: "Bitcoin duplicate", market_cap_rank: 99 },
    ]);
    const joined = joinCoinGeckoRegistry(markets.rows, [], 10);
    expect(joined.map((item) => item.id)).toEqual(["bitcoin"]);
  });

  it("rejects an HTML body at the registry parser", () => {
    const parsed = parseCoinGeckoRegistryMarkets("<html>blocked</html>");
    expect(parsed.rows).toEqual([]);
    expect(parsed.error?.class).toBe("malformed");
  });

  it("treats an empty list as zero rows, not zeros invented as prices", () => {
    const parsed = parseCoinGeckoRegistryMarkets(readJson("empty.json"));
    expect(parsed.rows).toEqual([]);
    expect(parsed.error).toBeUndefined();
  });

  it("fails closed on a captured malformed error object", () => {
    const parsed = parseCoinGeckoRegistryMarkets(readJson("invalid-vs-currency.json"));
    expect(parsed.rows).toEqual([]);
    expect(parsed.error?.class).toBe("malformed");
  });

  it("skips a drifted markets row that lost its id", () => {
    const parsed = parseCoinGeckoRegistryMarkets(readJson("markets-drift-missing-id.json"));
    expect(parsed.rows).toEqual([]);
    expect(parsed.skipped).toBe(1);
  });

  it("classifies HTTP 429 as rate limited without writing rows", async () => {
    const adapter = createCoinGeckoAdapter(
      async () => new Response("rate limited", { status: 429 }),
    );
    const result = await adapter.fetch({ assetIds: ["bitcoin"] }, { query: "coingecko:bitcoin" });
    expect(result.evidence).toEqual([]);
    expect(result.errors[0]?.class).toBe("rate_limited");
  });
});
