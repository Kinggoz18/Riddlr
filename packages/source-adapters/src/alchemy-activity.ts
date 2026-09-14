import { MAX_ADDRESS_ACTIVITY_ITEMS, MAX_WEBHOOK_ADDRESSES, takeBounded } from "@riddlr/domain";
import { asRecord, type ParsedAddressTransfer, parseFinite } from "./address-activity.js";
import {
  assertSafeHttpUrl,
  classifyHttpStatus,
  readBoundedJson,
  redactRequestUrl,
  type SourceAdapter,
  type SourceErrorClass,
} from "./types.js";

export const ALCHEMY_ADAPTER_ID = "alchemy";
export const ALCHEMY_FAMILY = "onchain";
export const ALCHEMY_NOTIFY_BASE = "https://dashboard.alchemy.com/api";
export const ALCHEMY_USER_AGENT = "Riddlr/0.1 (https://github.com/Kinggoz18/Riddlr)";

export type ParsedAlchemyEnvelope = {
  webhookId: string;
  eventId: string;
  createdAt?: Date;
  network?: string;
  transfers: ParsedAddressTransfer[];
};

type SourceError = { class: SourceErrorClass; message: string };

function alchemyResponseError(response: Response): SourceError | undefined {
  if (response.status >= 300 && response.status < 400) {
    return { class: "unavailable", message: "Alchemy redirected; redirects are not followed." };
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("text/html")) {
    return { class: "unavailable", message: "Alchemy returned HTML instead of JSON." };
  }
  if (!response.ok) {
    return {
      class: classifyHttpStatus(response.status) as SourceErrorClass,
      message: `Alchemy HTTP ${response.status}`,
    };
  }
  return undefined;
}

function explorerUrl(hash: string): string {
  return `https://etherscan.io/tx/${hash}`;
}

export function parseAlchemyActivityItem(payload: unknown): {
  transfer?: ParsedAddressTransfer;
  errors: SourceError[];
} {
  const row = asRecord(payload);
  if (!row) {
    return { errors: [{ class: "malformed", message: "Alchemy activity item is not an object." }] };
  }
  const hash = typeof row.hash === "string" ? row.hash.trim() : "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    return { errors: [{ class: "malformed", message: "Alchemy activity item is missing hash." }] };
  }
  const fromAddress =
    typeof row.fromAddress === "string" ? row.fromAddress.trim().toLowerCase() : "";
  const toAddress = typeof row.toAddress === "string" ? row.toAddress.trim().toLowerCase() : "";
  if (!fromAddress || !toAddress) {
    return {
      errors: [{ class: "malformed", message: "Alchemy activity item is missing from/to." }],
    };
  }
  const amount = parseFinite(row.value);
  if (amount === undefined) {
    return { errors: [{ class: "malformed", message: "Alchemy activity item is missing value." }] };
  }
  const log = asRecord(row.log);
  const logIndex =
    typeof log?.logIndex === "string"
      ? log.logIndex
      : typeof row.typeTraceAddress === "string"
        ? row.typeTraceAddress
        : "0x0";
  const rawContract = asRecord(row.rawContract);
  const contractAddress =
    typeof rawContract?.address === "string" ? rawContract.address.trim().toLowerCase() : undefined;
  const asset = typeof row.asset === "string" && row.asset.trim() ? row.asset.trim() : "ETH";
  const category = typeof row.category === "string" ? row.category : "unknown";
  return {
    transfer: {
      txHash: hash.toLowerCase(),
      logIndex,
      fromAddress,
      toAddress,
      assetSymbol: asset,
      contractAddress,
      amount,
      chain: "ethereum",
      explorerUrl: explorerUrl(hash.toLowerCase()),
      category,
    },
    errors: [],
  };
}

export function parseAlchemyAddressActivity(payload: unknown): {
  envelope?: ParsedAlchemyEnvelope;
  errors: SourceError[];
} {
  const row = asRecord(payload);
  if (!row) {
    return { errors: [{ class: "malformed", message: "Alchemy webhook body is not an object." }] };
  }
  const webhookId = typeof row.webhookId === "string" ? row.webhookId.trim() : "";
  const eventId = typeof row.id === "string" ? row.id.trim() : "";
  if (!webhookId || !eventId) {
    return {
      errors: [{ class: "malformed", message: "Alchemy webhook is missing webhookId or id." }],
    };
  }
  const createdAt =
    typeof row.createdAt === "string" && row.createdAt.trim() ? new Date(row.createdAt) : undefined;
  const event = asRecord(row.event);
  const activity = event?.activity;
  if (!Array.isArray(activity)) {
    return { errors: [{ class: "malformed", message: "Alchemy event is missing activity." }] };
  }
  const transfers: ParsedAddressTransfer[] = [];
  const errors: SourceError[] = [];
  for (const item of takeBounded(activity, MAX_ADDRESS_ACTIVITY_ITEMS)) {
    const parsed = parseAlchemyActivityItem(item);
    errors.push(...parsed.errors);
    if (parsed.transfer) {
      transfers.push(parsed.transfer);
    }
  }
  return {
    envelope: {
      webhookId,
      eventId,
      createdAt: createdAt && Number.isFinite(createdAt.getTime()) ? createdAt : undefined,
      network: typeof event?.network === "string" ? event.network : undefined,
      transfers,
    },
    errors,
  };
}

export function parseAlchemyCreateWebhook(payload: unknown): {
  webhookId?: string;
  signingKey?: string;
  isActive?: boolean;
  errors: SourceError[];
} {
  const row = asRecord(payload);
  if (!row) {
    return {
      errors: [{ class: "malformed", message: "Alchemy create-webhook body is not an object." }],
    };
  }
  const data = asRecord(row.data) ?? row;
  const webhookId =
    typeof data.id === "string"
      ? data.id.trim()
      : typeof data.webhook_id === "string"
        ? data.webhook_id.trim()
        : "";
  const signingKey = typeof data.signing_key === "string" ? data.signing_key : undefined;
  if (!webhookId || !signingKey) {
    return {
      errors: [
        { class: "malformed", message: "Alchemy create-webhook is missing id or signing_key." },
      ],
    };
  }
  return {
    webhookId,
    signingKey,
    isActive: data.is_active !== false,
    errors: [],
  };
}

export function parseAlchemyTeamWebhooks(
  payload: unknown,
  webhookId: string,
): { active?: boolean; errors: SourceError[] } {
  const row = asRecord(payload);
  if (!row) {
    return {
      errors: [{ class: "malformed", message: "Alchemy team-webhooks body is not an object." }],
    };
  }
  const list = Array.isArray(row.data) ? row.data : Array.isArray(row) ? row : undefined;
  if (!list) {
    return { errors: [{ class: "malformed", message: "Alchemy team-webhooks is missing data." }] };
  }
  for (const item of takeBounded(list, 100)) {
    const entry = asRecord(item);
    const id = typeof entry?.id === "string" ? entry.id : "";
    if (id === webhookId) {
      return { active: entry?.is_active !== false, errors: [] };
    }
  }
  return {
    errors: [
      {
        class: "capability_missing",
        message: `Alchemy webhook ${webhookId} is not in team-webhooks.`,
      },
    ],
  };
}

async function notifyJson(
  fetchImpl: typeof fetch,
  path: string,
  token: string,
  init?: { method?: string; body?: unknown },
) {
  assertSafeHttpUrl(`${ALCHEMY_NOTIFY_BASE}${path}`);
  const response = await fetchImpl(`${ALCHEMY_NOTIFY_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-alchemy-token": token,
      "user-agent": ALCHEMY_USER_AGENT,
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
    redirect: "manual",
  });
  return response;
}

export function createAlchemyAdapter(fetchImpl: typeof fetch = fetch): SourceAdapter {
  return {
    id: ALCHEMY_ADAPTER_ID,
    family: ALCHEMY_FAMILY,
    capabilities: {
      modes: ["webhook"],
      supportsTimeRange: false,
      supportsPagination: false,
      supportsDomainFilter: false,
      lookbackNotes:
        "Opt-in inbound ADDRESS_ACTIVITY webhooks. Notify token creates the webhook. Signing key is stored encrypted. Scan poll is empty; processing is on riddlr.observe.poll inbound jobs. Balance snapshots are not shipped.",
      partialResults: true,
    },
    async validate() {
      return { ok: true, message: "ok" };
    },
    async healthCheck(config) {
      const token = typeof config.token === "string" ? config.token : "";
      const webhookId = typeof config.webhookId === "string" ? config.webhookId : "";
      if (!token || !webhookId) {
        return {
          ok: false,
          message: "Alchemy Notify token or webhook id is missing. Re-save the source.",
        };
      }
      try {
        const response = await notifyJson(fetchImpl, "/team-webhooks", token);
        const responseError = alchemyResponseError(response);
        if (responseError) {
          return { ok: false, message: responseError.message };
        }
        const payload = await readBoundedJson(response, 2_000_000);
        const parsed = parseAlchemyTeamWebhooks(payload, webhookId);
        if (parsed.errors[0]) {
          return { ok: false, message: parsed.errors[0].message };
        }
        if (parsed.active === false) {
          return {
            ok: false,
            message:
              "Alchemy webhook is_active is false. Re-enable it in the Alchemy dashboard or re-save the source.",
          };
        }
        return { ok: true, message: "Alchemy webhook is active." };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "Alchemy health check failed.",
        };
      }
    },
    async fetch() {
      return { evidence: [], partial: false, errors: [], unresponsiveEngines: [] };
    },
  };
}

export async function createAlchemyAddressWebhook(input: {
  fetchImpl?: typeof fetch;
  notifyToken: string;
  webhookUrl: string;
  network: string;
  addresses: string[];
}): Promise<{ webhookId?: string; signingKey?: string; errors: SourceError[] }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await notifyJson(fetchImpl, "/create-webhook", input.notifyToken, {
      method: "POST",
      body: {
        network: input.network,
        webhook_type: "ADDRESS_ACTIVITY",
        webhook_url: input.webhookUrl,
        addresses: takeBounded(input.addresses, MAX_WEBHOOK_ADDRESSES),
      },
    });
    const responseError = alchemyResponseError(response);
    if (responseError) {
      return { errors: [responseError] };
    }
    const payload = await readBoundedJson(response, 2_000_000);
    return parseAlchemyCreateWebhook(payload);
  } catch (error) {
    return {
      errors: [
        {
          class: "unavailable",
          message: error instanceof Error ? error.message : "Alchemy create-webhook failed.",
        },
      ],
    };
  }
}

export async function updateAlchemyWebhookAddresses(input: {
  fetchImpl?: typeof fetch;
  notifyToken: string;
  webhookId: string;
  add: string[];
  remove: string[];
}): Promise<{ errors: SourceError[] }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await notifyJson(fetchImpl, "/update-webhook-addresses", input.notifyToken, {
      method: "PATCH",
      body: {
        webhook_id: input.webhookId,
        addresses_to_add: takeBounded(input.add, MAX_WEBHOOK_ADDRESSES),
        addresses_to_remove: takeBounded(input.remove, MAX_WEBHOOK_ADDRESSES),
      },
    });
    const responseError = alchemyResponseError(response);
    if (responseError) {
      return { errors: [responseError] };
    }
    return { errors: [] };
  } catch (error) {
    return {
      errors: [
        {
          class: "unavailable",
          message:
            error instanceof Error ? error.message : "Alchemy update-webhook-addresses failed.",
        },
      ],
    };
  }
}

export { redactRequestUrl };
