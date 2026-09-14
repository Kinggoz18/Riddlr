import { describe, expect, it } from "vitest";
import {
  assetPagePath,
  MORNING_LAST_VISIT_KEY,
  readMorningSince,
  stampMorningVisit,
} from "./morning.js";

describe("morning visit window", () => {
  it("encodes asset canonical ids for the desk route", () => {
    expect(assetPagePath("coingecko:bitcoin")).toBe("/assets/coingecko%3Abitcoin");
  });

  it("reads a stored last visit and ignores missing storage", () => {
    const store = new Map<string, string>();
    expect(readMorningSince({ getItem: (key) => store.get(key) ?? null })).toBeUndefined();
    stampMorningVisit(
      { setItem: (key, value) => store.set(key, value) },
      new Date("2026-09-14T12:00:00.000Z"),
    );
    expect(store.get(MORNING_LAST_VISIT_KEY)).toBe("2026-09-14T12:00:00.000Z");
    expect(readMorningSince({ getItem: (key) => store.get(key) ?? null })).toBe(
      "2026-09-14T12:00:00.000Z",
    );
  });
});
