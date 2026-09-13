# Observation layer

Numeric market facts are polled on the `observe` queue into `observation_series`,
independent of agent scans. Subscriptions are the union of watchlists, portfolio
holdings, and operator pins. Missing polls are gaps; the worker never writes zeros.
Raw rows past `RIDDLR_OBSERVE_RETENTION_DAYS` downsample to one UTC daily point.
Per-event `observations` stay the snapshot an event was assessed on.

CoinGecko `/simple/price` is the first provider. Detectors are deterministic
application code. `return_shock.v1` and `volume_anomaly.v1` emit native-complete
evidence with `sourceFamily: observation` and a versioned claim. They do not open
events; that is a later slice.

**Status:** accepted
