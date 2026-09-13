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

**Mention**:
One provenance-bearing source item. It proves only that content was observed.
_Avoid_: treating a mention as confirmation

**Document**:
Safely fetched and cleaned content associated with a web mention.
_Avoid_: treating a search snippet as the article

**Claim**:
A domain-scoped normalized proposition attributed to a source, with canonical subject or instrument references, a namespaced predicate or type, value or object, polarity, modality, effective time, and an evidence excerpt.
_Avoid_: asking a model to unique the corpus; treating a summary as proof

**Source identity**:
The actual publisher, X actor, Discord author, channel, guild, or market provider.
_Avoid_: treating `x.com` or `discord.com` as the identity; treating a platform as authority

**Independent support**:
Support whose origin and actor lineage are not derived from the same report.
_Avoid_: counting reprints, mirrors, retweets, or same-host copies as confirmation

**Corroborated**:
The same claim is supported by qualifying independent origins.
_Avoid_: two hosts repeating one wire story; two domain interpretations of one document

**Early warning**:
A high-impact but not-yet-corroborated report that remains explicitly unverified.
_Avoid_: presenting an early warning as confirmed

**Event**:
A clustered set of evidence about something that may be happening.
_Avoid_: signal (signals are validated outputs), incident

**Candidate**:
A discovered cluster that may warrant further investigation. Discovery does not require immediate confidence.
_Avoid_: recommendation to buy or sell, signal

**Discovered / Observed / Confirmed / Inferred / Signal**:
Epistemic statuses. Discovered is first independent notice. Observed is a sourced fact. Confirmed is independent-origin agreement. Inferred is interpretation. Signal is a validated output with proof.
_Avoid_: collapsing these into one confidence score; overwriting event reliability with signal

**Observation**:
A deterministic quantitative fact with a source and timestamp. The LLM must not invent these.
_Avoid_: metric, AI-estimated number

**Analysis**:
A schema-validated LLM interpretation of assembled context for a material event.
_Avoid_: completion, chat, treating a candidate as already analyzed

**Signal**:
A validated intelligence output with proof, action, and risk. Invalid without evidence IDs that belong to the event.
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
Evidence IDs, and when claims exist the claim IDs, that belong to the event and justify a signal.
_Avoid_: model confidence as proof
