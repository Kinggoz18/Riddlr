import { MAX_ADDRESS_ACTIVITY_ITEMS, MAX_WEBHOOK_ADDRESSES, takeBounded } from "@riddlr/domain";
import { asRecord, type ParsedAddressTransfer, parseFinite } from "./address-activity.js";
import {
  assertSafeHttpUrl,
  classifyHttpStatus,
  readBoundedJson,
  type SourceAdapter,
  type SourceErrorClass,
} from "./types.js";

export const HELIUS_ADAPTER_ID = "helius";
export const HELIUS_FAMILY = "onchain";
export const HELIUS_API_BASE = "https://api.helius.xyz/v0";
export const HELIUS_USER_AGENT = "Riddlr/0.1 (https://github.com/Kinggoz18/Riddlr)";
const LAMPORTS_PER_SOL = 1_000_000_000;

export type ParsedHeliusEnvelope = {
  eventId: string;
  createdAt?: Date;
  transfers: ParsedAddressTransfer[];
};

type SourceError = { class: SourceErrorClass; message: string };

function heliusResponseError(response: Response): SourceError | undefined {
  if (response.status >= 300 && response.status < 400) {
    return { class: "unavailable", message: "Helius redirected; redirects are not followed." };
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("text/html")) {
    return { class: "unavailable", message: "Helius returned HTML instead of JSON." };
  }
  if (!response.ok) {
    return {
      class: classifyHttpStatus(response.status) as SourceErrorClass,
      message: `Helius HTTP ${response.status}`,
    };
  }
  return undefined;
}

function explorerUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

function nativeTransfer(
  signature: string,
  index: number,
  item: unknown,
): { transfer?: ParsedAddressTransfer; errors: SourceError[] } {
  const row = asRecord(item);
  if (!row) {
    return {
      errors: [{ class: "malformed", message: "Helius native transfer is not an object." }],
    };
  }
  const fromAddress = typeof row.fromUserAccount === "string" ? row.fromUserAccount.trim() : "";
  const toAddress = typeof row.toUserAccount === "string" ? row.toUserAccount.trim() : "";
  const lamports = parseFinite(row.amount);
  if (!fromAddress || !toAddress || lamports === undefined) {
    return {
      errors: [
        { class: "malformed", message: "Helius native transfer is missing accounts or amount." },
      ],
    };
  }
  return {
    transfer: {
      txHash: signature,
      logIndex: `native:${index}`,
      fromAddress,
      toAddress,
      assetSymbol: "SOL",
      amount: lamports / LAMPORTS_PER_SOL,
      chain: "solana",
      explorerUrl: explorerUrl(signature),
      category: "native",
    },
    errors: [],
  };
}

function tokenTransfer(
  signature: string,
  index: number,
  item: unknown,
): { transfer?: ParsedAddressTransfer; errors: SourceError[] } {
  const row = asRecord(item);
  if (!row) {
    return { errors: [{ class: "malformed", message: "Helius token transfer is not an object." }] };
  }
  const fromAddress = typeof row.fromUserAccount === "string" ? row.fromUserAccount.trim() : "";
  const toAddress = typeof row.toUserAccount === "string" ? row.toUserAccount.trim() : "";
  const mint = typeof row.mint === "string" ? row.mint.trim() : undefined;
  const amount = parseFinite(row.tokenAmount);
  if (!fromAddress || !toAddress || amount === undefined) {
    return {
      errors: [
        { class: "malformed", message: "Helius token transfer is missing accounts or amount." },
      ],
    };
  }
  return {
    transfer: {
      txHash: signature,
      logIndex: `token:${index}`,
      fromAddress,
      toAddress,
      assetSymbol: mint ? mint.slice(0, 8) : "SPL",
      contractAddress: mint,
      amount,
      chain: "solana",
      explorerUrl: explorerUrl(signature),
      category: "token",
    },
    errors: [],
  };
}

export function parseHeliusEnhancedPayload(payload: unknown): {
  envelopes: ParsedHeliusEnvelope[];
  errors: SourceError[];
} {
  if (!Array.isArray(payload)) {
    return {
      envelopes: [],
      errors: [{ class: "malformed", message: "Helius webhook body is not an array." }],
    };
  }
  const envelopes: ParsedHeliusEnvelope[] = [];
  const errors: SourceError[] = [];
  for (const item of takeBounded(payload, MAX_ADDRESS_ACTIVITY_ITEMS)) {
    const row = asRecord(item);
    if (!row) {
      errors.push({ class: "malformed", message: "Helius transaction is not an object." });
      continue;
    }
    const signature = typeof row.signature === "string" ? row.signature.trim() : "";
    if (!signature) {
      errors.push({ class: "malformed", message: "Helius transaction is missing signature." });
      continue;
    }
    const createdAt =
      typeof row.timestamp === "number" && Number.isFinite(row.timestamp)
        ? new Date(row.timestamp * 1000)
        : undefined;
    const transfers: ParsedAddressTransfer[] = [];
    const native = Array.isArray(row.nativeTransfers) ? row.nativeTransfers : [];
    native.forEach((entry, index) => {
      const parsed = nativeTransfer(signature, index, entry);
      errors.push(...parsed.errors);
      if (parsed.transfer) {
        transfers.push(parsed.transfer);
      }
    });
    const tokens = Array.isArray(row.tokenTransfers) ? row.tokenTransfers : [];
    tokens.forEach((entry, index) => {
      const parsed = tokenTransfer(signature, index, entry);
      errors.push(...parsed.errors);
      if (parsed.transfer) {
        transfers.push(parsed.transfer);
      }
    });
    envelopes.push({
      eventId: signature,
      createdAt,
      transfers: takeBounded(transfers, MAX_ADDRESS_ACTIVITY_ITEMS),
    });
  }
  return { envelopes, errors };
}

export function parseHeliusCreateWebhook(payload: unknown): {
  webhookId?: string;
  errors: SourceError[];
} {
  const row = asRecord(payload);
  if (!row) {
    return {
      errors: [{ class: "malformed", message: "Helius create-webhook body is not an object." }],
    };
  }
  const webhookId =
    typeof row.webhookID === "string"
      ? row.webhookID.trim()
      : typeof row.webhookId === "string"
        ? row.webhookId.trim()
        : "";
  if (!webhookId) {
    return {
      errors: [{ class: "malformed", message: "Helius create-webhook is missing webhookID." }],
    };
  }
  return { webhookId, errors: [] };
}

export function createHeliusAdapter(): SourceAdapter {
  return {
    id: HELIUS_ADAPTER_ID,
    family: HELIUS_FAMILY,
    capabilities: {
      modes: ["webhook"],
      supportsTimeRange: false,
      supportsPagination: false,
      supportsDomainFilter: false,
      lookbackNotes:
        "Opt-in inbound enhanced TRANSFER webhooks. API key creates the webhook. Auth header is stored encrypted and compared on inbound POSTs. Scan poll is empty. Balance snapshots are not shipped.",
      partialResults: true,
    },
    async validate() {
      return { ok: true, message: "ok" };
    },
    async healthCheck(config) {
      const webhookId = typeof config.webhookId === "string" ? config.webhookId : "";
      if (!webhookId) {
        return {
          ok: false,
          message: "Helius webhook id is missing. Re-save the source.",
        };
      }
      return {
        ok: true,
        message: "Helius webhook id is stored. Inbound POSTs use the auth header.",
      };
    },
    async fetch() {
      return { evidence: [], partial: false, errors: [], unresponsiveEngines: [] };
    },
  };
}

async function heliusJson(
  fetchImpl: typeof fetch,
  url: string,
  init?: { method?: string; body?: unknown },
) {
  assertSafeHttpUrl(url);
  return fetchImpl(url, {
    method: init?.method ?? "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": HELIUS_USER_AGENT,
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
    redirect: "manual",
  });
}

export async function createHeliusTransferWebhook(input: {
  fetchImpl?: typeof fetch;
  apiKey: string;
  webhookUrl: string;
  authHeader: string;
  addresses: string[];
}): Promise<{ webhookId?: string; errors: SourceError[] }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = `${HELIUS_API_BASE}/webhooks?api-key=${encodeURIComponent(input.apiKey)}`;
  try {
    const response = await heliusJson(fetchImpl, url, {
      method: "POST",
      body: {
        webhookURL: input.webhookUrl,
        transactionTypes: ["TRANSFER"],
        accountAddresses: takeBounded(input.addresses, MAX_WEBHOOK_ADDRESSES),
        webhookType: "enhanced",
        authHeader: input.authHeader,
      },
    });
    const responseError = heliusResponseError(response);
    if (responseError) {
      return { errors: [responseError] };
    }
    const payload = await readBoundedJson(response, 2_000_000);
    return parseHeliusCreateWebhook(payload);
  } catch (error) {
    return {
      errors: [
        {
          class: "unavailable",
          message: error instanceof Error ? error.message : "Helius create-webhook failed.",
        },
      ],
    };
  }
}

export async function updateHeliusWebhookAddresses(input: {
  fetchImpl?: typeof fetch;
  apiKey: string;
  webhookId: string;
  webhookUrl: string;
  authHeader: string;
  addresses: string[];
}): Promise<{ errors: SourceError[] }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = `${HELIUS_API_BASE}/webhooks/${encodeURIComponent(input.webhookId)}?api-key=${encodeURIComponent(input.apiKey)}`;
  try {
    const response = await heliusJson(fetchImpl, url, {
      method: "PUT",
      body: {
        webhookURL: input.webhookUrl,
        transactionTypes: ["TRANSFER"],
        accountAddresses: takeBounded(input.addresses, MAX_WEBHOOK_ADDRESSES),
        webhookType: "enhanced",
        authHeader: input.authHeader,
      },
    });
    const responseError = heliusResponseError(response);
    if (responseError) {
      return { errors: [responseError] };
    }
    return { errors: [] };
  } catch (error) {
    return {
      errors: [
        {
          class: "unavailable",
          message: error instanceof Error ? error.message : "Helius update webhook failed.",
        },
      ],
    };
  }
}
