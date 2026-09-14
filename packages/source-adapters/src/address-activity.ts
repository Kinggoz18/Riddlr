import {
  DEFAULT_LARGE_TRANSFER_USD,
  DEFAULT_TRANSFER_MIN_USD,
  MAX_ADDRESS_ACTIVITY_ITEMS,
  type RawEvidence,
  takeBounded,
} from "@riddlr/domain";

export type ParsedAddressTransfer = {
  txHash: string;
  logIndex: string;
  fromAddress: string;
  toAddress: string;
  assetSymbol: string;
  contractAddress?: string;
  amount: number;
  chain: "ethereum" | "solana";
  explorerUrl: string;
  category: string;
};

export type TransferClassification = {
  usdNotional?: number;
  fromLabel: string;
  toLabel: string;
  fromRole?: string;
  toRole?: string;
  reasonCodes: string[];
  portfolioOwned: boolean;
  aboveLargeThreshold: boolean;
  aboveMinNotional: boolean;
};

const STABLE_SYMBOLS = new Set(["USDC", "USDT", "DAI", "USD", "USDP", "TUSD"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function parseFinite(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function subjectCanonicalIdForTransfer(transfer: ParsedAddressTransfer): string | undefined {
  const symbol = transfer.assetSymbol.toUpperCase();
  if (symbol === "ETH" || symbol === "WETH") {
    return "coingecko:ethereum";
  }
  if (symbol === "SOL" || symbol === "WSOL") {
    return "coingecko:solana";
  }
  return undefined;
}

export function usdNotionalForTransfer(
  transfer: ParsedAddressTransfer,
  prices: Readonly<Record<string, number>>,
): number | undefined {
  const symbol = transfer.assetSymbol.toUpperCase();
  if (STABLE_SYMBOLS.has(symbol)) {
    return transfer.amount;
  }
  if (symbol === "ETH" || symbol === "WETH") {
    const price = prices["coingecko:ethereum"];
    return typeof price === "number" ? transfer.amount * price : undefined;
  }
  if (symbol === "SOL" || symbol === "WSOL") {
    const price = prices["coingecko:solana"];
    return typeof price === "number" ? transfer.amount * price : undefined;
  }
  return undefined;
}

export function classifyTransfer(
  transfer: ParsedAddressTransfer,
  input: {
    labels: Map<string, { label: string; role: string }>;
    portfolio: Set<string>;
    prices: Readonly<Record<string, number>>;
    largeUsd?: number;
    minUsd?: number;
  },
): TransferClassification {
  const chainKey = transfer.chain === "solana" ? "solana" : "ethereum";
  const fromKey = `${chainKey}:${transfer.fromAddress.toLowerCase()}`;
  const toKey = `${chainKey}:${transfer.toAddress.toLowerCase()}`;
  const from = input.labels.get(fromKey);
  const to = input.labels.get(toKey);
  const fromLabel = from?.label ?? transfer.fromAddress;
  const toLabel = to?.label ?? transfer.toAddress;
  const reasonCodes: string[] = [];
  if (to?.role === "exchange") {
    reasonCodes.push("exchange_inflow");
  }
  if (from?.role === "treasury") {
    reasonCodes.push("treasury_outflow");
  }
  if (from?.role === "bridge") {
    reasonCodes.push("bridge_outflow");
  }
  const usdNotional = usdNotionalForTransfer(transfer, input.prices);
  const largeUsd = input.largeUsd ?? DEFAULT_LARGE_TRANSFER_USD;
  const minUsd = input.minUsd ?? DEFAULT_TRANSFER_MIN_USD;
  const portfolioOwned = input.portfolio.has(fromKey) || input.portfolio.has(toKey);
  return {
    usdNotional,
    fromLabel,
    toLabel,
    fromRole: from?.role,
    toRole: to?.role,
    reasonCodes,
    portfolioOwned,
    aboveLargeThreshold: typeof usdNotional === "number" && usdNotional >= largeUsd,
    aboveMinNotional: typeof usdNotional === "number" && usdNotional >= minUsd,
  };
}

export function shouldPersistTransfer(classification: TransferClassification): boolean {
  return (
    classification.portfolioOwned ||
    classification.aboveLargeThreshold ||
    (classification.aboveMinNotional && classification.reasonCodes.length > 0)
  );
}

export function addressActivityEvidence(input: {
  transfer: ParsedAddressTransfer;
  classification: TransferClassification;
  adapterId: string;
  fetchedAt: Date;
  subjectCanonicalId?: string;
}): RawEvidence {
  const { transfer, classification } = input;
  const headline = classification.aboveLargeThreshold ? "Large transfer" : "Address activity";
  const usd =
    typeof classification.usdNotional === "number"
      ? `${classification.usdNotional} usd`
      : "usd notional unavailable";
  const reasons = classification.reasonCodes.join(" ") || "unlabeled";
  const bodyText = [
    `${headline} ${classification.fromLabel} → ${classification.toLabel}.`,
    `${transfer.amount} ${transfer.assetSymbol} (${usd}).`,
    `Reason codes ${reasons}.`,
  ].join(" ");
  return {
    sourceFamily: "onchain",
    adapterId: input.adapterId,
    externalId: `${transfer.txHash}:${transfer.logIndex}`,
    url: transfer.explorerUrl,
    canonicalUrl: transfer.explorerUrl,
    title: `${transfer.assetSymbol} transfer ${classification.fromLabel} → ${classification.toLabel}`,
    bodyText,
    publishedAt: input.fetchedAt,
    fetchedAt: input.fetchedAt,
    contentCompleteness: "native_complete",
    originKey: `onchain:${transfer.chain}`,
    adapterPayload: {
      txHash: transfer.txHash,
      logIndex: transfer.logIndex,
      fromAddress: transfer.fromAddress,
      toAddress: transfer.toAddress,
      assetSymbol: transfer.assetSymbol,
      contractAddress: transfer.contractAddress,
      amount: transfer.amount,
      usdNotional: classification.usdNotional,
      reasonCodes: classification.reasonCodes,
      portfolioOwned: classification.portfolioOwned,
      subjectCanonicalId: input.subjectCanonicalId,
      objectText: `${classification.fromLabel} → ${classification.toLabel}`,
    },
  };
}

export function boundActivityItems<T>(items: T[]): T[] {
  return takeBounded(items, MAX_ADDRESS_ACTIVITY_ITEMS);
}

export { asRecord, parseFinite };
