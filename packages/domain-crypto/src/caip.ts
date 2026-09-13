import { MAX_CAIP19_PER_ASSET, takeBounded } from "@riddlr/domain";

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

const PLATFORM_TO_CAIP: Record<string, { chain: string; namespace: string }> = {
  ethereum: { chain: "eip155:1", namespace: "erc20" },
  "polygon-pos": { chain: "eip155:137", namespace: "erc20" },
  "binance-smart-chain": { chain: "eip155:56", namespace: "erc20" },
  avalanche: { chain: "eip155:43114", namespace: "erc20" },
  "optimistic-ethereum": { chain: "eip155:10", namespace: "erc20" },
  "arbitrum-one": { chain: "eip155:42161", namespace: "erc20" },
  base: { chain: "eip155:8453", namespace: "erc20" },
  fantom: { chain: "eip155:250", namespace: "erc20" },
  gnosis: { chain: "eip155:100", namespace: "erc20" },
  "polygon-zkevm": { chain: "eip155:1101", namespace: "erc20" },
  scroll: { chain: "eip155:534352", namespace: "erc20" },
  linea: { chain: "eip155:59144", namespace: "erc20" },
  mantle: { chain: "eip155:5000", namespace: "erc20" },
  blast: { chain: "eip155:81457", namespace: "erc20" },
  celo: { chain: "eip155:42220", namespace: "erc20" },
  moonbeam: { chain: "eip155:1284", namespace: "erc20" },
  moonriver: { chain: "eip155:1285", namespace: "erc20" },
  solana: { chain: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", namespace: "token" },
};

export function caip19ForPlatform(platform: string, address: string): string | undefined {
  const mapped = PLATFORM_TO_CAIP[platform];
  if (!mapped || !address) {
    return undefined;
  }
  if (mapped.namespace === "erc20") {
    if (!EVM_ADDRESS_RE.test(address)) {
      return undefined;
    }
    return `${mapped.chain}/erc20:${address.toLowerCase()}`;
  }
  return `${mapped.chain}/${mapped.namespace}:${address}`;
}

export function caip19FromPlatforms(platforms: Record<string, string>): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const [platform, address] of Object.entries(platforms)) {
    const caip = caip19ForPlatform(platform, address);
    if (!caip || seen.has(caip)) {
      continue;
    }
    seen.add(caip);
    ids.push(caip);
  }
  return takeBounded(ids, MAX_CAIP19_PER_ASSET);
}
