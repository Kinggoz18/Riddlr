import { describe, expect, it } from "vitest";
import {
  isRelevanceGatedFamily,
  mentionIsDomainRelevant,
  textContainsRelevanceTerm,
} from "./relevance.js";

const CRYPTO_TERMS = [
  "crypto",
  "cryptocurrency",
  "bitcoin",
  "token",
  "perpetual",
  "kalshi",
  "hyperliquid",
  "digital asset",
];

describe("mention relevance gate", () => {
  it("gates search mentions and leaves operator-pasted feeds ungated", () => {
    expect(isRelevanceGatedFamily("search")).toBe(true);
    expect(isRelevanceGatedFamily("feed")).toBe(false);
    expect(isRelevanceGatedFamily("market_data")).toBe(false);
  });
  it("keeps a hit that resolves a watched asset even without a vocabulary term", () => {
    expect(
      mentionIsDomainRelevant({
        title: "Bitcoin Falls as Clarity Act Fails to Advance",
        bodyText: "The Senate blocked the Clarity Act, a key bill for crypto regulation.",
        resolvedCanonicalIds: ["coingecko:bitcoin"],
        watchlistCanonicalIds: ["coingecko:bitcoin", "coingecko:ethereum"],
        relevanceTerms: ["kalshi"],
      }),
    ).toBe(true);
  });

  it("keeps a hit that contains a domain vocabulary term without a watched asset", () => {
    expect(
      mentionIsDomainRelevant({
        title: "US Senate fails to advance sweeping cryptocurrency bill in blow for industry",
        bodyText: "The U.S. Senate failed to advance comprehensive cryptocurrency legislation.",
        resolvedCanonicalIds: [],
        watchlistCanonicalIds: ["coingecko:bitcoin"],
        relevanceTerms: CRYPTO_TERMS,
      }),
    ).toBe(true);
    expect(
      mentionIsDomainRelevant({
        title: "Clarity Act odds plunge amid failed Senate procedural vote",
        bodyText: "Kalshi traders cut Clarity Act 2026 passage odds to 8%.",
        resolvedCanonicalIds: [],
        watchlistCanonicalIds: ["coingecko:bitcoin"],
        relevanceTerms: CRYPTO_TERMS,
      }),
    ).toBe(true);
    expect(
      mentionIsDomainRelevant({
        title: "Hyperliquid could be bringing perpetual futures to US customers soon",
        bodyText: "HYPE could gain more steam if the CFTC brings it as a regulated token.",
        resolvedCanonicalIds: ["coingecko:hyperliquid"],
        watchlistCanonicalIds: ["coingecko:bitcoin"],
        relevanceTerms: CRYPTO_TERMS,
      }),
    ).toBe(true);
  });

  it("rejects Reuters legal and consumer hits that lack a watched asset and vocabulary term", () => {
    const rejected = [
      "Indonesian shipwreck survivor saw vessel capsize in minutes then waited 10 hours for rescue",
      "CenterPoint Energy discloses customer data breach in SEC filing",
      "Yeti Just Made Its First Phone Case For The iPhone 18 Pro, And It's All About Durability",
      "Nuggets have rumored interest in recently-released first round pick",
      "Lawyer for State Farm fined over AI hallucination in Los Angeles lawsuit",
    ];
    for (const title of rejected) {
      expect(
        mentionIsDomainRelevant({
          title,
          bodyText: title,
          resolvedCanonicalIds: [],
          watchlistCanonicalIds: ["coingecko:bitcoin"],
          relevanceTerms: CRYPTO_TERMS,
        }),
      ).toBe(false);
    }
  });

  it("matches multi-word vocabulary terms on word boundaries", () => {
    expect(
      textContainsRelevanceTerm("digital asset companies lost the vote", ["digital asset"]),
    ).toBe(true);
    expect(textContainsRelevanceTerm("the cryptographer published a paper", ["crypto"])).toBe(
      false,
    );
  });
});
