import { runObserveLoadBenchmark } from "../apps/server/test/replay/harness.ts";

const result = runObserveLoadBenchmark();
console.log(
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      subjects: result.subjects,
      providers: result.providers,
      windowPoints: result.windowPoints,
      rss: result.after.rss,
      peakRss: result.after.peakRss,
      heapUsed: result.after.heapUsed,
      parsed: result.parsed,
      returnShocks: result.returnShocks,
      volumeHits: result.volumeHits,
      tvlHits: result.tvlHits,
      oiHits: result.oiHits,
      oddsHits: result.oddsHits,
      dailyPoints: result.dailyPoints,
    },
    null,
    2,
  ),
);
