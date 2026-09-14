import { describe, expect, it } from "vitest";
import {
  BINANCE_FUNDING_PERIOD_HOURS,
  clampPageSize,
  clampPositiveInt,
  DEFAULT_DEFILLAMA_INTERVAL_MS,
  DEFAULT_DETECTOR_ABS_Z,
  DEFAULT_DETECTOR_WINDOW,
  DEFAULT_FEED_POLL_INTERVAL_SECONDS,
  DEFAULT_FUNDING_DIVERGENCE_APR_PCT,
  DEFAULT_FUTURES_INTERVAL_MS,
  DEFAULT_LIQUIDATION_BURST_USD,
  DEFAULT_OBSERVE_PRICE_INTERVAL_SECONDS,
  DEFAULT_OI_CHANGE_PCT,
  DEFAULT_PAGE_SIZE,
  DEFAULT_PEG_DEVIATION_PCT,
  DEFAULT_REGISTRY_TOP_N,
  DEFAULT_TVL_DRAWDOWN_FLOOR_USD,
  DEFAULT_TVL_DRAWDOWN_PCT,
  HOURS_PER_YEAR,
  HYPERLIQUID_FUNDING_PERIOD_HOURS,
  MAX_ASSETS_PER_DOCUMENT,
  MAX_BINANCE_OI_SYMBOLS,
  MAX_BINANCE_WS_BUFFER,
  MAX_CATALYST_KINDS,
  MAX_DEFILLAMA_BODY_BYTES,
  MAX_DEFILLAMA_CHAIN_SLUGS,
  MAX_DEFILLAMA_HACKS_PER_POLL,
  MAX_DEFILLAMA_PROTOCOL_FETCHES,
  MAX_FEED_BODY_BYTES,
  MAX_FEED_ITEMS,
  MAX_FEED_POLL_INTERVAL_SECONDS,
  MAX_HYPERLIQUID_UNIVERSE,
  MAX_OBSERVATIONS_PER_POLL,
  MAX_OBSERVE_SUBJECTS,
  MAX_PAGE_SIZE,
  MAX_REGISTRY_TOP_N,
  MAX_SEARXNG_ASSET_QUERIES,
  MAX_SEARXNG_BODY_BYTES,
  MAX_SEARXNG_ENGINES,
  MIN_FEED_POLL_INTERVAL_SECONDS,
  parsePageCursor,
  takeBounded,
} from "./limits.js";

describe("bounded resource limits", () => {
  it("clamps page size to the documented 1–100 range", () => {
    expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize("12")).toBe(12);
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(10_000)).toBe(MAX_PAGE_SIZE);
  });

  it("does not keep more items than the explicit bound", () => {
    const items = Array.from({ length: 10_000 }, (_, index) => index);
    expect(takeBounded(items, 25)).toHaveLength(25);
    expect(takeBounded(items, 25).at(-1)).toBe(24);
  });

  it("caps worker concurrency at the configured maximum", () => {
    expect(clampPositiveInt(99, 2, 8)).toBe(8);
    expect(clampPositiveInt("3", 2, 8)).toBe(3);
  });

  it("parses a page cursor or rejects invalid dates", () => {
    expect(parsePageCursor("2026-09-11T07:00:00.000Z")?.toISOString()).toBe(
      "2026-09-11T07:00:00.000Z",
    );
    expect(parsePageCursor("not-a-date")).toBeUndefined();
    expect(parsePageCursor()).toBeUndefined();
  });

  it("keeps the CoinGecko registry seed at the documented top-N bound", () => {
    expect(DEFAULT_REGISTRY_TOP_N).toBe(1_000);
    expect(MAX_REGISTRY_TOP_N).toBe(2_000);
    expect(MAX_ASSETS_PER_DOCUMENT).toBe(12);
    expect(clampPositiveInt(5_000, DEFAULT_REGISTRY_TOP_N, MAX_REGISTRY_TOP_N)).toBe(2_000);
    expect(DEFAULT_OBSERVE_PRICE_INTERVAL_SECONDS).toBe(60);
    expect(MAX_OBSERVE_SUBJECTS).toBe(4_000);
    expect(DEFAULT_DETECTOR_WINDOW).toBe(20);
    expect(DEFAULT_DETECTOR_ABS_Z).toBe(3);
    expect(MAX_CATALYST_KINDS).toBe(32);
    expect(DEFAULT_FEED_POLL_INTERVAL_SECONDS).toBe(300);
    expect(MIN_FEED_POLL_INTERVAL_SECONDS).toBe(60);
    expect(MAX_FEED_POLL_INTERVAL_SECONDS).toBe(3_600);
    expect(MAX_FEED_BODY_BYTES).toBe(2_000_000);
    expect(MAX_FEED_ITEMS).toBe(50);
    expect(MAX_SEARXNG_ASSET_QUERIES).toBe(12);
    expect(MAX_SEARXNG_BODY_BYTES).toBe(1_000_000);
    expect(MAX_SEARXNG_ENGINES).toBe(16);
    expect(MAX_DEFILLAMA_BODY_BYTES).toBe(5_000_000);
    expect(MAX_DEFILLAMA_PROTOCOL_FETCHES).toBe(16);
    expect(MAX_DEFILLAMA_CHAIN_SLUGS).toBe(8);
    expect(MAX_DEFILLAMA_HACKS_PER_POLL).toBe(50);
    expect(DEFAULT_DEFILLAMA_INTERVAL_MS).toBe(15 * 60 * 1000);
    expect(DEFAULT_TVL_DRAWDOWN_PCT).toBe(15);
    expect(DEFAULT_TVL_DRAWDOWN_FLOOR_USD).toBe(1_000_000);
    expect(DEFAULT_PEG_DEVIATION_PCT).toBe(1);
    expect(DEFAULT_FUTURES_INTERVAL_MS).toBe(60_000);
    expect(DEFAULT_OI_CHANGE_PCT).toBe(20);
    expect(DEFAULT_FUNDING_DIVERGENCE_APR_PCT).toBe(10);
    expect(DEFAULT_LIQUIDATION_BURST_USD).toBe(10_000_000);
    expect(HOURS_PER_YEAR).toBe(8760);
    expect(HYPERLIQUID_FUNDING_PERIOD_HOURS).toBe(1);
    expect(BINANCE_FUNDING_PERIOD_HOURS).toBe(8);
    expect(MAX_HYPERLIQUID_UNIVERSE).toBe(512);
    expect(MAX_BINANCE_OI_SYMBOLS).toBe(40);
    expect(MAX_BINANCE_WS_BUFFER).toBe(256);
    expect(MAX_OBSERVATIONS_PER_POLL).toBe(12_000);
  });
});
