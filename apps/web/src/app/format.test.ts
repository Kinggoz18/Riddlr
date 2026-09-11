import { describe, expect, it } from "vitest";
import {
  auditActionLabel,
  auditResourceLabel,
  candidateKindLabel,
  editClockHour,
  epistemicStatusLabel,
  eventStatusLabel,
  formatClockHour,
  objectiveLabel,
  parseClockHour,
  scheduleLabel,
} from "./format.js";

describe("clock hour formatting", () => {
  it("inserts a colon while typing 24-hour values", () => {
    expect(editClockHour("2")).toBe("2");
    expect(editClockHour("22")).toBe("22");
    expect(editClockHour("220")).toBe("22:0");
    expect(editClockHour("2200")).toBe("22:00");
  });

  it("normalizes typed hours to HH:00 including am/pm", () => {
    expect(formatClockHour("22")).toBe("22:00");
    expect(formatClockHour("7")).toBe("07:00");
    expect(formatClockHour("10pm")).toBe("22:00");
    expect(formatClockHour("12am")).toBe("00:00");
    expect(parseClockHour("07:00")).toBe(7);
  });
});

describe("agent labels", () => {
  it("humanizes objective ids and schedules", () => {
    expect(objectiveLabel("risk_signals")).toBe("Risk signals");
    expect(objectiveLabel("potential_opportunities")).toBe("Potential opportunities");
    expect(objectiveLabel("unknown_goal")).toBe("unknown goal");
    expect(scheduleLabel("1h")).toBe("Every hour");
    expect(scheduleLabel("daily")).toBe("Once a day");
  });

  it("humanizes audit actions and shortens UUID resources", () => {
    expect(auditActionLabel("auth.totp_enabled")).toBe("Authenticator enabled");
    expect(auditActionLabel("agent.create")).toBe("Agent created");
    expect(auditActionLabel("audit.cleared")).toBe("Audit log cleared");
    expect(auditActionLabel("custom.thing")).toBe("Custom Thing");
    expect(auditResourceLabel("7c9e6679-7425-40de-944b-e07fc1f90ae7")).toBe("7c9e6679");
    expect(auditResourceLabel("2")).toBe("2");
  });

  it("labels discovery statuses without treating them as trades", () => {
    expect(eventStatusLabel("candidate")).toBe("Candidate");
    expect(epistemicStatusLabel("discovered")).toBe("Discovered");
    expect(epistemicStatusLabel("observed")).toBe("Observed");
    expect(epistemicStatusLabel("confirmed")).toBe("Confirmed");
    expect(candidateKindLabel("potential_opportunity")).toBe("Potential opportunity");
  });
});
