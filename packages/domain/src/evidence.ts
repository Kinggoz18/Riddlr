import { createHash } from "node:crypto";

export type EvidenceRole = "primary" | "supporting" | "derived" | "contradicting";

export type RawEvidence = {
  sourceFamily: string;
  adapterId: string;
  externalId?: string;
  url?: string;
  canonicalUrl?: string;
  title?: string;
  bodyText?: string;
  author?: string;
  publishedAt?: Date;
  fetchedAt: Date;
  language?: string;
  adapterPayload?: Record<string, unknown>;
};

export type NormalizedEvidence = RawEvidence & {
  canonicalUrl?: string;
  contentHash: string;
  fingerprint: string;
  normalizedTitle: string;
  normalizedText: string;
};

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
]);

export function canonicalizeUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.pathname.endsWith("/") && parsed.pathname !== "/") {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    const keys = [...parsed.searchParams.keys()];
    for (const key of keys) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function normalizeText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function fingerprintEvidence(input: {
  sourceFamily: string;
  canonicalUrl?: string;
  publishedAt?: Date;
  title?: string;
  hostname?: string;
}): string {
  const day = input.publishedAt ? input.publishedAt.toISOString().slice(0, 10) : "unknown-day";
  const basis = input.canonicalUrl
    ? `${input.sourceFamily}|${input.canonicalUrl}|${day}`
    : `${input.sourceFamily}|${normalizeText(input.title)}|${input.hostname ?? "unknown-host"}|${day}`;
  return createHash("sha256").update(basis).digest("hex");
}

export function normalizeEvidence(raw: RawEvidence): NormalizedEvidence {
  const canonicalUrl = canonicalizeUrl(raw.canonicalUrl ?? raw.url);
  let hostname: string | undefined;
  if (canonicalUrl) {
    try {
      hostname = new URL(canonicalUrl).hostname;
    } catch {
      hostname = undefined;
    }
  }
  const normalizedTitle = normalizeText(raw.title);
  const normalizedText = normalizeText(raw.bodyText);
  return {
    ...raw,
    canonicalUrl,
    normalizedTitle,
    normalizedText,
    contentHash: contentHash(
      normalizedText || normalizedTitle || canonicalUrl || raw.externalId || "",
    ),
    fingerprint: fingerprintEvidence({
      sourceFamily: raw.sourceFamily,
      canonicalUrl,
      publishedAt: raw.publishedAt,
      title: raw.title,
      hostname,
    }),
  };
}

export function independenceCounts(roles: EvidenceRole[]): {
  independentSourceCount: number;
  derivedReprintCount: number;
} {
  return {
    independentSourceCount: roles.filter((role) => role === "primary" || role === "supporting")
      .length,
    derivedReprintCount: roles.filter((role) => role === "derived").length,
  };
}

export function classifyReprint(params: {
  sameCanonicalUrl: boolean;
  sameContentHash: boolean;
  nearDuplicate?: boolean;
  sameHostnameSameDay?: boolean;
}): EvidenceRole {
  if (params.sameCanonicalUrl || params.sameContentHash || params.nearDuplicate) {
    return "derived";
  }
  if (params.sameHostnameSameDay) {
    return "derived";
  }
  return "primary";
}

export function uniqueIndependentHostCount(
  items: Array<{ hostname: string; role: EvidenceRole }>,
): number {
  return new Set(
    items
      .filter((item) => item.role === "primary" || item.role === "supporting")
      .map((item) => item.hostname),
  ).size;
}
