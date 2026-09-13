# Observation layer

Observation providers poll numeric series independently of agent scans. Rows land
in `observation_series`. Per-event `observations` remain the snapshot an event
was assessed on.

## Providers

The worker `observe` queue (`riddlr.observe.poll`) polls the union of enabled
agents' watchlists, portfolio holdings, and operator-pinned series. A subject
nobody watches is not polled. CoinGecko `/simple/price` is the shipped spot
provider. Interval `RIDDLR_OBSERVE_PRICE_INTERVAL_SECONDS` (default 60, max 300).
Batch size default 100. Concurrency `RIDDLR_OBSERVE_CONCURRENCY` (default 2,
max 4). `RIDDLR_ENV=test` does not enqueue; tests call `pollObservationProvider`.

## Retention

Raw rows older than `RIDDLR_OBSERVE_RETENTION_DAYS` (default 90, min 14, max 365)
are downsampled to one daily point (last value of the UTC day) then deleted in
bounded batches. Missing polls are gaps. The worker does not write zeros.

## Detectors

`return_shock.v1` is the sample z-score of the last 20 log returns of `spot_price`.
`volume_anomaly.v1` is the sample z-score of the last 20 `quoted_volume` points.
Threshold `|z| >= 3`. Fewer than the window, zero variance, a non-positive price,
or a gap wider than three poll intervals emit nothing. A finding is native-complete
evidence with `sourceFamily: observation` and a claim
`crypto:observed_<metric>_anomaly`. The same detector, subject, and polarity
fingerprint to one evidence row per UTC day.

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

See [integrations/coingecko.md](integrations/coingecko.md) and
[ADR 0025](adr/0025-observation-layer.md).
