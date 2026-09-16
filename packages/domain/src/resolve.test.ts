import { describe, expect, it } from "vitest";
import type { RegistryAsset } from "./domain-module.js";
import { MAX_ASSETS_PER_DOCUMENT } from "./limits.js";
import {
  canonicalizeFromRegistry,
  identifierUnresolved,
  resolveAssetsInText,
  searchRegistry,
} from "./resolve.js";

const rules = {
  minAliasLength: 3,
  cashtagMinLength: 2,
  ambiguousSymbols: ["one", "gas", "sun", "ai", "usd", "link"],
  commonWordNames: ["render", "near", "flow", "ordinals"],
  highConfidenceSymbols: ["btc", "eth", "sol", "usdt", "usdc"],
  perDocumentCap: MAX_ASSETS_PER_DOCUMENT,
};

function asset(
  id: string,
  symbol: string,
  name: string,
  extra: Partial<RegistryAsset> = {},
): RegistryAsset {
  return {
    assetClass: extra.assetClass ?? "cryptocurrency",
    canonicalId: `coingecko:${id}`,
    symbol,
    name,
    aliases: extra.aliases ?? [
      symbol.toLowerCase(),
      name.toLowerCase(),
      `$${symbol.toLowerCase()}`,
    ],
    externalIds: extra.externalIds ?? { coingeckoId: id },
    marketCapRank: extra.marketCapRank ?? 50,
    status: extra.status ?? "active",
  };
}

const bitcoin = asset("bitcoin", "BTC", "Bitcoin", { marketCapRank: 1 });
const ethereum = asset("ethereum", "ETH", "Ethereum", { marketCapRank: 2 });
const tether = asset("tether", "USDT", "Tether", {
  assetClass: "stablecoin",
  marketCapRank: 3,
});
const usdCoin = asset("usd-coin", "USDC", "USDC", {
  assetClass: "stablecoin",
  marketCapRank: 6,
});
const aave = asset("aave", "AAVE", "Aave", {
  marketCapRank: 40,
  externalIds: {
    coingeckoId: "aave",
    caip19: ["eip155:1/erc20:0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9"],
  },
  aliases: [
    "aave",
    "aave",
    "$aave",
    "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9",
    "eip155:1/erc20:0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9",
  ],
});
const harmony = asset("harmony", "ONE", "Harmony", { marketCapRank: 200 });
const oneToken = asset("one", "ONE", "One", { marketCapRank: 800 });
const gas = asset("gas", "GAS", "Gas", { marketCapRank: 400 });
const sun = asset("sun-token", "SUN", "Sun Token", { marketCapRank: 500 });
const chainlink = asset("chainlink", "LINK", "Chainlink", { marketCapRank: 15 });
const render = asset("render-token", "RENDER", "Render", { marketCapRank: 60 });
const near = asset("near", "NEAR", "NEAR Protocol", { marketCapRank: 30 });
const flow = asset("flow", "FLOW", "Flow", { marketCapRank: 70 });
const nameless = {
  assetClass: "cryptocurrency" as const,
  canonicalId: "coingecko:no-symbol-coin",
  symbol: null,
  name: "Nameless Protocol",
  aliases: ["nameless protocol"],
  externalIds: { coingeckoId: "no-symbol-coin" },
  marketCapRank: 900,
  status: "active" as const,
};

const registry: RegistryAsset[] = [
  bitcoin,
  ethereum,
  tether,
  usdCoin,
  aave,
  harmony,
  oneToken,
  gas,
  sun,
  chainlink,
  render,
  near,
  flow,
  nameless,
];

describe("registry-driven asset resolution", () => {
  it("extracts unique names and unique symbols with word boundaries", () => {
    const extracted = resolveAssetsInText(
      "Aave and Bitcoin rose while ETH followed Tether.",
      registry,
      rules,
    );
    expect(extracted.map((item) => item.canonicalId).sort()).toEqual([
      "coingecko:aave",
      "coingecko:bitcoin",
      "coingecko:ethereum",
      "coingecko:tether",
    ]);
  });

  it("matches cashtags and ignores case", () => {
    const extracted = resolveAssetsInText(
      "Traders bought $sol and $BTC overnight.",
      [...registry, asset("solana", "SOL", "Solana", { marketCapRank: 7 })],
      rules,
    );
    expect(extracted.map((item) => item.canonicalId).sort()).toEqual([
      "coingecko:bitcoin",
      "coingecko:solana",
    ]);
  });

  it("does not resolve ambiguous symbols ONE, GAS, SUN, AI, USD, or LINK without a name", () => {
    const extracted = resolveAssetsInText(
      "ONE GAS SUN AI USD LINK moved after the listing rumor.",
      registry,
      rules,
    );
    expect(extracted.map((item) => item.canonicalId)).toEqual([]);
  });

  it("disambiguates ONE when Harmony appears in the same document", () => {
    const extracted = resolveAssetsInText("Harmony ONE validators halted.", registry, rules);
    expect(extracted.map((item) => item.canonicalId)).toEqual(["coingecko:harmony"]);
  });

  it("matches Chainlink by name and $LINK, but not a bare link", () => {
    expect(
      resolveAssetsInText("The docs include a link to the filing.", registry, rules).map(
        (item) => item.canonicalId,
      ),
    ).toEqual([]);
    expect(
      resolveAssetsInText("Chainlink published the feed.", registry, rules).map(
        (item) => item.canonicalId,
      ),
    ).toEqual(["coingecko:chainlink"]);
    expect(
      resolveAssetsInText("$LINK oracles updated.", registry, rules).map(
        (item) => item.canonicalId,
      ),
    ).toEqual(["coingecko:chainlink"]);
  });

  it("does not treat Render, Near, Flow, or Ordinals as assets from a common word", () => {
    expect(
      resolveAssetsInText("Render Near Flow Ordinals in the gallery.", registry, rules).map(
        (item) => item.canonicalId,
      ),
    ).toEqual([]);
    expect(
      resolveAssetsInText("NEAR Protocol shipped the upgrade.", registry, rules).map(
        (item) => item.canonicalId,
      ),
    ).toEqual(["coingecko:near"]);
    expect(
      resolveAssetsInText("$RENDER unlocked.", registry, rules).map((item) => item.canonicalId),
    ).toEqual(["coingecko:render-token"]);
  });

  it("matches a contract address and a CAIP-19 id to a single asset", () => {
    const extracted = resolveAssetsInText(
      "Transfer to 0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
      registry,
      rules,
    );
    expect(extracted.map((item) => item.canonicalId)).toEqual(["coingecko:aave"]);
  });

  it("matches a unicode name including a CoinGecko mascot name with no symbol", () => {
    const han = asset("bitcoin-han", "BTCH", "比特币", { marketCapRank: 12 });
    const mascot = {
      assetClass: "cryptocurrency" as const,
      canonicalId: "coingecko:_",
      symbol: null,
      name: "༼ つ ◕_◕ ༽つ",
      aliases: [],
      externalIds: { coingeckoId: "_" },
      marketCapRank: 999,
      status: "active" as const,
    };
    expect(
      resolveAssetsInText("比特币 printed a new high.", [...registry, han, mascot], rules).map(
        (item) => item.canonicalId,
      ),
    ).toEqual(["coingecko:bitcoin-han"]);
    expect(
      resolveAssetsInText("༼ つ ◕_◕ ༽つ posted a meme.", [...registry, han, mascot], rules).map(
        (item) => item.canonicalId,
      ),
    ).toEqual(["coingecko:_"]);
  });

  it("matches an asset with no symbol by its name", () => {
    expect(
      resolveAssetsInText("Nameless Protocol published a post-mortem.", registry, rules).map(
        (item) => item.canonicalId,
      ),
    ).toEqual(["coingecko:no-symbol-coin"]);
  });

  it("caps a document that mentions more than twelve assets at the highest-confidence matches", () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      asset(`token-${index}`, `TK${index.toString().padStart(2, "0")}`, `Token ${index} Protocol`, {
        marketCapRank: index + 1,
      }),
    );
    const names = many.map((item) => item.name).join(" ");
    const extracted = resolveAssetsInText(names, many, rules);
    expect(extracted).toHaveLength(12);
    expect(extracted[0]?.canonicalId).toBe("coingecko:token-0");
  });

  it("canonicalizes a registry id and rejects an unknown id even when a name is supplied", () => {
    expect(
      canonicalizeFromRegistry({ canonicalId: "coingecko:bitcoin" }, registry)?.canonicalId,
    ).toBe("coingecko:bitcoin");
    expect(canonicalizeFromRegistry({ symbol: "BTC" }, registry)?.canonicalId).toBe(
      "coingecko:bitcoin",
    );
    expect(
      canonicalizeFromRegistry(
        { canonicalId: "coingecko:unknown-coin", name: "Unknown Coin" },
        registry,
      ),
    ).toBeUndefined();
    expect(canonicalizeFromRegistry({ symbol: "ONE" }, registry)).toBeUndefined();
  });

  it("searches aliases without requiring a typed coingecko id", () => {
    expect(searchRegistry(registry, "sol", 8).map((item) => item.canonicalId)).toEqual([]);
    expect(
      searchRegistry([...registry, asset("solana", "SOL", "Solana")], "sol", 8).map(
        (item) => item.canonicalId,
      ),
    ).toEqual(["coingecko:solana"]);
    expect(searchRegistry(registry, "bit", 8)[0]?.canonicalId).toBe("coingecko:bitcoin");
    expect(searchRegistry(registry, "", 3).map((item) => item.canonicalId)).toEqual([
      "coingecko:bitcoin",
      "coingecko:ethereum",
      "coingecko:tether",
    ]);
    expect(
      searchRegistry(
        [...registry, asset("litecoin", "LTC", "Litecoin", { status: "inactive" })],
        "ltc",
        8,
      ).map((item) => item.canonicalId),
    ).toEqual([]);
  });

  it("flags equities without a FIGI as identifier unresolved", () => {
    expect(
      identifierUnresolved({
        assetClass: "stock",
        externalIds: { cik: "0000789019", ticker: "MSFT" },
      }),
    ).toBe(true);
    expect(
      identifierUnresolved({
        assetClass: "stock",
        externalIds: { cik: "0000320193", ticker: "AAPL", figi: "BBG000B9XRY4" },
      }),
    ).toBe(false);
    expect(
      identifierUnresolved({
        assetClass: "cryptocurrency",
        externalIds: { coingeckoId: "bitcoin" },
      }),
    ).toBe(false);
  });

  it("does not resolve English-word symbols or hyphen-to-space slug aliases from prose", () => {
    const falsePositives: RegistryAsset[] = [
      asset("story-2", "DATA", "Data Network", { marketCapRank: 800 }),
      asset("would", "WOULD", "Would", { marketCapRank: 900 }),
      asset("cap-4", "CAP", "Cap", { marketCapRank: 700 }),
      asset("cap-usd", "CAPUSD", "Cap USD", {
        marketCapRank: 850,
        externalIds: { coingeckoId: "cap-usd" },
      }),
      asset("america-party-5", "APA", "America Party", { marketCapRank: 950 }),
      asset("constitutiondao", "PEOPLE", "People", { marketCapRank: 400 }),
      asset("notcoin", "NOT", "Notcoin", { marketCapRank: 120 }),
      asset("official-trump", "TRUMP", "Trump", { marketCapRank: 40 }),
      asset("hyperliquid", "HYPE", "Hyperliquid", { marketCapRank: 12 }),
    ];
    const headlines = [
      "CenterPoint Energy discloses customer data breach in SEC filing",
      "Mahmoud Khalil sues Columbia for alleged failure to protect pro-Palestinian students",
      "Syngenta files for Hong Kong IPO, aiming to raise at least $5 billion, sources say",
      "Agnico Eagle says it is not interested in participating in Barrick’s North American IPO. It would not make sense.",
      "Canada offers tax incentive on capital investment to lure foreign investors",
      "Bitcoin market snapshot quoted at market cap USD 64000",
      "Trump taps acting EEOC general counsel Eschbach to serve permanently",
      "US Senate fails to advance sweeping cryptocurrency bill backed by President Donald Trump",
    ];
    const extracted = headlines.flatMap((title) =>
      resolveAssetsInText(title, [...registry, ...falsePositives], rules),
    );
    expect(extracted.map((item) => item.canonicalId).sort()).toEqual(["coingecko:bitcoin"]);
  });

  it("resolves Hyperliquid by name and ignores bare HYPE", () => {
    const hyperliquid = asset("hyperliquid", "HYPE", "Hyperliquid", { marketCapRank: 12 });
    expect(
      resolveAssetsInText(
        "Is HYPE a buy, sell, or hold right now?",
        [...registry, hyperliquid],
        rules,
      ).map((item) => item.canonicalId),
    ).toEqual([]);
    expect(
      resolveAssetsInText(
        "Hyperliquid could be bringing perpetual futures to US customers soon.",
        [...registry, hyperliquid],
        rules,
      ).map((item) => item.canonicalId),
    ).toEqual(["coingecko:hyperliquid"]);
  });

  it("prefers watchlist assets over incidental registry hits at the document cap", () => {
    const preferred = asset("watch-coin", "WCH", "Watchcoin Protocol", { marketCapRank: 80 });
    const incidental = asset("other-coin", "OTC", "Othercoin Protocol", { marketCapRank: 2 });
    const tight = { ...rules, perDocumentCap: 1 };
    const extracted = resolveAssetsInText(
      "Watchcoin Protocol and Othercoin Protocol both printed highs.",
      [incidental, preferred],
      tight,
      { preferredCanonicalIds: ["coingecko:watch-coin"] },
    );
    expect(extracted.map((item) => item.canonicalId)).toEqual(["coingecko:watch-coin"]);
  });
});
