const WEAK_PARAMETER_RE = /(?:^|[^0-9])(1b|2b|3b|7b|8b|9b|13b|14b)(?:[^0-9]|$)/i;

export type LlmStructuredOutputNote = {
  tone: "danger" | "info";
  message: string;
};

export const LLM_WEAK_MODEL_WARNING =
  "Models under 30B parameters, including 8B-class, are not sufficient for structured claim extraction. Use OpenAI gpt-4.1-mini or later, or Anthropic Claude Sonnet class.";

export const LLM_OPENROUTER_WARNING =
  "OpenRouter does not guarantee strict JSON Schema enforcement. Riddlr still requests structured JSON and rejects invalid claims. Prefer OpenAI or Anthropic if extraction comes back empty.";

export function llmStructuredOutputNotes(input: {
  provider?: string;
  model?: string;
  baseUrl?: string;
}): LlmStructuredOutputNote[] {
  const notes: LlmStructuredOutputNote[] = [];
  const model = input.model?.trim() ?? "";
  if (model && WEAK_PARAMETER_RE.test(model)) {
    notes.push({ tone: "danger", message: LLM_WEAK_MODEL_WARNING });
  }
  const baseUrl = input.baseUrl?.toLowerCase() ?? "";
  if (baseUrl.includes("openrouter.ai")) {
    notes.push({ tone: "info", message: LLM_OPENROUTER_WARNING });
  }
  return notes;
}

export function llmStructuredOutputWarning(input: {
  provider?: string;
  model?: string;
  baseUrl?: string;
}): string | undefined {
  const notes = llmStructuredOutputNotes(input);
  return notes.length > 0 ? notes.map((note) => note.message).join(" ") : undefined;
}
