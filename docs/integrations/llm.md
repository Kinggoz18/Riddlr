# LLM providers — understanding and analysis

OpenAI-compatible Chat Completions and Anthropic-compatible Messages. Domain
logic does not import vendor SDKs. The LLM is read-only: it cannot trade, sign,
or access secrets.

## Setup

Onboarding step 3 or Settings → LLM: kind, base URL, model, API key. Saving
probes that the model answers (`structuredOutput: false`, 15s). Skip continues
without a model; scans still collect evidence and analysis waits.
`RIDDLR_ENV=test` does not call the network.

The base URL may be the origin (`https://api.openai.com`), already include
`/v1`, or be the full Chat Completions or Messages URL. Riddlr does not drop a
`/v1` path or double the endpoint.

The key is stored encrypted and never returned.

## What Riddlr actually calls

| Kind | Call |
| --- | --- |
| OpenAI-compatible | `POST {base}/v1/chat/completions` with `Authorization: Bearer` and JSON-schema `response_format` when structured |
| Anthropic-compatible | `POST {base}/v1/messages` with `x-api-key`, `anthropic-version: 2023-06-01`, `max_tokens` 2048, and `output_config.format` JSON schema when structured |

Timeout default 45s for analysis, 15s for the save probe. Source text is wrapped
as untrusted data. Instruction hierarchy: system > agent > skill > source.

Cache: understanding rows key on cleaned content hash, schema version,
prompt hash, and extractor version. Analysis cache keys on model, schema,
prompt hash, and context. Daily token budget skip leaves the event
`needs_analysis`. The LLM never receives raw observation series; it receives
bounded context notes.

See [llm-providers.md](../llm-providers.md).

| Item | Value |
| --- | --- |
| Kind | Analysis / understanding |
| Licence | Operator's vendor contract |
| Mapping | Zod validation is the trust boundary; prompt compliance is not |

## Agent application

Material events only. Discovery does not require a model. Equities and Crypto
modules supply allowed claim kinds. Unknown taxonomy kinds and missing proof
ids fail closed in application code.

## Failure classes

| Class | What you see | Fix |
| --- | --- | --- |
| Probe HTTP non-2xx | Save rejected | Check base URL, key, and model |
| Timeout | Analysis skipped this pass | Raise timeout only in vendor settings; budget still applies |
| JSON / Zod reject | No claims or no signal persisted | Fail closed; event stays `needs_analysis` |
| Budget exhausted | Analysis skipped | Wait for the next UTC day or raise the agent budget |

## Fixtures

Unit tests drive the HTTP client with in-process mocks. There is no recorded
vendor chat capture in the tree.
