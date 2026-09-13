import { describe, expect, it } from "vitest";
import {
  clampPageSize,
  clampPositiveInt,
  DEFAULT_PAGE_SIZE,
  DEFAULT_REGISTRY_TOP_N,
  MAX_ASSETS_PER_DOCUMENT,
  MAX_PAGE_SIZE,
  MAX_REGISTRY_TOP_N,
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
  });
});
