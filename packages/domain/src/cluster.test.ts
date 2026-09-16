import { describe, expect, it } from "vitest";
import { buildEventFacts } from "./analysis-facts.js";
import {
  absorbMarketDataClusters,
  absorbObservationClusters,
  characterShingles,
  clusterEventTitle,
  clusterEvidence,
  clusterOpensEvent,
  eventClusterFingerprint,
  independenceGraph,
  isNearDuplicate,
  jaccardSimilarity,
  sortClusterCandidates,
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

  it("does not merge unrelated stories that only share a claim group", () => {
    const { clusters } = clusterEvidence(
      [
        {
          id: "1",
          assetCanonicalIds: ["coingecko:bitcoin"],
          text: "Bank of America announced a bitcoin custody mandate after a filing.",
          publishedAt: new Date("2026-09-10T00:00:00Z"),
          claimGroupKeys: ["crypto:market_move|coingecko:bitcoin"],
          claimFingerprints: ["fp-custody"],
        },
        {
          id: "2",
          assetCanonicalIds: ["coingecko:bitcoin"],
          text: "Spot bitcoin ETF inflows rose after the latest issuer filing covering US listed products.",
          publishedAt: new Date("2026-09-10T00:00:00Z"),
          claimGroupKeys: ["crypto:market_move|coingecko:bitcoin"],
          claimFingerprints: ["fp-etf"],
        },
      ],
      8,
    );
    expect(clusters).toHaveLength(2);
  });

  it("clusters independent reports of the same claim fingerprint", () => {
    const { clusters } = clusterEvidence(
      [
        {
          id: "1",
          assetCanonicalIds: ["coingecko:bitcoin"],
          text: "Issuer filing said US listed products saw ETF inflows.",
          publishedAt: new Date("2026-09-10T00:00:00Z"),
          claimFingerprints: ["fp-etf"],
        },
        {
          id: "2",
          assetCanonicalIds: ["coingecko:bitcoin"],
          text: "A separate desk described the same ETF inflows into listed products.",
          publishedAt: new Date("2026-09-10T02:00:00Z"),
          claimFingerprints: ["fp-etf"],
        },
      ],
      8,
    );
    expect(clusters).toHaveLength(1);
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
      text: `zxqv${index} wlmr${index} npth${index} fjdk${index} bcxw${index} krtp${index}`,
    }));
    const { clusters, remainder } = clusterEvidence(many, 8);
    expect(clusters).toHaveLength(8);
    expect(remainder).toHaveLength(12);
    expect(clusters.flat()).toHaveLength(8);
  });

  it("joins paraphrased same-story headlines on content bigrams after ranking watched hits first", () => {
    const publishedAt = new Date("2026-09-15T18:00:00Z");
    const noise = Array.from({ length: 12 }, (_, index) => ({
      id: `noise-${index}`,
      assetCanonicalIds: [],
      watchedAssetHit: false,
      relevanceHit: false,
      text: `Chipmaker Altera confidentially files for US IPO number ${index} as investors gauge demand`,
      publishedAt,
    }));
    const clarity = [
      {
        id: "reuters-clarity",
        assetCanonicalIds: [],
        watchedAssetHit: false,
        relevanceHit: true,
        text: "US Senate fails to advance sweeping cryptocurrency bill in blow for industry. The U.S. Senate failed on Tuesday to advance comprehensive cryptocurrency legislation.",
        publishedAt,
      },
      {
        id: "kalshi-clarity",
        assetCanonicalIds: [],
        watchedAssetHit: false,
        relevanceHit: true,
        text: "Clarity Act odds plunge amid failed Senate procedural vote. Kalshi traders cut Clarity Act 2026 passage odds to 8% after the Senate fell short on a key cloture vote Tuesday.",
        publishedAt,
      },
      {
        id: "msn-clarity",
        assetCanonicalIds: ["coingecko:bitcoin"],
        watchedAssetHit: true,
        relevanceHit: true,
        text: "Bitcoin Falls as Clarity Act Fails to Advance. The Senate blocked the Clarity Act, a key bill for crypto regulation, on Tuesday afternoon.",
        publishedAt,
      },
    ];
    const ranked = sortClusterCandidates([...noise, ...clarity]);
    expect(ranked[0]?.id).toBe("msn-clarity");
    const { clusters, remainder } = clusterEvidence(ranked, 8);
    const clarityCluster = clusters.find((cluster) =>
      cluster.some((item) => item.id === "msn-clarity"),
    );
    expect(clarityCluster?.map((item) => item.id).sort()).toEqual([
      "kalshi-clarity",
      "msn-clarity",
      "reuters-clarity",
    ]);
    expect(remainder.some((item) => item.id.includes("clarity"))).toBe(false);
    expect(clarityCluster?.some((item) => item.id.startsWith("noise-"))).toBe(false);
  });

  it("does not join a Hyperliquid headline with the Clarity Act cluster", () => {
    const { clusters } = clusterEvidence(
      [
        {
          id: "clarity",
          assetCanonicalIds: ["coingecko:bitcoin"],
          text: "Bitcoin Falls as Clarity Act Fails to Advance. The Senate blocked the Clarity Act, a key bill for crypto regulation.",
        },
        {
          id: "hype",
          assetCanonicalIds: ["coingecko:hyperliquid"],
          text: "Hyperliquid could be bringing perpetual futures to US customers soon. Is HYPE a buy, sell, or hold right now?",
        },
      ],
      8,
    );
    expect(clusters).toHaveLength(2);
  });

  it("absorbs market snapshots into a news cluster that already has the asset", () => {
    const merged = absorbMarketDataClusters([
      [
        {
          id: "news",
          assetCanonicalIds: ["coingecko:bitcoin"],
          text: "Bitcoin ETF inflows rose after a filing",
          sourceFamily: "search",
        },
      ],
      [
        {
          id: "px",
          assetCanonicalIds: ["coingecko:bitcoin"],
          text: "Bitcoin quoted at USD 64000",
          sourceFamily: "market_data",
        },
      ],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.map((item) => item.id).sort()).toEqual(["news", "px"]);
  });

  it("merges observation findings on the same asset into one cluster", () => {
    const merged = absorbObservationClusters([
      [
        {
          id: "shock",
          assetCanonicalIds: ["coingecko:bitcoin"],
          text: "return_shock.v1 on coingecko:bitcoin: z=4.25 over 20 spot_price samples",
          sourceFamily: "observation",
        },
      ],
      [
        {
          id: "volume",
          assetCanonicalIds: ["coingecko:bitcoin"],
          text: "volume_anomaly.v1 on coingecko:bitcoin: z=4.25 over 20 quoted_volume samples",
          sourceFamily: "observation",
        },
      ],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.map((item) => item.id).sort()).toEqual(["shock", "volume"]);
  });

  it("does not treat an absorbed market snapshot as a second origin", () => {
    const facts = buildEventFacts({
      evidence: [
        {
          hostname: "news.example.com",
          sourceFamily: "search",
          text: "Bitcoin ETF inflows rose after a filing",
          role: "primary",
          hasValidatedClaim: true,
          contentCompleteness: "full_document",
        },
        {
          hostname: "api.coingecko.com",
          sourceFamily: "market_data",
          text: "Bitcoin quoted at USD 64000",
          role: "supporting",
        },
      ],
      assets: [{ assetClass: "cryptocurrency", canonicalId: "coingecko:bitcoin" }],
      observations: [],
      watchlistOverlap: true,
      portfolioOverlap: false,
    });
    expect(facts.independentOriginCount).toBe(1);
    expect(facts.independentHostCount).toBe(1);
  });

  it("titles from a principal claim instead of asset plus host", () => {
    expect(
      clusterEventTitle({
        assets: [{ canonicalId: "coingecko:bitcoin", displayName: "Bitcoin" }],
        evidenceTitles: ["Bitcoin price"],
        hostnames: ["www.coinbase.com"],
        principalClaimTitle: "bitcoin: ETF inflows",
      }),
    ).toBe("bitcoin: ETF inflows");
    expect(
      clusterEventTitle({
        assets: [{ canonicalId: "coingecko:bitcoin", displayName: "Bitcoin" }],
        evidenceTitles: ["Bank of America expands bitcoin custody for institutions"],
        hostnames: ["www.example.com"],
        principalClaimTitle: "bitcoin: market_move 24 hours",
      }),
    ).toBe("Bank of America expands bitcoin custody for institutions");
    expect(
      clusterEventTitle({
        assets: [{ canonicalId: "coingecko:bitcoin", displayName: "Bitcoin" }],
        evidenceTitles: ["return_shock.v1 coingecko:bitcoin"],
        hostnames: ["unknown-host"],
        principalClaimTitle: "bitcoin 4.25σ spot price return shock (v1, threshold 3σ)",
        reliabilityStatus: "observed",
      }),
    ).toBe("bitcoin 4.25σ spot price return shock (v1, threshold 3σ)");
  });

  it("titles mention clusters from the article headline, not the host", () => {
    expect(
      clusterEventTitle({
        assets: [{ canonicalId: "coingecko:bitcoin", displayName: "Bitcoin" }],
        evidenceTitles: ["SEC charges exchange with unregistered securities offering"],
        hostnames: ["www.reuters.com"],
        reliabilityStatus: "mention",
        sourceFamilies: ["search"],
      }),
    ).toBe("SEC charges exchange with unregistered securities offering");
  });

  it("does not title CoinGecko market snapshots as search mentions", () => {
    expect(
      clusterEventTitle({
        assets: [
          { canonicalId: "coingecko:bitcoin", displayName: "Bitcoin" },
          { canonicalId: "coingecko:ethereum", displayName: "Ethereum" },
        ],
        evidenceTitles: ["Bitcoin market snapshot", "Ethereum market snapshot"],
        hostnames: ["www.coingecko.com"],
        reliabilityStatus: "mention",
        sourceFamilies: ["market_data", "market_data"],
      }),
    ).toBe("Bitcoin, Ethereum spot observations");
  });

  it("does not open events from market-data snapshots unless a detector fired", () => {
    expect(
      clusterOpensEvent({ sourceFamilies: ["market_data", "market_data"], observedAnomaly: false }),
    ).toBe(false);
    expect(clusterOpensEvent({ sourceFamilies: ["market_data"], observedAnomaly: true })).toBe(
      true,
    );
    expect(clusterOpensEvent({ sourceFamilies: ["search"], observedAnomaly: false })).toBe(true);
  });

  it("titles clusters from assets and hosts instead of homepage copy", () => {
    expect(
      clusterEventTitle({
        assets: [{ canonicalId: "coingecko:ethereum", displayName: "Ethereum", symbol: "ETH" }],
        evidenceTitles: ["Ethereum - Wikipedia"],
        hostnames: ["en.wikipedia.org"],
      }),
    ).toBe("Ethereum cluster · en.wikipedia.org");
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

  it("keeps event fingerprints stable when evidence IDs change", () => {
    const first = eventClusterFingerprint({
      marketDomainId: "crypto",
      claimFingerprints: ["crypto:market_move|coingecko:bitcoin"],
      assetCanonicalIds: ["coingecko:bitcoin"],
    });
    const second = eventClusterFingerprint({
      marketDomainId: "crypto",
      claimFingerprints: ["crypto:market_move|coingecko:bitcoin"],
      assetCanonicalIds: ["coingecko:bitcoin", "coingecko:bitcoin"],
    });
    expect(first).toBe(second);
    expect(
      eventClusterFingerprint({
        marketDomainId: "crypto",
        claimFingerprints: ["crypto:market_move|coingecko:bitcoin"],
        assetCanonicalIds: ["coingecko:bitcoin"],
      }),
    ).toBe(
      eventClusterFingerprint({
        marketDomainId: "crypto",
        claimFingerprints: ["crypto:market_move|coingecko:bitcoin"],
        assetCanonicalIds: ["coingecko:bitcoin"],
      }),
    );
    expect(
      eventClusterFingerprint({
        marketDomainId: "crypto",
        claimFingerprints: [],
        contentHashes: [],
        assetCanonicalIds: ["coingecko:bitcoin"],
      }),
    ).toBe(
      eventClusterFingerprint({
        marketDomainId: "crypto",
        assetCanonicalIds: ["coingecko:bitcoin"],
      }),
    );
    expect(first).not.toBe(
      eventClusterFingerprint({
        marketDomainId: "crypto",
        claimFingerprints: ["crypto:insolvency|coingecko:bitcoin"],
      }),
    );
    expect(
      eventClusterFingerprint({
        marketDomainId: "crypto",
        contentHashes: ["hash-a"],
        assetCanonicalIds: ["coingecko:bitcoin"],
      }),
    ).not.toBe(
      eventClusterFingerprint({
        marketDomainId: "crypto",
        contentHashes: ["hash-b"],
        assetCanonicalIds: ["coingecko:bitcoin"],
      }),
    );
    expect(
      eventClusterFingerprint({
        marketDomainId: "crypto",
        contentHashes: ["hash-a"],
        overflowBucket: "2026-09-13",
      }),
    ).not.toBe(
      eventClusterFingerprint({
        marketDomainId: "crypto",
        contentHashes: ["hash-a"],
        overflowBucket: "2026-09-14",
      }),
    );
  });
});
