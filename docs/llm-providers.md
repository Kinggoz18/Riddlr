# LLM providers

Riddlr supports OpenAI-compatible Chat Completions and native Anthropic Messages.
Domain logic does not import vendor SDKs.

Structured output uses a conservative JSON Schema intersection both vendors
accept. Application Zod validation is the trust boundary.

The pipeline discovers candidates from clustered evidence, then analyzes
**material events only**. Discovery does not require a model call. It does
not dump raw search hits into a frontier model.
