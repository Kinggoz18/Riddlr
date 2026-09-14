import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyHttpStatus } from "../types.js";
import {
  createPolymarketProvider,
  parseMidpoint,
  parsePolymarketEvents,
  parsePolymarketMarket,
  parsePricesHistory,
  suggestPolymarketSlugs,
} from "./polymarket.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../../test/fixtures/polymarket");

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as unknown;
}

const fetchedAt = new Date("2026-09-14T16:55:07.000Z");

describe("Polymarket observation provider", () => {
  it("parses a captured market slug, YES token, and liquidity", () => {
    const parsed = parsePolymarketMarket(readJson("market-fed-rate-hike.json"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.market?.slug).toBe("fed-rate-hike-in-2026");
    expect(parsed.market?.closed).toBe(false);
    expect(parsed.market?.yesTokenId).toBe(
      "75028752776148090296091099469912621384650554615761384992997579209329182670110",
    );
    expect(parsed.market?.liquidityUsd).toBe(190183.1871);
  });

  it("reads the captured CLOB mid field", () => {
    const parsed = parseMidpoint(readJson("midpoint.json"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.value).toBe(0.905);
  });

  it("parses captured prices-history timestamps as unix seconds", () => {
    const parsed = parsePricesHistory(readJson("prices-history.json"), fetchedAt);
    expect(parsed.errors).toEqual([]);
    expect(parsed.points).toHaveLength(288);
    expect(parsed.points[0]).toEqual({
      observedAt: new Date(1789318514 * 1000),
      value: 0.875,
    });
    expect(parsed.points.at(-1)?.value).toBe(0.905);
  });

  it("classifies a captured market missing clobTokenIds as malformed", () => {
    const parsed = parsePolymarketMarket(readJson("market-drift-missing-tokens.json"));
    expect(parsed.market?.yesTokenId).toBeUndefined();
    expect(parsed.errors[0]?.class).toBe("malformed");
    expect(parsed.errors[0]?.message).toContain("clobTokenIds");
  });

  it("unsubscribes captured closed October Fed markets", () => {
    const events = parsePolymarketEvents(readJson("event-fed-decision-closed.json"));
    const market = events.events[0]?.markets;
    expect(Array.isArray(market)).toBe(true);
    const first = Array.isArray(market) ? market[0] : undefined;
    const parsed = parsePolymarketMarket(first);
    expect(parsed.market?.closed).toBe(true);
  });

  it("suggests captured Fed keyset markets from macro keywords", () => {
    const parsed = parsePolymarketEvents(readJson("event-fed-rate-hike.json"));
    const slugs = suggestPolymarketSlugs(parsed.events, {
      watched: new Set(["coingecko:bitcoin"]),
      hints: [{ canonicalId: "coingecko:bitcoin", symbol: "BTC", name: "Bitcoin" }],
    });
    expect(slugs).toContain("fed-rate-hike-in-2026");
  });

  it("returns no events for an empty list", () => {
    expect(parsePolymarketEvents(readJson("empty-array.json"))).toEqual({ events: [], errors: [] });
  });

  it("classifies an empty object events body as malformed", () => {
    const parsed = parsePolymarketEvents(readJson("empty-object.json"));
    expect(parsed.events).toEqual([]);
    expect(parsed.errors[0]?.class).toBe("malformed");
  });

  it("polls a pinned slug through captured Gamma and CLOB bodies", async () => {
    const market = readJson("market-fed-rate-hike.json");
    const mid = readJson("midpoint.json");
    const hist = readJson("prices-history.json");
    const keyset = readJson("events-keyset-truncated.json");
    const provider = createPolymarketProvider({
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/events/keyset")) {
          return Response.json(keyset);
        }
        if (url.includes("/markets?")) {
          return Response.json(market);
        }
        if (url.includes("/midpoint")) {
          return Response.json(mid);
        }
        if (url.includes("/prices-history")) {
          return Response.json(hist);
        }
        return new Response("not found", { status: 404 });
      },
      minIntervalMs: 0,
    });
    const result = await provider.observe(
      { marketSlugs: ["fed-rate-hike-in-2026"] },
      { subjectCanonicalIds: ["polymarket:fed-rate-hike-in-2026"], observedAt: fetchedAt },
    );
    expect(result.errors).toEqual([]);
    expect(
      result.observations.some(
        (item) =>
          item.metric === "odds_yes" &&
          item.subjectCanonicalId === "polymarket:fed-rate-hike-in-2026" &&
          item.value === 0.905,
      ),
    ).toBe(true);
    expect(
      result.observations.some(
        (item) => item.metric === "odds_liquidity_usd" && item.value === 190183.1871,
      ),
    ).toBe(true);
    expect(result.persistConfig?.backfilled).toMatchObject({ "fed-rate-hike-in-2026": true });
  });

  it("classifies 429 with Retry-After and does not write zeros", async () => {
    const provider = createPolymarketProvider({
      fetchImpl: async () =>
        new Response("slow down", { status: 429, headers: { "retry-after": "12" } }),
      minIntervalMs: 0,
    });
    const result = await provider.observe(
      { marketSlugs: ["fed-rate-hike-in-2026"] },
      { subjectCanonicalIds: [], observedAt: fetchedAt },
    );
    expect(result.observations).toEqual([]);
    expect(result.errors[0]?.class).toBe("rate_limited");
    expect(result.errors[0]?.message).toContain("Retry-After 12");
    expect(classifyHttpStatus(429)).toBe("rate_limited");
  });
});
