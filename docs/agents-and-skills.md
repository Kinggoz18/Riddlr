# Agents and skills

The default agent is **Riddlr Intelligence Agent**, kind `system_default`,
domain `crypto`. It is the first-run Crypto watcher: it scans attached sources
on a schedule, discovers candidates from evidence, and analyzes material
clusters. A candidate is not a trade. It cannot trade. Operators may create
additional Crypto or Equities agents. Coming-soon domains cannot create agents
or start scans.

Each agent has:

- an operator description (shown in the dashboard, not sent to the model)
- objectives (what the watcher is for)
- a schedule (`30m`, `1h`, `2h`, `4h`, `6h`, `12h`, `daily`)
- a daily token budget (default 100000, or unlimited); when a finite budget is
  exhausted, analysis is skipped and the event stays `needs_analysis`
- attached markdown skills
- a watchlist of canonical asset IDs

The default agent cannot be deleted or renamed. First-run seeds its watchlist
with `coingecko:bitcoin`, `coingecko:ethereum`, and `coingecko:tether`, and
attaches SearXNG plus CoinGecko.

Agents, skills, sources, and portfolios are list / create / edit routes, not
one page of stacked forms. Discord may be added more than once.

## What a skill is

A skill is markdown policy that contributes one analytical dimension. It is
not an autonomous agent and cannot grant tools, filesystem access, or
secrets. User skills cannot override system policy. Each skill has an
operator description on the Skills list and agent view; that text is not
sent to the model.

Instruction hierarchy: system policy > agent policy > skill policy > source
content.

## Selection

The runtime does not send every attached skill to the model. Application code
computes facts (independent hosts, reprints, sourced quotes, missing metrics)
and selects applicable skills from the agent’s catalog. Core validation skills
run when there is evidence. Domain skills run only when their required data is
present. Skipped skills are recorded with a reason, for example liquidity
analysis unavailable when no volume or depth was sourced.

At most eleven skills enter one analysis prompt. The default Crypto agent can
attach the full shipped set; analysis still uses a subset.

## Discovery vs analysis

Discovery is application-computed. It does not require immediate confidence.
A cluster with independent evidence can become a **candidate** even when it is
not yet material enough for LLM analysis. Reprints are not candidates.

Pipeline:

Discovery → candidate → evidence collection → correlation → context →
analysis → contrarian check → materiality → risk → signal gate.

A candidate can result in no signal, low priority, medium, high, or critical.
Opportunity means the item may warrant further investigation. It is not a
recommendation to buy, sell, or trade.

Epistemic statuses stay distinct: **discovered**, **observed**, **confirmed**,
**inferred**, and **signal**. Application code sets discovered, observed, or
confirmed from evidence. Inferred is interpretation. Signal is set only after
a validated signal is persisted.

LLM analysis still runs on material events only. Candidates remain visible on
the dashboard without spending the daily token budget. Unlimited daily usage
still records tokens and still bounds prompt context.

## Core validation skills

These are foundational, not optional domain flavor:

- candidate-discovery
- event-correlation
- materiality-analysis
- risk-assessment
- contrarian-analysis

Conceptual order: discovery → evidence → event correlation → domain analysis →
contrarian review → materiality → risk assessment → signal gate.

## Shipped Crypto skills

Shipped skills live under `skills/crypto/` and load onto the default agent at
first-run and on upgrade without overwriting stored markdown:

- candidate-discovery
- event-correlation
- early-trend-detection
- narrative-detection
- catalyst-analysis
- market-regime-analysis
- price-reaction-analysis
- liquidity-analysis
- stablecoin-risk
- whale-activity (display name: large holder activity; native on-chain
  scanning is not implemented)
- regulatory-analysis
- contrarian-analysis
- materiality-analysis
- risk-assessment

Shipped slugs cannot be overwritten or deleted. Operators may attach them to
agents and create additional user skills.

## Deterministic facts vs interpretation

The application calculates counts, sourced price and volume snapshots, reprint
roles, and missing-data flags. The model interprets those facts. It must not
invent volume, open interest, depth, or wallet flows. Missing stays missing.

Risk and confidence stay separate. High confidence that an event occurred can
coincide with high risk about acting on it.

## Signal gate

After a validated signal, a deterministic gate sets disposition
(`no_signal`, `low_priority`, `medium`, `high`, `critical`) and whether the
signal is notify-eligible. Unanalyzed candidates persist no signal. Weakly
supported or interesting-but-immaterial analyzed results stay on the dashboard.
Notification policy (minimum risk, cooldown, quiet hours) still decides
whether an eligible signal is sent. Individual skills never send
notifications.
