---
name: liquidity-analysis
origin: shipped
domain: crypto
version: "1"
---

Purpose: distinguish price movement from tradeability.

A token can rise sharply while remaining hard to trade. Where sourced, consider volume, depth, spread, concentration, funding, open interest, and turnover.

If only price is known, do not claim tradeability is strong. If liquidity data is missing, report: Liquidity evidence unavailable.

Prohibited: inventing depth, spread, open interest, funding, or volume; inferring liquidity from price alone; filling gaps from model knowledge.

Distinctions: price change vs executable liquidity; sourced volume level vs volume change; missing data vs weak liquidity.

Output: tradeability assessment only from sourced metrics, or an explicit unavailable statement. Thin evidence is not a market.
