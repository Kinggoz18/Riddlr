# Agents, skills, and watchlists

Operators may create additional Crypto agents. Each agent has a schedule, a
daily token budget (100000 by default, or unlimited), attached markdown skills,
and a watchlist of canonical asset IDs. Shipped skills cannot be overwritten.
Skills cannot grant tools or filesystem access. Watchlist items are canonical
IDs such as `coingecko:bitcoin`, not bare tickers. Coming-soon domains cannot
create agents or scans. Exhausted finite daily token budgets leave events
`needs_analysis` and do not invent signals. Unlimited daily usage does not skip
analysis for a cap; usage is still recorded.

**Status:** accepted
