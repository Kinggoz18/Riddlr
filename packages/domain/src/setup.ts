export const SETUP_STEPS = ["admin", "security", "llm", "domains_sources"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export const ONBOARDING_STEP_COUNT = 4;

export function nextSetupStep(current: SetupStep | "complete"): SetupStep | "complete" {
  if (current === "complete") {
    return "complete";
  }
  const index = SETUP_STEPS.indexOf(current);
  if (index === SETUP_STEPS.length - 1) {
    return "complete";
  }
  return SETUP_STEPS[index + 1] ?? "complete";
}

export const AGENT_KINDS = ["system_default", "user"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export const DEFAULT_AGENT_NAME = "Riddlr Intelligence Agent";

export const SCAN_STATUSES = ["queued", "running", "partial", "succeeded", "failed"] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export function parseScheduleMs(input: string, customIntervalMs?: number): number {
  if (input === "custom") {
    if (
      !customIntervalMs ||
      customIntervalMs < 5 * 60 * 1000 ||
      customIntervalMs > 24 * 60 * 60 * 1000
    ) {
      throw new Error("Custom schedule must be between 5 minutes and 24 hours.");
    }
    return customIntervalMs;
  }
  const map: Record<string, number> = {
    "30m": 30 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "2h": 2 * 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "6h": 6 * 60 * 60 * 1000,
    "12h": 12 * 60 * 60 * 1000,
    daily: 24 * 60 * 60 * 1000,
  };
  const known = map[input];
  if (known) {
    return known;
  }
  const match = /^(\d+)(m|h)$/.exec(input);
  if (!match) {
    throw new Error(`Invalid schedule: ${input}`);
  }
  const amount = Number(match[1]);
  const unit = match[2];
  return unit === "h" ? amount * 60 * 60 * 1000 : amount * 60 * 1000;
}

export const AGENT_SCHEDULES = ["30m", "1h", "2h", "4h", "6h", "12h", "daily", "custom"] as const;
export type AgentSchedule = (typeof AGENT_SCHEDULES)[number];

export function scanWindowStart(
  schedule: string,
  now = new Date(),
  customIntervalMs?: number,
): Date {
  const ms = parseScheduleMs(schedule, customIntervalMs);
  return new Date(Math.floor(now.getTime() / ms) * ms);
}
