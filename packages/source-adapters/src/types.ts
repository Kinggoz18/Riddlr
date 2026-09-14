import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { RawEvidence } from "@riddlr/domain";

export type SourceErrorClass =
  | "timeout"
  | "rate_limited"
  | "auth"
  | "capability_missing"
  | "malformed"
  | "partial"
  | "unavailable"
  | "blocked"
  | "robots_denied"
  | "unsupported_media"
  | "paywalled"
  | "too_large"
  | "stale"
  | "deleted"
  | "extraction_failed";

export type SourceCapability = {
  modes: Array<"search" | "poll" | "stream" | "webhook">;
  supportsTimeRange: boolean;
  supportsPagination: boolean;
  supportsDomainFilter: boolean;
  lookbackNotes: string;
  partialResults: boolean;
};

export type FetchQuery = {
  query: string;
  language?: string;
  timeRange?: "day" | "month" | "year";
  page?: number;
  limit?: number;
  categories?: string[];
  allowedHosts?: string[];
  blockedHosts?: string[];
};

export type FetchResult = {
  evidence: RawEvidence[];
  partial: boolean;
  errors: Array<{ class: SourceErrorClass; message: string }>;
  unresponsiveEngines: string[];
  requestUrl?: string;
  providerRequestId?: string;
  paginationCursor?: string;
  responseStatus?: number;
  adapterMetadata?: Record<string, unknown>;
};

export type SourceAdapter = {
  id: string;
  family: string;
  capabilities: SourceCapability;
  validate(config: Record<string, unknown>): Promise<{ ok: boolean; message: string }>;
  healthCheck(config: Record<string, unknown>): Promise<{ ok: boolean; message: string }>;
  fetch(config: Record<string, unknown>, query: FetchQuery): Promise<FetchResult>;
};

export class SourceAdapterRegistry {
  private readonly adapters = new Map<string, SourceAdapter>();

  register(adapter: SourceAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): SourceAdapter | undefined {
    return this.adapters.get(id);
  }

  require(id: string): SourceAdapter {
    const found = this.get(id);
    if (!found) {
      throw new Error(`Unknown source adapter: ${id}`);
    }
    return found;
  }
}

export function classifyHttpStatus(status: number): SourceErrorClass {
  if (status === 429) {
    return "rate_limited";
  }
  if (status === 401) {
    return "auth";
  }
  if (status === 403 || status === 402) {
    return "capability_missing";
  }
  if (status >= 500) {
    return "unavailable";
  }
  return "malformed";
}

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
  "169.254.169.254",
  "localtest.me",
  "nip.io",
  "sslip.io",
]);

export function hostMatchesSuffix(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/\.+$/, "");
  const p = pattern.toLowerCase().replace(/\.+$/, "");
  return h === p || h.endsWith(`.${p}`);
}

function ipv4Octets(host: string): number[] | undefined {
  const dotted = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(host);
  if (dotted) {
    const octets = dotted.slice(1).map((part) => Number(part));
    if (octets.some((part) => part > 255)) {
      return undefined;
    }
    return octets;
  }
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
  if (!hex?.[1] || !hex[2]) {
    return undefined;
  }
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return [(high >> 8) & 255, high & 255, (low >> 8) & 255, low & 255];
}

export function isBlockedIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const octets = ipv4Octets(address);
    if (!octets) {
      return true;
    }
    const [a, b] = octets;
    if (a === undefined || b === undefined) {
      return true;
    }
    if (a === 0 || a === 10 || a === 127) {
      return true;
    }
    if (a === 169 && b === 254) {
      return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }
    if (a === 192 && b === 168) {
      return true;
    }
    if (a === 100 && b >= 64 && b <= 127) {
      return true;
    }
    return false;
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("::ffff:")
    );
  }
  return true;
}

export function isBlockedSsrfHost(host: string, allowComposeHosts: string[] = []): boolean {
  const normalized = host.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.+$/, "");
  if (allowComposeHosts.some((item) => hostMatchesSuffix(normalized, item))) {
    return false;
  }
  if (
    BLOCKED_HOSTS.has(normalized) ||
    [...BLOCKED_HOSTS].some((blocked) => hostMatchesSuffix(normalized, blocked)) ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".localhost")
  ) {
    return true;
  }
  if (isIP(normalized)) {
    return isBlockedIpAddress(normalized);
  }
  const octets = ipv4Octets(normalized);
  if (octets) {
    return isBlockedIpAddress(octets.join("."));
  }
  if (
    normalized === "::1" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  ) {
    return true;
  }
  return false;
}

export function assertSafeHttpUrl(value: string, allowComposeHosts: string[] = []): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must be http or https.");
  }
  if (url.port && !["", "80", "443", "8080", "3001", "1025"].includes(url.port)) {
    if (!allowComposeHosts.some((item) => hostMatchesSuffix(url.hostname, item))) {
      throw new Error("URL port is not allowed.");
    }
  }
  if (isBlockedSsrfHost(url.hostname, allowComposeHosts)) {
    throw new Error("URL host is not allowed.");
  }
  return url;
}

export type LookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

async function defaultLookup(
  hostname: string,
): Promise<Array<{ address: string; family: number }>> {
  const v4 = await dnsLookup(hostname, { all: true, verbatim: true });
  return v4.map((item) => ({ address: item.address, family: item.family }));
}

export async function assertSafeResolvedHttpUrl(
  value: string,
  allowComposeHosts: string[] = [],
  lookup: LookupFn = defaultLookup,
): Promise<URL> {
  const url = assertSafeHttpUrl(value, allowComposeHosts);
  if (allowComposeHosts.some((item) => hostMatchesSuffix(url.hostname, item))) {
    return url;
  }
  if (isIP(url.hostname)) {
    if (isBlockedIpAddress(url.hostname)) {
      throw new Error("URL host is not allowed.");
    }
    return url;
  }
  const records = await lookup(url.hostname);
  if (records.length === 0) {
    throw new Error("URL host could not be resolved.");
  }
  for (const record of records) {
    if (isBlockedIpAddress(record.address)) {
      throw new Error("URL host resolved to a blocked address.");
    }
  }
  return url;
}

export function redactRequestUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/token|key|secret|auth|password|bearer/i.test(key)) {
        parsed.searchParams.set(key, "[redacted]");
      }
    }
    return parsed.toString();
  } catch {
    return "[invalid-url]";
  }
}

const MAX_SAFE_FETCH_BYTES = 1_000_000;

export async function safeFetch(
  input: string | URL,
  init: RequestInit & {
    allowComposeHosts?: string[];
    lookup?: LookupFn;
    maxBytes?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<Response> {
  const href = typeof input === "string" ? input : input.href;
  const url = await assertSafeResolvedHttpUrl(href, init.allowComposeHosts ?? [], init.lookup);
  const fetchImpl = init.fetchImpl ?? fetch;
  const {
    allowComposeHosts: _allow,
    lookup: _lookup,
    maxBytes: _max,
    fetchImpl: _fetch,
    ...rest
  } = init;
  const response = await fetchImpl(url, {
    ...rest,
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) {
      return response;
    }
    const next = new URL(location, url);
    await assertSafeResolvedHttpUrl(next.href, init.allowComposeHosts ?? [], init.lookup);
    return response;
  }
  const length = Number(response.headers.get("content-length") ?? "0");
  const maxBytes = init.maxBytes ?? MAX_SAFE_FETCH_BYTES;
  if (length > maxBytes) {
    throw new Error("Provider response exceeded the size bound.");
  }
  return response;
}

export async function readBoundedJson(
  response: Response,
  maxBytes = MAX_SAFE_FETCH_BYTES,
): Promise<unknown> {
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw new Error("Provider response exceeded the size bound.");
  }
  return JSON.parse(buffer.toString("utf8")) as unknown;
}

export async function readBoundedBytes(
  response: Response,
  maxBytes = MAX_SAFE_FETCH_BYTES,
): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new Error("Provider response exceeded the size bound.");
    }
    return buffer;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Provider response exceeded the size bound.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function safeFetchFollow(
  input: string,
  init: RequestInit & {
    allowComposeHosts?: string[];
    lookup?: LookupFn;
    maxBytes?: number;
    fetchImpl?: typeof fetch;
    maxRedirects?: number;
  } = {},
): Promise<{ response: Response; finalUrl: string }> {
  const maxRedirects = init.maxRedirects ?? 3;
  let current = input;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const response = await safeFetch(current, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) {
      return { response, finalUrl: current };
    }
    const location = response.headers.get("location");
    if (!location) {
      return { response, finalUrl: current };
    }
    if (hop === maxRedirects) {
      throw new Error("Too many redirects.");
    }
    current = new URL(location, current).href;
  }
  throw new Error("Too many redirects.");
}
