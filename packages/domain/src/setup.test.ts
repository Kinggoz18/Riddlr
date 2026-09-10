import { describe, expect, it } from "vitest";
import { nextSetupStep, parseScheduleMs, scanWindowStart } from "./setup.js";

describe("schedules", () => {
  it("parses named and compact durations", () => {
    expect(parseScheduleMs("30m")).toBe(30 * 60 * 1000);
    expect(parseScheduleMs("1h")).toBe(60 * 60 * 1000);
    expect(parseScheduleMs("daily")).toBe(24 * 60 * 60 * 1000);
    expect(parseScheduleMs("90m")).toBe(90 * 60 * 1000);
    expect(parseScheduleMs("3h")).toBe(3 * 60 * 60 * 1000);
  });

  it("rejects unknown schedules", () => {
    expect(() => parseScheduleMs("weekly")).toThrow(/Invalid schedule/);
  });

  it("floors scan windows to the schedule interval", () => {
    const now = new Date("2026-09-10T15:44:00.000Z");
    expect(scanWindowStart("1h", now).toISOString()).toBe("2026-09-10T15:00:00.000Z");
    expect(scanWindowStart("30m", now).toISOString()).toBe("2026-09-10T15:30:00.000Z");
  });
});

describe("setup step machine", () => {
  it("advances through four steps then completes", () => {
    expect(nextSetupStep("admin")).toBe("security");
    expect(nextSetupStep("security")).toBe("llm");
    expect(nextSetupStep("llm")).toBe("domains_sources");
    expect(nextSetupStep("domains_sources")).toBe("complete");
    expect(nextSetupStep("complete")).toBe("complete");
  });
});
