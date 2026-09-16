import { takeBounded } from "./limits.js";

export const DEFAULT_PRICE_TRACKER_HOSTS = [
  "coingecko.com",
  "coinmarketcap.com",
  "tradingview.com",
  "coinpaprika.com",
  "coincodex.com",
  "livecoinwatch.com",
  "cryptorank.io",
  "coinlore.com",
] as const;

export const DEFAULT_REPUTABLE_PRESS_HOSTS = [
  "reuters.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "apnews.com",
  "coindesk.com",
  "theblock.co",
  "cointelegraph.com",
  "decrypt.co",
  "blockworks.co",
  "dlnews.com",
  "thedefiant.io",
] as const;

export const DEFAULT_OFFICIAL_FIRSTHAND_HOSTS = [
  "sec.gov",
  "cftc.gov",
  "treasury.gov",
  "federalreserve.gov",
  "tether.to",
  "circle.com",
  "ethereum.org",
] as const;

export const MAX_PUBLISHER_HOST_POLICIES = 256;

export type PublisherHostPolicyInput = {
  hostname: string;
  blocked: boolean;
  revision: number;
};

export function hostMatchesPublisherPolicy(host: string, pattern: string): boolean {
  const normalizedHost = host.toLowerCase().replace(/\.+$/, "");
  const normalizedPattern = pattern.toLowerCase().replace(/\.+$/, "");
  return normalizedHost === normalizedPattern || normalizedHost.endsWith(`.${normalizedPattern}`);
}

export function latestPublisherHostPolicies(
  rows: readonly PublisherHostPolicyInput[],
): Map<string, PublisherHostPolicyInput> {
  const latest = new Map<string, PublisherHostPolicyInput>();
  for (const row of takeBounded(rows, MAX_PUBLISHER_HOST_POLICIES)) {
    const hostname = row.hostname.toLowerCase();
    const current = latest.get(hostname);
    if (!current || row.revision > current.revision) {
      latest.set(hostname, { ...row, hostname });
    }
  }
  return latest;
}

export function publisherHostIsBlocked(
  hostname: string,
  policies: readonly PublisherHostPolicyInput[],
): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  const latest = latestPublisherHostPolicies(policies);
  for (const policy of latest.values()) {
    if (hostMatchesPublisherPolicy(host, policy.hostname)) {
      return policy.blocked;
    }
  }
  return DEFAULT_PRICE_TRACKER_HOSTS.some((item) => hostMatchesPublisherPolicy(host, item));
}

export function blockedPublisherHosts(policies: readonly PublisherHostPolicyInput[]): string[] {
  const latest = latestPublisherHostPolicies(policies);
  const blocked: string[] = [];
  for (const policy of latest.values()) {
    if (policy.blocked) {
      blocked.push(policy.hostname);
    }
  }
  for (const host of DEFAULT_PRICE_TRACKER_HOSTS) {
    const overridden = [...latest.values()].some(
      (policy) =>
        hostMatchesPublisherPolicy(host, policy.hostname) ||
        hostMatchesPublisherPolicy(policy.hostname, host),
    );
    if (!overridden) {
      blocked.push(host);
    }
  }
  return takeBounded(blocked, MAX_PUBLISHER_HOST_POLICIES);
}
