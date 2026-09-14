import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyHttpStatus } from "../types.js";
import {
  createKalshiProvider,
  KALSHI_PROVIDER_ID,
  kalshiMarketOpen,
  parseKalshiMarket,
  parseKalshiMarketsPage,
  parseKalshiOrderbook,
  parseKalshiSeries,
  parseMarketTickers,
} from "./kalshi.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../../test/fixtures/kalshi");

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as unknown;
}

const fetchedAt = new Date("2026-09-14T16:56:00.000Z");

describe("Kalshi observation provider", () => {
  it("parses captured KXCPI series category Economics", () => {
    const parsed = parseKalshiSeries(readJson("series-kxcpi.json"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.ticker).toBe("KXCPI");
    expect(parsed.category).toBe("Economics");
    expect(parsed.title).toBe("CPI");
  });

  it("accepts a captured market ticker that includes a decimal threshold", () => {
    expect(parseMarketTickers(["KXCPI-26SEP-T0.6"])).toEqual(["KXCPI-26SEP-T0.6"]);
  });

  it("mids captured yes bid/ask dollars and keeps status active as open", () => {
    const page = parseKalshiMarketsPage(readJson("markets-kxcpi-truncated.json"));
    expect(page.errors).toEqual([]);
    const market = page.markets[0];
    expect(market?.ticker).toBe("KXCPI-26SEP-T0.6");
    expect(kalshiMarketOpen(market?.status ?? "")).toBe(true);
    expect(market?.oddsYes).toBeCloseTo(0.175, 10);
    expect(market?.volume).toBe(55474.97);
    expect(market?.liquidityUsd).toBe(0);
  });

  it("mids a captured orderbook from best yes bid and implied ask", () => {
    const parsed = parseKalshiOrderbook(readJson("orderbook-kxcpi-26sep-t0.6.json"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.oddsYes).toBeCloseTo(0.175, 10);
  });

  it("classifies a captured market missing yes bid/ask as malformed", () => {
    const parsed = parseKalshiMarket(
      (readJson("market-drift-missing-bid.json") as { markets: unknown[] }).markets[0],
    );
    expect(parsed.errors[0]?.class).toBe("malformed");
    expect(parsed.errors[0]?.message).toContain("yes bid/ask");
  });

  it("classifies a captured unknown series body as not an object ticker", () => {
    const parsed = parseKalshiSeries(readJson("series-unknown.json"));
    expect(parsed.ticker).toBeUndefined();
    expect(parsed.errors[0]?.class).toBe("malformed");
  });

  it("returns no markets for the documented empty list", () => {
    const parsed = parseKalshiMarketsPage(readJson("empty-markets.json"));
    expect(parsed.markets).toEqual([]);
    expect(parsed.errors).toEqual([]);
  });

  it("classifies an empty object markets body as malformed", () => {
    const parsed = parseKalshiMarketsPage(readJson("empty-object.json"));
    expect(parsed.markets).toEqual([]);
    expect(parsed.errors[0]?.class).toBe("malformed");
  });

  it("polls a pinned KXCPI series through captured series and markets bodies", async () => {
    const series = readJson("series-kxcpi.json");
    const markets = readJson("markets-kxcpi-truncated.json");
    const provider = createKalshiProvider({
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/series/KXCPI")) {
          return Response.json(series);
        }
        if (url.includes("/markets?")) {
          return Response.json(markets);
        }
        return new Response("not found", { status: 404 });
      },
      minIntervalMs: 0,
    });
    const result = await provider.observe(
      { seriesTickers: ["KXCPI"] },
      { subjectCanonicalIds: ["kalshi:KXCPI-26SEP-T0.6"], observedAt: fetchedAt },
    );
    expect(result.errors).toEqual([]);
    expect(
      result.observations.some(
        (item) =>
          item.provider === KALSHI_PROVIDER_ID &&
          item.metric === "odds_yes" &&
          item.subjectCanonicalId === "kalshi:KXCPI-26SEP-T0.6" &&
          item.value === 0.175,
      ),
    ).toBe(true);
    expect(
      result.observations.some((item) => item.metric === "volume" && item.value === 55474.97),
    ).toBe(true);
  });

  it("marks a captured 404 series as capability_missing and writes no zeros", async () => {
    const unknown = readJson("series-unknown.json");
    const provider = createKalshiProvider({
      fetchImpl: async () => Response.json(unknown, { status: 404 }),
      minIntervalMs: 0,
    });
    const result = await provider.observe(
      { seriesTickers: ["KXCPI"] },
      { subjectCanonicalIds: [], observedAt: fetchedAt },
    );
    expect(result.observations).toEqual([]);
    expect(result.errors[0]?.class).toBe("capability_missing");
    expect(classifyHttpStatus(429)).toBe("rate_limited");
  });
});
