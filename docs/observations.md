# Observation layer

Observation providers poll numeric series independently of agent scans. Rows land
in `observation_series`. Per-event `observations` remain the snapshot an event
was assessed on.

## Providers

The worker `observe` queue (`riddlr.observe.poll`) polls the union of enabled
agents' watchlists, portfolio holdings, and operator-pinned series. A subject
nobody watches is not polled. CoinGecko `/simple/price` is the shipped spot
provider (60s, auto-created). DefiLlama is an opt-in provider (15 minutes) for
TVL, stablecoins, and hacks; it is not auto-created. Hyperliquid and Binance
USD-M Futures are opt-in perp providers (60s; Binance OI every 5 minutes).
Polymarket and Kalshi are opt-in prediction-market providers (15 minutes).
Interval
`RIDDLR_OBSERVE_PRICE_INTERVAL_SECONDS` (default 60, max 300) applies to
CoinGecko spot. Batch size default 100. Concurrency `RIDDLR_OBSERVE_CONCURRENCY`
(default 2, max 4). `RIDDLR_ENV=test` does not enqueue; tests call
`pollObservationProvider`.

## Retention

Raw rows older than `RIDDLR_OBSERVE_RETENTION_DAYS` (default 90, min 14, max 365)
are downsampled to one daily point (last value of the UTC day) then deleted in
bounded batches. Missing polls are gaps. The worker does not write zeros.

## Detectors

`return_shock.v1` is the sample z-score of the last 20 log returns of `spot_price`.
`volume_anomaly.v1` is the sample z-score of the last 20 `quoted_volume` points.
Threshold `|z| >= 3`. Fewer than the window, zero variance, a non-positive price,
or a gap wider than three poll intervals emit nothing. `tvl_drawdown.v1` fires
when DefiLlama `tvl_usd` is down more than 15% versus a point about 24h earlier
and the larger point is at least $1,000,000. `peg_deviation.v1` fires when
DefiLlama `stablecoin_basis` is beyond 1% on two consecutive polls and CoinGecko
`spot_price` is also beyond 1% from peg. `market_stress.v1` fires on Hyperliquid
or Binance `funding_rate_apr` sample z-score beyond ±3σ after 20 hourly points
(target 168 ≈ 7 days), on a 20% 1h `open_interest_usd` move, or on
`liquidations_1m_usd` of at least $10,000,000. `funding_divergence.v1` fires
when annualised funding differs by more than 10 percentage points. `odds_jump.v1`
fires when Polymarket or Kalshi `odds_yes` moves at least 15 percentage points
in 1h or 25 in 24h and `odds_liquidity_usd` is at least $10,000. Impact stays
`low` unless both venues jump on the same subject (`agreed`) and the asset is
watched or held (`moderate`). A finding is native-complete
evidence with `sourceFamily: observation` and a claim
`crypto:observed_<metric>_anomaly` (peg uses `crypto:stablecoin_peg_change`;
odds-jump uses `crypto:macro_policy_decision` or `crypto:regulatory_action`).
The same detector, subject, and polarity fingerprint to one evidence row per UTC
day.

Findings cluster into events without a web article. A watched (or pinned) asset
with a detector claim is material (`observed_anomaly`). Reliability is `observed`,
a sourced fact, not `single_source`. The event title is the detector claim. Per-event
`observations` store the last series point the detector used. The same subject on
the same UTC day is one event; a reversed polarity or a second detector adds claims
to that event. `observed` reliability does not persist a signal.

## Operator surfaces

Health shows last poll, subject count, series count, and freshness gap. Watchlist
tiles show the latest `spot_price` when a row exists. Pin a registry asset on Health
to poll it without a watchlist. The dashboard footer reads "Price data by CoinGecko".

## Failure classes

| Class | What you see | Fix |
| --- | --- | --- |
| `rate_limited` | HTTP 429. No series rows for that poll. | Wait; add a CoinGecko demo key. |
| `unavailable` | 5xx, timeout, or redirect (`redirect=manual`) | Check CoinGecko; next interval retries |
| `malformed` | HTML 200, oversized body, or a non-object JSON body | Captured empty `vs_currencies` 422 body is this class |
| `lock_held` | A second poll while the interval NX lock is held | Wait for the in-flight poll |

See [integrations/coingecko.md](integrations/coingecko.md),
[integrations/defillama.md](integrations/defillama.md),
[integrations/hyperliquid.md](integrations/hyperliquid.md),
[integrations/binance-futures.md](integrations/binance-futures.md),
[integrations/polymarket.md](integrations/polymarket.md),
[integrations/kalshi.md](integrations/kalshi.md), and
[ADR 0025](adr/0025-observation-layer.md).
