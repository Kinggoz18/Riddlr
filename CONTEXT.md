# Riddlr

Riddlr is a local-first intelligence engine. The core is asset-class agnostic.
Crypto is the currently supported market domain.

## Language

**Riddlr**:
The product: a read-only intelligence engine, not a tracker and not a trading system.
_Avoid_: Crypto Tracker, Coin Tracker, Trading Bot

**Market domain**:
A contextual universe of analysis such as Crypto, Equities, Forex, Commodities, or Macro.
_Avoid_: asset class (that is a different term), category, vertical

**Asset class**:
The instrument kind: cryptocurrency, meme coin, stablecoin, fiat, forex pair, stock, ETF, commodity, or index.
_Avoid_: market domain, coin type

**Asset**:
A named instrument with a canonical identifier and an asset class.
_Avoid_: coin, token (except inside the Crypto domain)

**Instrument**:
An asset as it trades in a market, including pairs.
_Avoid_: ticker-only identity

**Source**:
A configured connector that produces untrusted evidence.
_Avoid_: feed, scraper

**Evidence**:
A single provenance-bearing item collected from a source.
_Avoid_: result, hit, post (except as source-native language)

**Event**:
A clustered set of evidence about something that may be happening.
_Avoid_: signal (signals are validated outputs), incident

**Candidate**:
A discovered cluster that may warrant further investigation. Discovery does not require immediate confidence.
_Avoid_: recommendation to buy or sell, signal

**Discovered / Observed / Confirmed / Inferred / Signal**:
Epistemic statuses. Discovered is first independent notice. Observed is a sourced fact. Confirmed is independent-host agreement. Inferred is interpretation. Signal is a validated output with proof.
_Avoid_: collapsing these into one confidence score

**Observation**:
A deterministic quantitative fact with a source and timestamp. The LLM must not invent these.
_Avoid_: metric, AI-estimated number

**Analysis**:
A schema-validated LLM interpretation of assembled context for a material event.
_Avoid_: completion, chat, treating a candidate as already analyzed

**Signal**:
A validated intelligence output with proof, action, and risk. Invalid without evidence IDs.
_Avoid_: alert (notifications deliver signals), recommendation to trade, treating a candidate as a signal

**Agent**:
A configured watcher with domains, sources, skills, schedule, and policies. Read-only.
_Avoid_: bot, trader, autonomous actor

**Skill**:
A markdown policy that may specialize analysis. It cannot grant runtime privileges.
_Avoid_: plugin, tool, capability that executes

**Coming soon**:
A registry status. The domain is visible and cannot execute.
_Avoid_: supported, beta, stubbed, mocked

**Supported**:
A registry status. The domain has a real module and may run scans.
_Avoid_: enabled-but-empty

**Independence**:
Whether evidence is a primary source versus a reprint or derived copy.
_Avoid_: confirmation count by row

**Proof**:
Evidence IDs that belong to the event and justify a signal.
_Avoid_: model confidence as proof
