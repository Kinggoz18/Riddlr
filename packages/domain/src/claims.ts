import { createHash } from "node:crypto";
import { z } from "zod";
import { contentHash, normalizeText } from "./evidence.js";
import { takeBounded } from "./limits.js";
import type { MarketDomainId } from "./market-domains.js";
import {
  CLAIM_MODALITIES,
  CLAIM_POLARITIES,
  CLAIM_STANCES,
  type ClaimModality,
  type ClaimPolarity,
  type ClaimStance,
} from "./reliability.js";

export const MAX_CLAIMS_PER_DOCUMENT = 8;
export const MAX_CLAIM_EXCERPT_CHARS = 500;
export const CLAIM_KIND_RE = /^[a-z][a-z0-9-]{1,32}:[a-z][a-z0-9_]{1,64}$/;
export const CLAIM_UNITS = ["percent", "usd", "votes", "tokens", "bps", "iso_date"] as const;
export type ClaimUnit = (typeof CLAIM_UNITS)[number];

export function isClaimUnit(value: string | undefined): value is ClaimUnit {
  return Boolean(value && (CLAIM_UNITS as readonly string[]).includes(value));
}

export const claimCandidateSchema = z
  .object({
    kind: z.string().min(3),
    subjectCanonicalId: z.string().max(160).optional(),
    predicate: z.string().min(1),
    objectText: z.string().max(280).optional(),
    value: z.union([z.number(), z.string(), z.boolean(), z.null()]).optional(),
    unit: z.enum(CLAIM_UNITS).optional(),
    polarity: z.enum(CLAIM_POLARITIES),
    modality: z.enum(CLAIM_MODALITIES),
    excerpt: z.string().min(1).max(MAX_CLAIM_EXCERPT_CHARS),
    attributedOrigin: z.string().max(280).optional(),
  })
  .strict();

export type ClaimCandidate = z.infer<typeof claimCandidateSchema>;

export type NormalizedClaim = {
  marketDomainId: MarketDomainId;
  kind: string;
  subjectCanonicalId?: string;
  predicate: string;
  objectText?: string;
  value?: number | string | boolean | null;
  unit?: string;
  polarity: ClaimPolarity;
  modality: ClaimModality;
  fingerprint: string;
  title: string;
  excerpt?: string;
  effectiveStart?: Date;
  effectiveEnd?: Date;
};

export function assertClaimKind(kind: string, allowed: readonly string[]): string {
  if (!CLAIM_KIND_RE.test(kind) || !allowed.includes(kind)) {
    throw new Error(`Unsupported claim kind: ${kind}`);
  }
  return kind;
}

export function fingerprintClaim(input: {
  marketDomainId: string;
  kind: string;
  subjectCanonicalId?: string;
  polarity: ClaimPolarity;
  objectText?: string;
  value?: number | string | boolean | null;
  timeBucket?: string;
}): string {
  const basis = [
    input.marketDomainId,
    input.kind,
    input.subjectCanonicalId ?? "",
    input.polarity,
    normalizeText(input.objectText),
    input.value === undefined || input.value === null ? "" : String(input.value),
    input.timeBucket ?? "unknown-window",
  ].join("|");
  return createHash("sha256").update(basis).digest("hex");
}

export function excerptPresent(excerpt: string, content: string): boolean {
  const needle = normalizeText(excerpt);
  if (!needle) {
    return false;
  }
  return normalizeText(content).includes(needle);
}

export function excerptHash(excerpt: string): string {
  return contentHash(normalizeText(excerpt));
}

export function excerptOffsets(excerpt: string, content: string): { start?: number; end?: number } {
  const exact = content.indexOf(excerpt);
  if (exact >= 0) {
    return { start: exact, end: exact + excerpt.length };
  }
  return {};
}

export function claimGroupKey(input: { kind: string; subjectCanonicalId?: string }): string {
  return `${input.kind}|${input.subjectCanonicalId ?? ""}`;
}

export function claimStanceFromExtraction(input: {
  polarity: ClaimPolarity;
  modality: ClaimModality;
  attributedToOtherOrigin?: boolean;
  attributedOrigin?: string;
  retracting?: boolean;
  hasAssertedCounterpart?: boolean;
}): ClaimStance {
  if (input.retracting) {
    return "retracts";
  }
  if (
    (input.polarity === "negated" || input.modality === "denied") &&
    input.hasAssertedCounterpart
  ) {
    return "contradicts";
  }
  if (input.attributedToOtherOrigin && (input.attributedOrigin ?? "").trim().length > 0) {
    return "derived_from";
  }
  return "supports";
}

export function hasAssertedClaimCounterpart(
  claim: { kind: string; subjectCanonicalId?: string; polarity: ClaimPolarity },
  others: ReadonlyArray<{ kind: string; subjectCanonicalId?: string; polarity: ClaimPolarity }>,
): boolean {
  return others.some(
    (item) =>
      item.polarity === "asserted" &&
      item.kind === claim.kind &&
      (item.subjectCanonicalId ?? "") === (claim.subjectCanonicalId ?? ""),
  );
}

export function registryContainsCanonicalId(
  registry: ReadonlyArray<{ canonicalId: string; aliases?: readonly string[] }>,
  canonicalId: string,
): boolean {
  return registry.some(
    (asset) => asset.canonicalId === canonicalId || (asset.aliases ?? []).includes(canonicalId),
  );
}

export function acceptedSubjectCanonicalId(input: {
  candidateId?: string;
  fallbackId?: string;
  registry: ReadonlyArray<{ canonicalId: string; aliases?: readonly string[] }>;
  allowedSubjectIds?: readonly string[];
  subjectFree?: boolean;
}): string | undefined {
  const allowed = input.allowedSubjectIds ? new Set(input.allowedSubjectIds) : undefined;
  const usable = (id: string | undefined): string | undefined => {
    if (!id) {
      return undefined;
    }
    if (allowed && !allowed.has(id)) {
      return undefined;
    }
    if (input.registry.length > 0 && !registryContainsCanonicalId(input.registry, id)) {
      return undefined;
    }
    return id;
  };
  if (input.subjectFree) {
    return input.candidateId ? usable(input.candidateId) : undefined;
  }
  if (input.candidateId) {
    return usable(input.candidateId);
  }
  return usable(input.fallbackId);
}

export function weakClaimObject(objectText?: string): boolean {
  const value = normalizeText(objectText);
  if (!value) {
    return true;
  }
  return /^(?:\d+\s*)?(?:hours?|days?|weeks?|months?|today|yesterday|price|chart|news|usd)$/.test(
    value,
  );
}

export function claimsCompatible(left: NormalizedClaim, right: NormalizedClaim): boolean {
  if (left.marketDomainId !== right.marketDomainId) {
    return false;
  }
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.fingerprint === right.fingerprint) {
    return true;
  }
  if (
    left.subjectCanonicalId &&
    right.subjectCanonicalId &&
    left.subjectCanonicalId !== right.subjectCanonicalId
  ) {
    return false;
  }
  if (left.polarity !== right.polarity) {
    return false;
  }
  const leftObject = normalizeText(left.objectText);
  const rightObject = normalizeText(right.objectText);
  return leftObject.length >= 8 && leftObject === rightObject;
}

export function claimTitle(claim: NormalizedClaim): string {
  const subject = inputSubject(claim.subjectCanonicalId);
  const object = claim.objectText ? ` ${claim.objectText}` : "";
  return `${subject}${subject ? ": " : ""}${claim.predicate}${object}`.trim();
}

function inputSubject(canonicalId?: string): string {
  if (!canonicalId) {
    return "";
  }
  const local = canonicalId.split(":")[1];
  return local ? local.replace(/-/g, " ") : canonicalId;
}

export function takeClaims<T>(items: readonly T[]): T[] {
  return takeBounded(items, MAX_CLAIMS_PER_DOCUMENT);
}

export { CLAIM_STANCES };
export type { ClaimStance };
