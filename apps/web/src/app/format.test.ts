import { DEFAULT_DAILY_TOKEN_BUDGET as domainDefault } from "@riddlr/domain";
import { describe, expect, it } from "vitest";
import {
  adapterLabel,
  assetLabel,
  auditActionLabel,
  auditResourceLabel,
  candidateKindLabel,
  catalystKindLabel,
  compactMoney,
  DEFAULT_DAILY_TOKEN_BUDGET,
  editClockHour,
  epistemicStatusLabel,
  eventStatusLabel,
  formatClockHour,
  formatSpotQuote,
  MAX_DAILY_TOKEN_BUDGET,
  MIN_DAILY_TOKEN_BUDGET,
  objectiveLabel,
  parseClockHour,
  reliabilityStatusLabel,
  scheduleLabel,
  tokenBudgetLabel,
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
    expect(tokenBudgetLabel(null)).toBe("Unlimited");
    expect(tokenBudgetLabel(100_000)).toBe((100_000).toLocaleString());
    expect(DEFAULT_DAILY_TOKEN_BUDGET).toBe(domainDefault);
    expect(MIN_DAILY_TOKEN_BUDGET).toBe(500);
    expect(MAX_DAILY_TOKEN_BUDGET).toBe(200_000);
  });

  it("humanizes audit actions and shortens UUID resources", () => {
    expect(auditActionLabel("setup.admin")).toBe("Administrator created");
    expect(auditActionLabel("setup.unlock")).toBe("Setup code accepted");
    expect(auditActionLabel("agent.create")).toBe("Agent created");
    expect(auditActionLabel("audit.cleared")).toBe("Audit log cleared");
    expect(auditActionLabel("settings.email")).toBe("Email transport saved");
    expect(auditActionLabel("custom.thing")).toBe("Custom Thing");
    expect(auditResourceLabel("7c9e6679-7425-40de-944b-e07fc1f90ae7")).toBe("7c9e6679");
    expect(auditResourceLabel("2")).toBe("2");
  });

  it("labels discovery statuses without treating them as trades", () => {
    expect(eventStatusLabel("candidate")).toBe("Candidate");
    expect(epistemicStatusLabel("discovered")).toBe("Discovered");
    expect(epistemicStatusLabel("observed")).toBe("Observed");
    expect(epistemicStatusLabel("confirmed")).toBe("Confirmed");
    expect(reliabilityStatusLabel("observed")).toBe("Observed");
    expect(reliabilityStatusLabel("single_source")).toBe("Single source");
    expect(candidateKindLabel("potential_opportunity")).toBe("Potential opportunity");
    expect(catalystKindLabel("observed_anomaly")).toBe("Observed anomaly");
    expect(catalystKindLabel("listing_or_delisting")).toBe("Listing or delisting");
    expect(adapterLabel("feeds")).toBe("RSS/Atom");
    expect(adapterLabel("defillama")).toBe("DefiLlama");
    expect(adapterLabel("polymarket")).toBe("Polymarket");
    expect(adapterLabel("kalshi")).toBe("Kalshi");
    expect(adapterLabel("snapshot")).toBe("Snapshot");
  });
});

describe("asset display fallback", () => {
  it("labels catalog ids and falls back to the slug for unknown registry ids", () => {
    expect(assetLabel("coingecko:bitcoin")).toBe("Bitcoin · BTC");
    expect(assetLabel("coingecko:zcash")).toBe("zcash");
  });

  it("formats a USD spot quote without inventing a price", () => {
    expect(formatSpotQuote(undefined)).toBeUndefined();
    expect(formatSpotQuote(Number.NaN)).toBeUndefined();
    expect(formatSpotQuote(77333, "usd")).toBe(compactMoney.format(77333));
  });
});
