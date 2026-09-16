import { describe, expect, it } from "vitest";
import { aggregateIndependenceByOrigin, aggregateTrustByOrigin } from "./origin-aggregate.js";

describe("origin aggregation", () => {
  it("groups independence nodes by hostname with counts", () => {
    const rows = aggregateIndependenceByOrigin([
      { hostname: "www.reuters.com", role: "primary" },
      { hostname: "www.reuters.com", role: "supporting" },
      { hostname: "news.kalshi.com", role: "supporting" },
    ]);
    expect(rows).toEqual([
      { hostname: "www.reuters.com", count: 2, roles: ["primary", "supporting"] },
      { hostname: "news.kalshi.com", count: 1, roles: ["supporting"] },
    ]);
  });

  it("groups trust rows by origin with counts", () => {
    const rows = aggregateTrustByOrigin([
      {
        evidenceId: "a",
        originKey: "host:www.reuters.com",
        hostname: "www.reuters.com",
        displayName: "Reuters",
        trustTier: "reputable_press",
      },
      {
        evidenceId: "b",
        originKey: "host:www.reuters.com",
        hostname: "www.reuters.com",
        displayName: "Reuters",
        trustTier: "reputable_press",
      },
      {
        evidenceId: "c",
        hostname: "news.kalshi.com",
        displayName: "Kalshi News",
        trustTier: "community",
      },
    ]);
    expect(rows).toEqual([
      {
        key: "host:www.reuters.com",
        label: "Reuters",
        hostname: "www.reuters.com",
        trustTier: "reputable_press",
        count: 2,
      },
      {
        key: "news.kalshi.com",
        label: "Kalshi News",
        hostname: "news.kalshi.com",
        trustTier: "community",
        count: 1,
      },
    ]);
  });
});
