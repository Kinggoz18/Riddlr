import { describe, expect, it } from "vitest";
import {
  LLM_OPENROUTER_WARNING,
  LLM_WEAK_MODEL_WARNING,
  llmStructuredOutputNotes,
  llmStructuredOutputWarning,
} from "./llm-warning.js";

describe("structured output warning", () => {
  it("rejects 8B-class models for claim extraction", () => {
    expect(
      llmStructuredOutputWarning({
        model: "meta-llama/llama-3.1-8b-instruct",
        baseUrl: "https://openrouter.ai/api/v1",
      }),
    ).toBe(`${LLM_WEAK_MODEL_WARNING} ${LLM_OPENROUTER_WARNING}`);
    expect(
      llmStructuredOutputNotes({
        model: "meta-llama/llama-3.1-8b-instruct",
        baseUrl: "https://openrouter.ai/api/v1",
      }),
    ).toEqual([
      { tone: "danger", message: LLM_WEAK_MODEL_WARNING },
      { tone: "info", message: LLM_OPENROUTER_WARNING },
    ]);
  });

  it("warns that OpenRouter does not guarantee strict JSON Schema", () => {
    expect(
      llmStructuredOutputNotes({
        model: "deepseek/deepseek-v4.1-flash",
        baseUrl: "https://openrouter.ai/api/v1",
      }),
    ).toEqual([{ tone: "info", message: LLM_OPENROUTER_WARNING }]);
  });

  it("omits the warning for gpt-4.1-mini on OpenAI", () => {
    expect(
      llmStructuredOutputWarning({
        model: "gpt-4.1-mini",
        baseUrl: "https://api.openai.com",
      }),
    ).toBeUndefined();
  });
});
