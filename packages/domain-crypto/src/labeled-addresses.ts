export type LabeledAddressRole = "exchange" | "bridge" | "treasury" | "other";

export type ShippedLabeledAddress = {
  chain: "ethereum" | "solana";
  address: string;
  label: string;
  role: LabeledAddressRole;
};

export const CRYPTO_SHIPPED_LABELED_ADDRESSES: readonly ShippedLabeledAddress[] = [
  {
    chain: "ethereum",
    address: "0x28c6c06298d514db089934071355e5743bf21d60",
    label: "Binance 14",
    role: "exchange",
  },
  {
    chain: "ethereum",
    address: "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43",
    label: "Coinbase 10",
    role: "exchange",
  },
  {
    chain: "ethereum",
    address: "0x3ee18b2214aff97000d974cf647e7c347e8fa585",
    label: "Wormhole Token Bridge",
    role: "bridge",
  },
];

export function labeledAddressLookup(
  labels: readonly { chain: string; address: string; label: string; role: string }[],
): Map<string, { label: string; role: string }> {
  const map = new Map<string, { label: string; role: string }>();
  for (const item of labels) {
    map.set(`${item.chain}:${item.address.toLowerCase()}`, {
      label: item.label,
      role: item.role,
    });
  }
  return map;
}

export function transferReasonCodes(input: { fromRole?: string; toRole?: string }): string[] {
  const codes: string[] = [];
  if (input.toRole === "exchange") {
    codes.push("exchange_inflow");
  }
  if (input.fromRole === "treasury") {
    codes.push("treasury_outflow");
  }
  if (input.fromRole === "bridge") {
    codes.push("bridge_outflow");
  }
  return codes;
}
