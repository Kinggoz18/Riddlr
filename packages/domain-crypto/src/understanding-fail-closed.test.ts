import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATALYST_KINDS,
  collectAllowedSubjectIds,
  normalizeEvidence,
  type RegistryAsset,
  skipUnderstandingForPageClass,
  validateContentUnderstanding,
} from "@riddlr/domain";
import { describe, expect, it } from "vitest";
import { cryptoDomainModule } from "./module.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/understanding");

function registryAsset(id: string, symbol: string, name: string): RegistryAsset {
  return {
    assetClass: "cryptocurrency",
    canonicalId: `coingecko:${id}`,
    symbol,
    name,
    aliases: [symbol.toLowerCase(), name.toLowerCase(), `$${symbol.toLowerCase()}`, id],
    externalIds: { coingeckoId: id },
    marketCapRank: 1,
    status: "active",
  };
}

const REGISTRY: RegistryAsset[] = [
  registryAsset("bitcoin", "BTC", "Bitcoin"),
  registryAsset("ethereum", "ETH", "Ethereum"),
  registryAsset("tether", "USDT", "Tether"),
];

const WATCHLIST = ["coingecko:bitcoin", "coingecko:ethereum", "coingecko:tether"];

describe("crypto understanding fail-closed", () => {
  it("persists no claims from the BGR phone-case document", () => {
    const content = readFileSync(join(fixtureDir, "bgr-yeti-iphone-case.txt"), "utf8");
    const raw = JSON.parse(
      readFileSync(join(fixtureDir, "bgr-yeti-iphone-case.llm.json"), "utf8"),
    ) as Record<string, unknown>;
    const evidence = normalizeEvidence({
      sourceFamily: "search",
      adapterId: "searxng",
      title:
        "Yeti Just Made Its First Phone Case For The iPhone 18 Pro, And It's All About Durability",
      bodyText: content,
      fetchedAt: new Date("2026-09-15T19:47:00Z"),
      url: "https://www.bgr.com/2259408/yeti-loadout-iphone-case-price-features",
      contentCompleteness: "full_document",
    });
    const allowedSubjectIds = collectAllowedSubjectIds({
      watchlistIds: WATCHLIST,
      resolvedIds: cryptoDomainModule
        .extractAssets([evidence], REGISTRY)
        .map((item) => item.canonicalId),
    });
    const parsed = validateContentUnderstanding(raw, {
      evidenceId: "04d425a8-2886-4d5e-bfdb-0fa3c9fbe94b",
      content: `${evidence.title ?? ""}\n${content}`,
      allowedClaimKinds: [...CATALYST_KINDS],
      allowedSubjectIds,
    });
    expect(parsed.pageClass).toBe("market_profile");
    expect(skipUnderstandingForPageClass(parsed.pageClass)).toBe(true);
    expect(parsed.claims).toHaveLength(0);
    expect(allowedSubjectIds).toContain("coingecko:bitcoin");
    expect(allowedSubjectIds).not.toContain(
      "https://www.bgr.com/2259408/yeti-loadout-iphone-case-price-features",
    );
    expect(
      cryptoDomainModule.normalizeClaim(
        {
          kind: "material_corporate_event",
          predicate: "product_launch",
          polarity: "asserted",
          modality: "asserted",
          excerpt: "The Yeti LoadOut phone case, the company's first-ever phone case",
          subjectCanonicalId: "https://www.bgr.com/2259408/yeti-loadout-iphone-case-price-features",
        },
        evidence,
        REGISTRY,
        allowedSubjectIds,
      ),
    ).toBeUndefined();
  });

  it("accepts one security_incident claim with a registry subject from a crypto exploit article", () => {
    const content = readFileSync(join(fixtureDir, "bitcoin-bridge-exploit.txt"), "utf8");
    const raw = JSON.parse(
      readFileSync(join(fixtureDir, "bitcoin-bridge-exploit.llm.json"), "utf8"),
    ) as Record<string, unknown>;
    const evidence = normalizeEvidence({
      sourceFamily: "feed",
      adapterId: "feeds",
      title: "Bitcoin bridge exploit drains $40 million from watched protocol",
      bodyText: content,
      fetchedAt: new Date("2026-09-15T12:00:00Z"),
      url: "https://news.example.com/bitcoin-bridge-exploit",
      contentCompleteness: "native_complete",
    });
    const allowedSubjectIds = collectAllowedSubjectIds({
      watchlistIds: WATCHLIST,
      resolvedIds: cryptoDomainModule
        .extractAssets([evidence], REGISTRY)
        .map((item) => item.canonicalId),
    });
    expect(allowedSubjectIds).toContain("coingecko:bitcoin");
    const parsed = validateContentUnderstanding(raw, {
      evidenceId: "exploit-1",
      content: `${evidence.title ?? ""}\n${content}`,
      allowedClaimKinds: [...CATALYST_KINDS],
      allowedSubjectIds,
    });
    expect(parsed.pageClass).toBe("news_report");
    expect(skipUnderstandingForPageClass(parsed.pageClass)).toBe(false);
    expect(parsed.claims).toHaveLength(1);
    const candidate = parsed.claims[0];
    expect(candidate).toBeDefined();
    if (!candidate) {
      return;
    }
    const normalized = cryptoDomainModule.normalizeClaim(
      candidate,
      evidence,
      REGISTRY,
      allowedSubjectIds,
    );
    expect(normalized?.kind).toBe("crypto:security_incident");
    expect(normalized?.subjectCanonicalId).toBe("coingecko:bitcoin");
  });
});
