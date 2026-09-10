export const PORTFOLIO_CHAINS = ["ethereum", "bitcoin", "solana", "other"] as const;
export type PortfolioChain = (typeof PORTFOLIO_CHAINS)[number];

export class PrivateMaterialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivateMaterialError";
  }
}

export class InvalidWalletAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWalletAddressError";
  }
}

const HEX_PRIVATE_KEY = /^(0x)?[0-9a-f]{64}$/i;
const ETHEREUM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BITCOIN_ADDRESS = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/;
const OTHER_ADDRESS = /^[1-9A-HJ-NP-Za-z]{8,90}$/;

export function rejectPrivateMaterial(value: string): void {
  const trimmed = value.trim();
  if (HEX_PRIVATE_KEY.test(trimmed.replace(/\s+/g, ""))) {
    throw new PrivateMaterialError("Private keys are not accepted.");
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 12 && words.length <= 24 && words.every((word) => /^[a-z]+$/i.test(word))) {
    throw new PrivateMaterialError("Seed phrases are not accepted.");
  }
}

export function assertPublicWalletAddress(chain: string, address: string): string {
  const trimmed = address.trim();
  rejectPrivateMaterial(trimmed);
  if (!PORTFOLIO_CHAINS.includes(chain as PortfolioChain)) {
    throw new InvalidWalletAddressError("Unsupported chain.");
  }
  if (chain === "ethereum" && ETHEREUM_ADDRESS.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  if (chain === "solana" && SOLANA_ADDRESS.test(trimmed) && !HEX_PRIVATE_KEY.test(trimmed)) {
    return trimmed;
  }
  if (chain === "bitcoin" && BITCOIN_ADDRESS.test(trimmed)) {
    return trimmed;
  }
  if (chain === "other" && OTHER_ADDRESS.test(trimmed) && !HEX_PRIVATE_KEY.test(trimmed)) {
    return trimmed;
  }
  throw new InvalidWalletAddressError("Wallet address is not a public identifier for this chain.");
}
