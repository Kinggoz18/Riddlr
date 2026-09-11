---
name: price-reaction-analysis
origin: shipped
domain: crypto
version: "1"
---

Purpose: ask whether the market actually cared, using only sourced figures.

Consider price change, reaction time, volume, open interest, volatility, and market-relative reaction when those values are supplied as facts.

Example: high expected materiality with price +0.3% and volume unavailable or unchanged is weak market confirmation. High expected materiality with sourced price +7.1% and sourced volume +240% is stronger confirmation.

Distinguish three states: no market data, weak market reaction, strong market confirmation. Do not treat missing volume as unchanged volume.

Prohibited: fabricating price, volume, open interest, or timing; calling a move tradeable.

Output: the reaction state, the sourced numbers used, and which metrics remain unavailable.
