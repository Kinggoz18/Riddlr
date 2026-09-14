import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { annualizeFundingAprPercent, decimalRateToPercent } from "@riddlr/domain";
import { describe, expect, it } from "vitest";
import { classifyHttpStatus } from "../types.js";
import {
  BINANCE_FUTURES_PROVIDER_ID,
  baseFromBinanceSymbol,
  createBinanceFuturesProvider,
  parseOpenInterest,
  parsePremiumIndex,
  parseQuoteAssets,
} from "./binance-futures.js";
import { createForceOrderAggregator, parseForceOrderFrame } from "./binance-liquidations.js";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../test/fixtures/binance-futures",
);

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as unknown;
}

const fetchedAt = new Date("2026-09-14T16:00:00.000Z");
const symbolMap = { BTC: "coingecko:bitcoin", ETH: "coingecko:ethereum" };
const watched = new Set(["coingecko:bitcoin"]);
const quotes = parseQuoteAssets(undefined);

describe("Binance USD-M futures observation provider", () => {
  it("strips configured quote assets from BTCUSDT", () => {
    expect(baseFromBinanceSymbol("BTCUSDT", quotes)).toBe("BTC");
    expect(baseFromBinanceSymbol("ETHUSDC", ["USDC", "USDT"])).toBe("ETH");
  });

  it("maps captured BTCUSDT premiumIndex onto 8h funding and annualised APR", () => {
    const parsed = parsePremiumIndex(readJson("premium-index.json"), {
      symbolMap,
      watched,
      quotes,
      fetchedAt,
    });
    const btc = parsed.observations.filter(
      (item) => item.subjectCanonicalId === "coingecko:bitcoin",
    );
    expect(btc.find((item) => item.metric === "mark_price")?.value).toBe(78732.5);
    expect(btc.find((item) => item.metric === "funding_rate_8h")?.value).toBe(
      decimalRateToPercent(0.00007015),
    );
    expect(btc.find((item) => item.metric === "funding_rate_apr")?.value).toBe(
      annualizeFundingAprPercent(0.00007015, 8),
    );
    expect(
      parsed.observations.some((item) => item.subjectCanonicalId === "coingecko:ethereum"),
    ).toBe(false);
  });

  it("classifies a captured row missing markPrice as malformed and writes no zero mark", () => {
    const parsed = parsePremiumIndex(readJson("premium-index-drift-missing-mark.json"), {
      symbolMap,
      watched,
      quotes,
      fetchedAt,
    });
    expect(parsed.observations).toEqual([]);
    expect(parsed.errors[0]?.class).toBe("malformed");
    expect(parsed.errors[0]?.message).toContain("missing markPrice");
  });

  it("maps captured openInterest onto contracts and usd notional from mark", () => {
    const parsed = parseOpenInterest(readJson("open-interest-btcusdt.json"), {
      symbol: "BTCUSDT",
      subjectCanonicalId: "coingecko:bitcoin",
      markPrice: 78732.5,
      fetchedAt,
    });
    expect(parsed.errors).toEqual([]);
    expect(parsed.observations.find((item) => item.metric === "open_interest")?.value).toBe(
      404373478.6825,
    );
    expect(parsed.observations.find((item) => item.metric === "open_interest_usd")?.value).toBe(
      404373478.6825 * 78732.5,
    );
  });

  it("classifies captured code -1121 as capability_missing for that symbol", () => {
    const parsed = parseOpenInterest(readJson("open-interest-unknown.json"), {
      symbol: "NOTACOINUSDT",
      subjectCanonicalId: "coingecko:bitcoin",
      fetchedAt,
    });
    expect(parsed.observations).toEqual([]);
    expect(parsed.errors[0]?.class).toBe("capability_missing");
  });

  it("treats an empty premiumIndex array as zero rows", () => {
    const parsed = parsePremiumIndex(readJson("empty-array.json"), {
      symbolMap,
      watched,
      quotes,
      fetchedAt,
    });
    expect(parsed.observations).toEqual([]);
    expect(parsed.errors).toEqual([]);
  });

  it("aggregates captured forceOrder frames onto liquidations_1m_usd", () => {
    const frames = readJson("force-order-frames.json") as unknown[];
    expect(parseForceOrderFrame(frames[0])?.notionalUsd).toBe(318 * 0.3946);
    const aggregator = createForceOrderAggregator();
    for (const frame of frames) {
      aggregator.push(frame);
    }
    const now = new Date(1789403543626 + 60_000);
    const observations = aggregator.drain({
      now,
      resolveSubject: (symbol) => (symbol === "LSKUSDT" ? "binance-futures:LSKUSDT" : undefined),
    });
    expect(observations).toEqual([
      {
        provider: BINANCE_FUTURES_PROVIDER_ID,
        metric: "liquidations_1m_usd",
        subjectCanonicalId: "binance-futures:LSKUSDT",
        value: 318 * 0.3946,
        unit: "usd",
        observedAt: new Date(Math.floor(1789403542611 / 60_000) * 60_000),
      },
    ]);
  });

  it("drops forceOrder frames once the buffer cap is reached", () => {
    const aggregator = createForceOrderAggregator({ maxBuffer: 1 });
    const frames = readJson("force-order-frames.json") as unknown[];
    aggregator.push(frames[0]);
    aggregator.push(frames[1]);
    expect(aggregator.size()).toBe(1);
  });

  it("classifies HTTP 429 as rate_limited, 451 as blocked, and does not follow redirects", async () => {
    const limited = createBinanceFuturesProvider({
      minIntervalMs: 0,
      fetchImpl: async () => new Response("banned", { status: 429 }),
    });
    const rate = await limited.observe(
      { symbolMap },
      { subjectCanonicalIds: ["coingecko:bitcoin"], observedAt: fetchedAt },
    );
    expect(rate.observations).toEqual([]);
    expect(rate.errors.some((item) => item.class === "rate_limited")).toBe(true);
    expect(classifyHttpStatus(429)).toBe("rate_limited");

    const geo = createBinanceFuturesProvider({
      minIntervalMs: 0,
      fetchImpl: async () => new Response("unavailable", { status: 451 }),
    });
    const blocked = await geo.observe(
      { symbolMap },
      { subjectCanonicalIds: ["coingecko:bitcoin"], observedAt: fetchedAt },
    );
    expect(blocked.errors[0]?.class).toBe("blocked");
    expect(blocked.errors[0]?.message).toContain("region");

    const redirected = createBinanceFuturesProvider({
      minIntervalMs: 0,
      fetchImpl: async () =>
        new Response(null, { status: 301, headers: { location: "https://demo.binance.com/" } }),
    });
    const result = await redirected.observe(
      { symbolMap },
      { subjectCanonicalIds: ["coingecko:bitcoin"], observedAt: fetchedAt },
    );
    expect(result.errors.some((item) => item.class === "unavailable")).toBe(true);
  });

  it("polls captured premiumIndex and openInterest without failing the poll on unknown symbols", async () => {
    const premium = readJson("premium-index.json");
    const oi = readJson("open-interest-btcusdt.json");
    const unknown = readJson("open-interest-unknown.json");
    const provider = createBinanceFuturesProvider({
      minIntervalMs: 0,
      drainLiquidations: () => [],
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/fapi/v1/premiumIndex")) {
          return Response.json(premium, { headers: { "x-mbx-used-weight-1m": "10" } });
        }
        if (url.includes("/futures/data/")) {
          return new Response(null, {
            status: 301,
            headers: { location: "https://demo.binance.com/en/futures/BTCUSDT" },
          });
        }
        if (url.includes("symbol=NOTACOINUSDT")) {
          return Response.json(unknown, { status: 400 });
        }
        if (url.includes("/fapi/v1/openInterest?symbol=BTCUSDT")) {
          return Response.json(oi);
        }
        return new Response("not found", { status: 404 });
      },
    });
    const result = await provider.observe(
      { symbolMap, lastOiAt: new Date(0).toISOString() },
      { subjectCanonicalIds: ["coingecko:bitcoin"], observedAt: fetchedAt },
    );
    expect(
      result.observations.some((item) => item.metric === "mark_price" && item.value === 78732.5),
    ).toBe(true);
    expect(
      result.observations.some(
        (item) => item.metric === "open_interest" && item.value === 404373478.6825,
      ),
    ).toBe(true);
    expect(result.persistConfig?.lastOiAt).toBe(fetchedAt.toISOString());
  });
});
