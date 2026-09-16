import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clusterEvidence,
  mentionIsDomainRelevant,
  normalizeEvidence,
  type RegistryAsset,
  sortClusterCandidates,
} from "@riddlr/domain";
import { cryptoDomainModule, DEFAULT_CRYPTO_WATCHLIST } from "@riddlr/domain-crypto";
import { parseSearxngPayload } from "@riddlr/source-adapters";
import { describe, expect, it } from "vitest";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/source-adapters/test/fixtures/searxng/news-mixed-2026-09-15.json",
);

const AUDIT_FALSE_POSITIVE_ASSETS = [
  ["story-2", "DATA", "Data Network", 800],
  ["would", "WOULD", "Would", 900],
  ["cap-4", "CAP", "Cap", 700],
  ["cap-usd", "CAPUSD", "Cap USD", 850],
  ["america-party-5", "APA", "America Party", 950],
  ["constitutiondao", "PEOPLE", "People", 400],
  ["notcoin", "NOT", "Notcoin", 120],
  ["official-trump", "TRUMP", "Trump", 40],
] as const;

function registryAsset(id: string, symbol: string, name: string, rank: number): RegistryAsset {
  return {
    assetClass: "cryptocurrency",
    canonicalId: `coingecko:${id}`,
    symbol,
    name,
    aliases: [symbol.toLowerCase(), name.toLowerCase(), `$${symbol.toLowerCase()}`, id],
    externalIds: { coingeckoId: id },
    marketCapRank: rank,
    status: "active",
  };
}

describe("scan relevance audit fixture", () => {
  it("keeps four crypto hits, resolves only Bitcoin and Hyperliquid, and joins the Clarity Act trio", () => {
    const payload = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      results: unknown;
    };
    const parsed = parseSearxngPayload(payload, new Date("2026-09-15T21:00:00Z"));
    expect(parsed.evidence).toHaveLength(28);

    const registry = [
      registryAsset("bitcoin", "BTC", "Bitcoin", 1),
      registryAsset("ethereum", "ETH", "Ethereum", 2),
      registryAsset("tether", "USDT", "Tether", 3),
      registryAsset("hyperliquid", "HYPE", "Hyperliquid", 12),
      ...AUDIT_FALSE_POSITIVE_ASSETS.map(([id, symbol, name, rank]) =>
        registryAsset(id, symbol, name, rank),
      ),
    ];
    const watchlist = DEFAULT_CRYPTO_WATCHLIST.map((item) => item.canonicalId);
    const terms = cryptoDomainModule.relevanceTerms();

    const kept: Array<{
      id: string;
      title: string;
      host: string;
      assetCanonicalIds: string[];
      watchedAssetHit: boolean;
      relevanceHit: boolean;
      text: string;
      publishedAt?: Date;
    }> = [];
    const resolvedAcross: string[] = [];
    for (const item of parsed.evidence) {
      const normalized = normalizeEvidence(item);
      const extracted = cryptoDomainModule.extractAssets([normalized], registry, {
        preferredCanonicalIds: watchlist,
      });
      for (const asset of extracted) {
        resolvedAcross.push(asset.canonicalId);
      }
      if (
        mentionIsDomainRelevant({
          title: item.title,
          bodyText: item.bodyText,
          resolvedCanonicalIds: extracted.map((asset) => asset.canonicalId),
          watchlistCanonicalIds: watchlist,
          relevanceTerms: terms,
        })
      ) {
        kept.push({
          id: item.url ?? item.title ?? "hit",
          title: item.title ?? "",
          host: item.url ? new URL(item.url).hostname : "",
          assetCanonicalIds: extracted.map((asset) => asset.canonicalId),
          watchedAssetHit: extracted.some((asset) => watchlist.includes(asset.canonicalId)),
          relevanceHit: true,
          text: `${item.title ?? ""} ${item.bodyText ?? ""}`,
          publishedAt: item.publishedAt,
        });
      }
    }

    expect(kept).toHaveLength(4);
    expect(kept.map((item) => item.title).sort()).toEqual([
      "Bitcoin Falls as Clarity Act Fails to Advance. Why Cathie Wood’s Dumping Crypto Stocks.",
      "Clarity Act odds plunge amid failed Senate procedural vote",
      "Hyperliquid could be bringing perpetual futures to US customers soon. Is HYPE a buy, sell, or hold right now?",
      "US Senate fails to advance sweeping cryptocurrency bill in blow for industry",
    ]);
    expect([...new Set(resolvedAcross)].sort()).toEqual([
      "coingecko:bitcoin",
      "coingecko:hyperliquid",
    ]);
    expect(
      kept.some(
        (item) => item.host === "www.reuters.com" && !item.title.includes("cryptocurrency"),
      ),
    ).toBe(false);

    const ranked = sortClusterCandidates(kept);
    const { clusters } = clusterEvidence(ranked, 8);
    const clarity = clusters.find((cluster) =>
      cluster.some(
        (item) => item.title.includes("Clarity Act") || item.title.includes("cryptocurrency bill"),
      ),
    );
    expect(clarity).toHaveLength(3);
    expect(new Set(clarity?.map((item) => item.host)).size).toBe(3);
  });
});
