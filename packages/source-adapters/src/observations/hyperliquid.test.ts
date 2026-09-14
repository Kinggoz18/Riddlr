import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { annualizeFundingAprPercent, decimalRateToPercent } from "@riddlr/domain";
import { describe, expect, it } from "vitest";
import { classifyHttpStatus } from "../types.js";
import {
  createHyperliquidProvider,
  HYPERLIQUID_PROVIDER_ID,
  parseMetaAndAssetCtxs,
  parsePredictedFundings,
  resolveHyperliquidSubject,
} from "./hyperliquid.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../../test/fixtures/hyperliquid");

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as unknown;
}

const fetchedAt = new Date("2026-09-14T16:00:00.000Z");
const symbolMap = { BTC: "coingecko:bitcoin", ETH: "coingecko:ethereum" };
const watched = new Set(["coingecko:bitcoin"]);

describe("Hyperliquid observation provider", () => {
  it("maps captured BTC ctxs onto watchlist bitcoin and annualises hourly funding", () => {
    const parsed = parseMetaAndAssetCtxs(readJson("meta-and-asset-ctxs.json"), {
      symbolMap,
      watched,
      fetchedAt,
    });
    expect(parsed.errors).toEqual([]);
    const btc = parsed.observations.filter(
      (item) => item.subjectCanonicalId === "coingecko:bitcoin",
    );
    expect(btc.find((item) => item.metric === "funding_rate_1h")?.value).toBe(
      decimalRateToPercent(0.0000125),
    );
    expect(btc.find((item) => item.metric === "funding_rate_apr")?.value).toBe(
      annualizeFundingAprPercent(0.0000125, 1),
    );
    expect(btc.find((item) => item.metric === "open_interest")?.value).toBe(35527.61946);
    expect(btc.find((item) => item.metric === "mark_price")?.value).toBe(78540.9);
    expect(btc.find((item) => item.metric === "open_interest_usd")?.value).toBe(
      35527.61946 * 78540.9,
    );
    expect(btc.find((item) => item.metric === "premium")?.value).toBe(
      decimalRateToPercent(-0.0003169314),
    );
    expect(btc.find((item) => item.metric === "volume_24h_usd")?.value).toBe(
      Number("2199368834.1671595573"),
    );
    expect(
      parsed.observations.some((item) => item.subjectCanonicalId === "coingecko:ethereum"),
    ).toBe(false);
  });

  it("persists unmapped coins only when pinned as hyperliquid:<COIN>", () => {
    const parsed = parseMetaAndAssetCtxs(readJson("meta-and-asset-ctxs.json"), {
      symbolMap: {},
      watched: new Set(["hyperliquid:ETH"]),
      fetchedAt,
    });
    expect(parsed.observations.every((item) => item.subjectCanonicalId === "hyperliquid:ETH")).toBe(
      true,
    );
    expect(resolveHyperliquidSubject("BTC", {}, new Set(["coingecko:bitcoin"]))).toBeUndefined();
  });

  it("maps captured predictedFundings onto annualised HL and Binance prints", () => {
    const parsed = parsePredictedFundings(readJson("predicted-fundings.json"), {
      symbolMap,
      watched,
      fetchedAt,
    });
    expect(parsed.observations.find((item) => item.metric === "funding_predicted_apr")?.value).toBe(
      annualizeFundingAprPercent(0.0000125, 1),
    );
    expect(
      parsed.observations.find((item) => item.metric === "funding_predicted_binance_apr")?.value,
    ).toBe(annualizeFundingAprPercent(0.00004005, 8));
  });

  it("classifies universe and assetCtxs length mismatch as malformed and writes no zeros", () => {
    const parsed = parseMetaAndAssetCtxs(readJson("meta-and-asset-ctxs-drift-mismatch.json"), {
      symbolMap,
      watched,
      fetchedAt,
    });
    expect(parsed.observations).toEqual([]);
    expect(parsed.errors[0]?.class).toBe("malformed");
    expect(parsed.errors[0]?.message).toContain("length mismatch");
  });

  it("treats an empty array as zero rows", () => {
    const parsed = parseMetaAndAssetCtxs(readJson("empty-array.json"), {
      symbolMap,
      watched,
      fetchedAt,
    });
    expect(parsed.observations).toEqual([]);
    expect(parsed.errors).toEqual([]);
  });

  it("rejects HTML bodies as unavailable", () => {
    const parsed = parseMetaAndAssetCtxs("<html>blocked</html>", {
      symbolMap,
      watched,
      fetchedAt,
    });
    expect(parsed.observations).toEqual([]);
    expect(parsed.errors[0]?.class).toBe("unavailable");
  });

  it("rejects a non-array body as malformed", () => {
    const parsed = parseMetaAndAssetCtxs(readJson("empty-object.json"), {
      symbolMap,
      watched,
      fetchedAt,
    });
    expect(parsed.observations).toEqual([]);
    expect(parsed.errors[0]?.class).toBe("malformed");
  });

  it("classifies HTTP 429 as rate_limited and does not follow redirects", async () => {
    const limited = createHyperliquidProvider({
      minIntervalMs: 0,
      fetchImpl: async () => new Response("rate limited", { status: 429 }),
    });
    const rate = await limited.observe(
      { symbolMap },
      { subjectCanonicalIds: ["coingecko:bitcoin"], observedAt: fetchedAt },
    );
    expect(rate.observations).toEqual([]);
    expect(rate.errors.some((item) => item.class === "rate_limited")).toBe(true);
    expect(classifyHttpStatus(429)).toBe("rate_limited");

    const redirected = createHyperliquidProvider({
      minIntervalMs: 0,
      fetchImpl: async () =>
        new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
    });
    const result = await redirected.observe(
      { symbolMap },
      { subjectCanonicalIds: ["coingecko:bitcoin"], observedAt: fetchedAt },
    );
    expect(result.errors.some((item) => item.class === "unavailable")).toBe(true);
  });

  it("polls captured meta and predicted fixtures for watched bitcoin", async () => {
    const meta = readJson("meta-and-asset-ctxs.json");
    const predicted = readJson("predicted-fundings.json");
    const provider = createHyperliquidProvider({
      minIntervalMs: 0,
      fetchImpl: async (_input, init) => {
        const body = typeof init?.body === "string" ? init.body : "";
        if (body.includes("predictedFundings")) {
          return Response.json(predicted);
        }
        return Response.json(meta);
      },
    });
    const result = await provider.observe(
      { symbolMap },
      { subjectCanonicalIds: ["coingecko:bitcoin"], observedAt: fetchedAt },
    );
    expect(result.errors).toEqual([]);
    expect(
      result.observations.some((item) => item.metric === "mark_price" && item.value === 78540.9),
    ).toBe(true);
    expect(
      result.observations.some(
        (item) =>
          item.metric === "funding_predicted_binance_apr" &&
          item.provider === HYPERLIQUID_PROVIDER_ID,
      ),
    ).toBe(true);
  });
});
