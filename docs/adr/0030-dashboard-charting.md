# Dashboard charting

The dashboard renders observation series with uPlot 1.6.32 (MIT). Morning and
asset pages plot stored `observation_series` points only. Empty series render
no points. Event markers are links to the event. uPlot is the only extra UI
dependency; layout stays in `packages/ui` and the existing stylesheets.

**Status:** accepted
