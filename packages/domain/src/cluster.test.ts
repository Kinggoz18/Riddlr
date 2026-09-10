import { describe, expect, it } from "vitest";
import {
  characterShingles,
  clusterEvidence,
  independenceGraph,
  isNearDuplicate,
  jaccardSimilarity,
  sourceHostname,
  uniqueIndependentHosts,
} from "./cluster.js";

describe("near-duplicate clustering", () => {
  it("treats paraphrased copies as near-duplicates and exact hashes as stronger than host count", () => {
    const primary =
      "Bitcoin ETF inflows rose after the latest filing from the issuer covering US listed products.";
    const reprint =
      "Bitcoin ETF inflows rose after the latest filing from the issuer covering US listed products!";
    expect(isNearDuplicate(primary, reprint)).toBe(true);
    expect(isNearDuplicate(primary, "Solana validator outage unrelated to etf products")).toBe(
      false,
    );
    expect(jaccardSimilarity(characterShingles("aaaaa"), characterShingles("aaaaa"))).toBe(1);
  });

  it("does not merge unrelated stories that only share an asset", () => {
    const { clusters } = clusterEvidence(
      [
        {
          id: "1",
          assetCanonicalIds: ["coingecko:bitcoin"],
          text: "Bitcoin ETF inflows rose today after a filing",
          publishedAt: new Date("2026-09-10T00:00:00Z"),
        },
        {
          id: "2",
          assetCanonicalIds: ["coingecko:bitcoin"],
          text: "A mining pool reported an unrelated difficulty adjustment",
          publishedAt: new Date("2026-09-10T00:00:00Z"),
        },
        {
          id: "3",
          assetCanonicalIds: ["coingecko:solana"],
          text: "Solana validator software update",
          publishedAt: new Date("2026-09-10T00:00:00Z"),
        },
      ],
      8,
    );
    expect(clusters).toHaveLength(3);
  });

  it("clusters similar text inside the time window even without a shared asset", () => {
    const { clusters } = clusterEvidence(
      [
        {
          id: "1",
          assetCanonicalIds: ["coingecko:bitcoin"],
          text: "Spot bitcoin ETF inflows rose after the latest issuer filing covering US listed products.",
          publishedAt: new Date("2026-09-10T00:00:00Z"),
        },
        {
          id: "2",
          assetCanonicalIds: [],
          text: "Spot bitcoin ETF inflows rose after the latest issuer filing covering US listed products!",
          publishedAt: new Date("2026-09-10T02:00:00Z"),
        },
      ],
      8,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.map((item) => item.id).sort()).toEqual(["1", "2"]);
  });

  it("keeps overflow evidence in remainder instead of dumping it into the least-bad cluster", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      id: String(index),
      assetCanonicalIds: [`asset:${index}`],
      text: `qwx${index}vbn${index}mpl${index}aaa${index}zzz${index}krt${index} unique-cluster-seed-${index}`,
    }));
    const { clusters, remainder } = clusterEvidence(many, 8);
    expect(clusters).toHaveLength(8);
    expect(remainder).toHaveLength(12);
    expect(clusters.flat()).toHaveLength(8);
  });

  it("counts Reuters reprints as one independent host", () => {
    const graph = independenceGraph([
      { id: "a", url: "https://reuters.example/story", role: "primary" },
      {
        id: "b",
        url: "https://reuters.example/story?utm_source=x",
        role: "derived",
        reprintOfId: "a",
      },
      {
        id: "c",
        url: "https://reuters.example/wire/copy",
        role: "derived",
        reprintOfId: "a",
      },
    ]);
    expect(graph.nodes[0]?.hostname).toBe("reuters.example");
    expect(graph.edges).toEqual([
      { fromId: "b", toId: "a", kind: "reprint_of" },
      { fromId: "c", toId: "a", kind: "reprint_of" },
    ]);
    expect(uniqueIndependentHosts(graph.nodes)).toBe(1);
    expect(sourceHostname("not a url")).toBe("unknown-host");
  });
});
