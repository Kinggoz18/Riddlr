import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyHttpStatus } from "../types.js";
import {
  createDefiLlamaProvider,
  DEFILLAMA_PROVIDER_ID,
  mapProtocolSlugsByGeckoId,
  parseDefiLlamaCoins,
  parseDefiLlamaHacks,
  parseDefiLlamaHistoricalChainTvl,
  parseDefiLlamaProtocolDetail,
  parseDefiLlamaProtocols,
  parseDefiLlamaStablecoins,
  pegBasisPercent,
} from "./defillama.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../../test/fixtures/defillama");

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as unknown;
}

const fetchedAt = new Date("2026-09-14T15:00:00.000Z");

describe("DefiLlama observation provider", () => {
  it("maps captured protocols onto gecko_id slugs without inventing tvl zeros", () => {
    const parsed = parseDefiLlamaProtocols(readJson("protocols-truncated.json"));
    expect(parsed.errors).toEqual([]);
    const map = mapProtocolSlugsByGeckoId(parsed.rows);
    expect(map["lido-dao"]).toBe("lido");
    expect(map.aave).toBe("aave-v2");
    const lido = parsed.rows.find((row) => row.slug === "lido");
    expect(lido?.tvl).toBe(24332372291.78817);
    expect(lido?.change1d).toBe(1.3845623843347994);
  });

  it("stores only the latest protocol TVL point from a captured detail body", () => {
    const parsed = parseDefiLlamaProtocolDetail(
      readJson("protocol-aave.json"),
      "aave",
      "coingecko:aave",
      fetchedAt,
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.observations).toEqual([
      {
        provider: DEFILLAMA_PROVIDER_ID,
        metric: "tvl_usd",
        subjectCanonicalId: "coingecko:aave",
        value: 18218792583,
        unit: "usd",
        observedAt: new Date(1789394891 * 1000),
        providerLastUpdatedAt: new Date(1789394891 * 1000),
      },
    ]);
  });

  it("classifies a captured protocol detail missing tvl as malformed", () => {
    const parsed = parseDefiLlamaProtocolDetail(
      readJson("protocol-aave-drift-missing-tvl.json"),
      "aave",
      "coingecko:aave",
      fetchedAt,
    );
    expect(parsed.observations).toEqual([]);
    expect(parsed.errors[0]?.class).toBe("malformed");
    expect(parsed.errors[0]?.message).toContain("missing tvl");
  });

  it("maps captured historical chain TVL onto chain_tvl_usd", () => {
    const parsed = parseDefiLlamaHistoricalChainTvl(
      readJson("historical-chain-tvl-ethereum.json"),
      "Ethereum",
      fetchedAt,
    );
    expect(parsed.observations[0]).toEqual({
      provider: DEFILLAMA_PROVIDER_ID,
      metric: "chain_tvl_usd",
      subjectCanonicalId: "defillama:chain:Ethereum",
      value: 49914360651,
      unit: "usd",
      observedAt: new Date(1789344000 * 1000),
      providerLastUpdatedAt: new Date(1789344000 * 1000),
    });
  });

  it("maps captured stablecoins onto circulating, price, and USD peg basis", () => {
    const parsed = parseDefiLlamaStablecoins(
      readJson("stablecoins-truncated.json"),
      ["tether", "usd-coin"],
      fetchedAt,
    );
    const usdt = parsed.observations.filter(
      (item) => item.subjectCanonicalId === "coingecko:tether",
    );
    expect(usdt.find((item) => item.metric === "stablecoin_price")?.value).toBe(0.9996376019163478);
    expect(usdt.find((item) => item.metric === "stablecoin_circulating")?.value).toBe(
      183333861644.22153,
    );
    expect(usdt.find((item) => item.metric === "stablecoin_basis")?.value).toBeCloseTo(
      pegBasisPercent(0.9996376019163478, "peggedUSD") ?? Number.NaN,
      10,
    );
    expect(pegBasisPercent(0.9996376019163478, "peggedUSD")).toBe((0.9996376019163478 - 1) * 100);
  });

  it("maps captured coins.llama prices onto spot_price", () => {
    const parsed = parseDefiLlamaCoins(readJson("coins-current.json"), fetchedAt);
    expect(
      parsed.observations.find((item) => item.subjectCanonicalId === "coingecko:tether"),
    ).toEqual({
      provider: DEFILLAMA_PROVIDER_ID,
      metric: "spot_price",
      subjectCanonicalId: "coingecko:tether",
      value: 0.999689651045691,
      unit: "usd",
      observedAt: new Date(1789397620 * 1000),
      providerLastUpdatedAt: new Date(1789397620 * 1000),
    });
  });

  it("turns captured hacks into native-complete evidence without inventing a source URL", () => {
    const parsed = parseDefiLlamaHacks(readJson("hacks-truncated.json"), fetchedAt, {
      apecoin: "coingecko:apecoin",
    });
    const ape = parsed.evidence.find((item) => item.externalId === "1647475200:ApeCoin");
    expect(ape?.title).toBe("ApeCoin Governance");
    expect(ape?.contentCompleteness).toBe("native_complete");
    expect(ape?.adapterPayload?.amount).toBe(820000);
    expect(ape?.adapterPayload?.subjectCanonicalId).toBe("coingecko:apecoin");
    expect(ape?.outboundUrls).toBeUndefined();
    expect(ape?.referencedOriginKey).toBeUndefined();
  });

  it("records a populated source field as outbound origin on a captured row", () => {
    const [row] = readJson("hacks-truncated.json") as Array<Record<string, unknown>>;
    const parsed = parseDefiLlamaHacks(
      [{ ...row, source: "https://defillama.com/hacks" }],
      fetchedAt,
      {},
    );
    expect(parsed.evidence[0]?.outboundUrls).toEqual(["https://defillama.com/hacks"]);
    expect(parsed.evidence[0]?.referencedOriginKey).toBe("host:defillama.com");
  });

  it("treats an empty array as zero protocol rows", () => {
    const parsed = parseDefiLlamaProtocols(readJson("empty-array.json"));
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual([]);
  });

  it("rejects HTML protocol bodies as unavailable", () => {
    const parsed = parseDefiLlamaProtocolDetail(
      "<html>blocked</html>",
      "aave",
      "coingecko:aave",
      fetchedAt,
    );
    expect(parsed.observations).toEqual([]);
    expect(parsed.errors[0]?.class).toBe("unavailable");
  });

  it("classifies HTTP 429 as rate_limited and does not follow redirects", async () => {
    const limited = createDefiLlamaProvider({
      minIntervalMs: 0,
      fetchImpl: async () => new Response("rate limited", { status: 429 }),
    });
    const rate = await limited.observe(
      { lastProtocolsAt: fetchedAt.toISOString(), protocolSlugByGeckoId: { aave: "aave" } },
      { subjectCanonicalIds: ["coingecko:aave"], observedAt: fetchedAt },
    );
    expect(rate.observations).toEqual([]);
    expect(rate.errors.some((item) => item.class === "rate_limited")).toBe(true);
    expect(classifyHttpStatus(429)).toBe("rate_limited");

    const redirected = createDefiLlamaProvider({
      minIntervalMs: 0,
      fetchImpl: async () =>
        new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
    });
    const result = await redirected.observe(
      { lastProtocolsAt: fetchedAt.toISOString(), protocolSlugByGeckoId: { aave: "aave" } },
      { subjectCanonicalIds: ["coingecko:aave"], observedAt: fetchedAt },
    );
    expect(result.errors.some((item) => item.class === "unavailable")).toBe(true);
  });

  it("polls captured fixtures sequentially and persists the latest aave TVL point", async () => {
    const protocols = readJson("protocols-truncated.json");
    const detail = readJson("protocol-aave.json");
    const stables = readJson("stablecoins-truncated.json");
    const coins = readJson("coins-current.json");
    const hacks = readJson("hacks-truncated.json");
    const hist = readJson("historical-chain-tvl-ethereum.json");
    const provider = createDefiLlamaProvider({
      minIntervalMs: 0,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/protocols")) {
          return Response.json(protocols);
        }
        if (url.includes("/protocol/")) {
          return Response.json(detail);
        }
        if (url.includes("/stablecoins")) {
          return Response.json(stables);
        }
        if (url.includes("/prices/current/")) {
          return Response.json(coins);
        }
        if (url.endsWith("/hacks")) {
          return Response.json(hacks);
        }
        if (url.includes("/historicalChainTvl/Ethereum")) {
          return Response.json(hist);
        }
        return new Response("not found", { status: 404 });
      },
    });
    const result = await provider.observe(
      { chainSlugs: ["Ethereum"] },
      {
        subjectCanonicalIds: ["coingecko:aave", "coingecko:tether"],
        observedAt: fetchedAt,
      },
    );
    expect(
      result.observations.some((item) => item.metric === "tvl_usd" && item.value === 18218792583),
    ).toBe(true);
    expect(
      result.observations.some(
        (item) =>
          item.metric === "chain_tvl_usd" && item.subjectCanonicalId === "defillama:chain:Ethereum",
      ),
    ).toBe(true);
    expect(
      result.observations.some(
        (item) =>
          item.subjectCanonicalId === "coingecko:tether" && item.metric === "stablecoin_basis",
      ),
    ).toBe(true);
    expect(result.evidence?.some((item) => item.title?.startsWith("ApeCoin"))).toBe(true);
    expect(result.persistConfig?.protocolSlugByGeckoId).toMatchObject({ aave: "aave-v2" });
  });
});
