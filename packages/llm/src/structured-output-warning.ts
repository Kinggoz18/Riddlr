const WEAK_PARAMETER_RE = /(?:^|[^0-9])(1b|2b|3b|7b|8b|9b|13b|14b)(?:[^0-9]|$)/i;

export function llmStructuredOutputWarning(input: {
  provider?: string;
  model?: string;
  baseUrl?: string;
}): string | undefined {
  const notes: string[] = [];
  const model = input.model?.trim() ?? "";
  if (model && WEAK_PARAMETER_RE.test(model)) {
    notes.push("Models under 30B parameters are not recommended for structured claim extraction.");
  }
  const baseUrl = input.baseUrl?.toLowerCase() ?? "";
  if (baseUrl.includes("openrouter.ai")) {
    notes.push("This endpoint does not guarantee strict JSON Schema enforcement.");
  }
  return notes.length > 0 ? notes.join(" ") : undefined;
}
