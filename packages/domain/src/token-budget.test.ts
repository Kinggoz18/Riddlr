import { describe, expect, it } from "vitest";
import {
  ANALYSIS_COMPLETION_TOKEN_RESERVE,
  analysisReservationTokens,
  boundPromptText,
  DEFAULT_DAILY_TOKEN_BUDGET,
  resolveDailyTokenBudget,
  shouldSkipForDailyTokenBudget,
  tokensFromUsageEvent,
  utcDayRange,
  utcDayStamp,
} from "./token-budget.js";

describe("daily token budget", () => {
  it("uses 100000 as the product default and treats null as unlimited", () => {
    expect(DEFAULT_DAILY_TOKEN_BUDGET).toBe(100_000);
    expect(resolveDailyTokenBudget(undefined, DEFAULT_DAILY_TOKEN_BUDGET)).toBe(100_000);
    expect(resolveDailyTokenBudget(null, DEFAULT_DAILY_TOKEN_BUDGET)).toBeNull();
    expect(resolveDailyTokenBudget(4_000, DEFAULT_DAILY_TOKEN_BUDGET)).toBe(4_000);
  });

  it("never skips analysis when the daily budget is unlimited", () => {
    expect(
      shouldSkipForDailyTokenBudget({
        budget: null,
        recordedUsageTokens: 8_000_000,
        openReservationTokens: 50_000,
        nextReservationTokens: 12_000,
      }),
    ).toBe(false);
  });

  it("skips when recorded usage plus the next reservation would exceed the cap", () => {
    expect(
      shouldSkipForDailyTokenBudget({
        budget: 8_000,
        recordedUsageTokens: 8_001,
        openReservationTokens: 0,
        nextReservationTokens: 1,
      }),
    ).toBe(true);
    expect(
      shouldSkipForDailyTokenBudget({
        budget: 8_000,
        recordedUsageTokens: 8_000,
        openReservationTokens: 0,
        nextReservationTokens: 1,
      }),
    ).toBe(true);
    expect(
      shouldSkipForDailyTokenBudget({
        budget: 8_000,
        recordedUsageTokens: 4_000,
        openReservationTokens: 0,
        nextReservationTokens: 2_048,
      }),
    ).toBe(false);
  });

  it("counts in-flight reservations toward the cap and ignores cache hits", () => {
    expect(
      shouldSkipForDailyTokenBudget({
        budget: 5_000,
        recordedUsageTokens: 2_000,
        openReservationTokens: 2_500,
        nextReservationTokens: 1_000,
      }),
    ).toBe(true);
    expect(tokensFromUsageEvent({ cacheHit: true, completionTotal: 9_000 })).toBe(0);
    expect(tokensFromUsageEvent({ promptTokens: 8_000, completionTokens: 1 })).toBe(8_001);
    expect(
      tokensFromUsageEvent({
        completionTotal: 120,
        promptTokens: 8_000,
        completionTokens: 1,
      }),
    ).toBe(120);
  });

  it("reserves estimated prompt tokens plus the completion headroom", () => {
    expect(analysisReservationTokens(0)).toBe(ANALYSIS_COMPLETION_TOKEN_RESERVE);
    expect(analysisReservationTokens(9)).toBe(3 + ANALYSIS_COMPLETION_TOKEN_RESERVE);
  });

  it("bounds UTC usage windows to one day and truncates prompt text", () => {
    expect(utcDayStamp(new Date("2026-09-11T23:15:00.000Z"))).toBe("2026-09-11");
    const range = utcDayRange("2026-09-11");
    expect(range.start.toISOString()).toBe("2026-09-11T00:00:00.000Z");
    expect(range.endExclusive.toISOString()).toBe("2026-09-12T00:00:00.000Z");
    expect(boundPromptText("abcd", 10)).toBe("abcd");
    expect(boundPromptText("abcdef", 4)).toBe("abc…");
  });
});
