# LLM providers

Riddlr supports OpenAI-compatible Chat Completions and native Anthropic Messages.
Domain logic does not import vendor SDKs.

Structured output uses a conservative JSON Schema intersection both vendors
accept. Application Zod validation is the trust boundary.

Structured claim extraction needs a model that supports strict JSON Schema.
Use OpenAI `gpt-4.1-mini` or later, or Anthropic Claude Sonnet class. Models
under 30B parameters are not recommended. OpenRouter does not guarantee strict
JSON Schema enforcement. Settings shows a warning when the configured model or
endpoint matches those limits.

The base URL may be the origin (`https://api.openai.com`), already include
`/v1` (`https://openrouter.ai/api/v1`), or be the full Chat Completions or
Messages URL. Riddlr does not drop a `/v1` path or double the endpoint.

Saving a provider (setup step 3 or Settings) checks that the model answers
before the key is stored. That check does not require JSON Schema structured
output. Analysis still requests structured JSON. Skip remains an explicit
detour. The test environment does not call the network.

The pipeline discovers candidates from clustered evidence, then analyzes
**material events only**. Discovery does not require a model call. It does
not dump raw search hits into a frontier model.

Endpoints, cache keys, failure classes, and fixtures:
[integrations/llm.md](integrations/llm.md).
