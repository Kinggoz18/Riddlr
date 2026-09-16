import { describe, expect, it } from "vitest";
import { toPublicLlm } from "../../src/modules/setup.js";

describe("public LLM settings", () => {
  it("returns provider, base URL, and model without a secret", () => {
    expect(
      toPublicLlm([
        {
          kind: "openai_compatible",
          settings: {
            baseUrl: "https://openrouter.ai/api/v1",
            model: "meta-llama/llama-3.1-8b-instruct",
            configured: true,
            apiKey: "sk-must-never-appear",
          },
        },
      ]),
    ).toEqual({
      configured: true,
      provider: "openai_compatible",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "meta-llama/llama-3.1-8b-instruct",
      structuredOutputWarning: expect.stringContaining(
        "OpenRouter does not guarantee strict JSON Schema enforcement.",
      ),
    });
  });

  it("omits the structured-output warning for gpt-4.1-mini on OpenAI", () => {
    expect(
      toPublicLlm([
        {
          kind: "openai_compatible",
          settings: {
            baseUrl: "https://api.openai.com",
            model: "gpt-4.1-mini",
          },
        },
      ]),
    ).toEqual({
      configured: true,
      provider: "openai_compatible",
      baseUrl: "https://api.openai.com",
      model: "gpt-4.1-mini",
    });
  });

  it("reports unconfigured when no LLM provider exists", () => {
    expect(toPublicLlm([{ kind: "telegram", settings: { chatId: "1" } }])).toEqual({
      configured: false,
    });
  });
});
