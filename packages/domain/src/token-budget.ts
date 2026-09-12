import { estimatePromptTokens } from "./analysis-facts.js";
import { DEFAULT_ANALYSIS_EVIDENCE_LIMIT } from "./limits.js";

export const MIN_DAILY_TOKEN_BUDGET = 500;
export const MAX_DAILY_TOKEN_BUDGET = 200_000;
export const DEFAULT_DAILY_TOKEN_BUDGET = 100_000;
export const ANALYSIS_COMPLETION_TOKEN_RESERVE = 2_048;
export const MAX_EVIDENCE_PROMPT_CHARS = 4_000;
export const MAX_ANALYSIS_EVIDENCE_PROMPT_ITEMS = DEFAULT_ANALYSIS_EVIDENCE_LIMIT;

const UTC_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type DailyTokenBudget = number | null;

export function isUnlimitedDailyTokenBudget(budget: DailyTokenBudget | undefined): budget is null {
  return budget === null;
}

export function resolveDailyTokenBudget(
  requested: DailyTokenBudget | undefined,
  fallback: DailyTokenBudget,
): DailyTokenBudget {
  return requested === undefined ? fallback : requested;
}

export function utcDayStamp(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

export function utcDayRange(dayUtc: string): { start: Date; endExclusive: Date } {
  const day = UTC_DAY_RE.test(dayUtc) ? dayUtc : utcDayStamp();
  const start = new Date(`${day}T00:00:00.000Z`);
  return { start, endExclusive: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

export function tokensFromUsageEvent(event: {
  cacheHit?: boolean | null;
  completionTotal?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
}): number {
  if (event.cacheHit) {
    return 0;
  }
  if (typeof event.completionTotal === "number" && Number.isFinite(event.completionTotal)) {
    return Math.max(0, Math.floor(event.completionTotal));
  }
  const prompt = typeof event.promptTokens === "number" ? event.promptTokens : 0;
  const completion = typeof event.completionTokens === "number" ? event.completionTokens : 0;
  return Math.max(0, Math.floor(prompt) + Math.floor(completion));
}

export function analysisReservationTokens(promptChars: number): number {
  return Math.max(1, estimatePromptTokens(promptChars) + ANALYSIS_COMPLETION_TOKEN_RESERVE);
}

export function boundPromptText(value: string, maxChars: number): string {
  if (maxChars < 1 || value.length <= maxChars) {
    return value;
  }
  if (maxChars === 1) {
    return "…";
  }
  return `${value.slice(0, maxChars - 1)}…`;
}

export function shouldSkipForDailyTokenBudget(input: {
  budget: DailyTokenBudget;
  recordedUsageTokens: number;
  openReservationTokens: number;
  nextReservationTokens: number;
}): boolean {
  if (input.budget === null) {
    return false;
  }
  const recorded = Math.max(0, input.recordedUsageTokens);
  const open = Math.max(0, input.openReservationTokens);
  const next = Math.max(0, input.nextReservationTokens);
  return recorded + open + next > input.budget;
}
