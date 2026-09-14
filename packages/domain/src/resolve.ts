import type { ExtractedAsset, RegistryAsset } from "./domain-module.js";
import { MAX_ALIASES_PER_ASSET, MAX_ASSETS_PER_DOCUMENT, takeBounded } from "./limits.js";
import { ASSET_CLASS_DOMAIN } from "./market-domains.js";

export type ResolverRules = {
  minAliasLength: number;
  cashtagMinLength: number;
  ambiguousSymbols: readonly string[];
  commonWordNames: readonly string[];
  perDocumentCap: number;
};

export type AliasMatchKind = "contract" | "caip19" | "cashtag" | "name" | "symbol" | "slug";

const WORD_BOUNDARY = /[^\p{L}\p{N}$]/u;

export function normalizeAlias(value: string): string {
  return value.normalize("NFC").trim().toLowerCase();
}

export function toExtractedAsset(asset: RegistryAsset): ExtractedAsset {
  return {
    assetClass: asset.assetClass,
    canonicalId: asset.canonicalId,
    symbol: asset.symbol ?? undefined,
    displayName: asset.name ?? undefined,
  };
}

export function identifierUnresolved(
  asset: Pick<RegistryAsset, "assetClass" | "externalIds">,
): boolean {
  if (ASSET_CLASS_DOMAIN[asset.assetClass] !== "equities") {
    return false;
  }
  return !asset.externalIds.figi;
}

export function aliasesForAsset(asset: RegistryAsset): string[] {
  const aliases: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | null | undefined) => {
    if (!raw) {
      return;
    }
    const normalized = normalizeAlias(raw);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    aliases.push(normalized);
  };
  for (const alias of asset.aliases) {
    add(alias);
  }
  add(asset.symbol);
  add(asset.name);
  if (asset.symbol) {
    add(`$${asset.symbol}`);
  }
  add(asset.externalIds.coingeckoId);
  add(asset.externalIds.cik);
  add(asset.externalIds.ticker);
  add(asset.externalIds.figi);
  add(asset.externalIds.isin);
  add(asset.canonicalId);
  const slug = asset.canonicalId.split(":")[1];
  add(slug);
  if (slug?.includes("-")) {
    add(slug.replaceAll("-", " "));
  }
  for (const caip of asset.externalIds.caip19 ?? []) {
    add(caip);
  }
  return takeBounded(aliases, MAX_ALIASES_PER_ASSET);
}

function isEvmAddress(alias: string): boolean {
  return /^0x[a-f0-9]{40}$/.test(alias);
}

function isCaip19(alias: string): boolean {
  return /^(eip155:\d+|solana:[a-z0-9]+)\/(erc20|token):/.test(alias);
}

function isCashtag(alias: string): boolean {
  return alias.startsWith("$");
}

function matchKind(alias: string, asset: RegistryAsset): AliasMatchKind {
  if (isEvmAddress(alias)) {
    return "contract";
  }
  if (isCaip19(alias)) {
    return "caip19";
  }
  if (isCashtag(alias)) {
    return "cashtag";
  }
  if (asset.name && normalizeAlias(asset.name) === alias) {
    return "name";
  }
  if (asset.externalIds.coingeckoId && normalizeAlias(asset.externalIds.coingeckoId) === alias) {
    return "slug";
  }
  const slug = asset.canonicalId.split(":")[1];
  if (
    slug &&
    (normalizeAlias(slug) === alias || normalizeAlias(slug.replaceAll("-", " ")) === alias)
  ) {
    return "slug";
  }
  return "symbol";
}

function confidenceFor(kind: AliasMatchKind): number {
  switch (kind) {
    case "contract":
    case "caip19":
      return 100;
    case "name":
      return 90;
    case "cashtag":
      return 85;
    case "slug":
      return 80;
    default:
      return 70;
  }
}

export function buildAliasIndex(registry: readonly RegistryAsset[]): Map<string, RegistryAsset[]> {
  const index = new Map<string, RegistryAsset[]>();
  for (const asset of takeBounded(registry, registry.length)) {
    for (const alias of aliasesForAsset(asset)) {
      const current = index.get(alias) ?? [];
      if (!current.some((item) => item.canonicalId === asset.canonicalId)) {
        current.push(asset);
        index.set(alias, current);
      }
    }
  }
  return index;
}

function hasWordBoundary(text: string, start: number, end: number): boolean {
  const before = start === 0 ? " " : (text[start - 1] ?? " ");
  const after = end >= text.length ? " " : (text[end] ?? " ");
  return WORD_BOUNDARY.test(before) && WORD_BOUNDARY.test(after);
}

function findAliasSpans(haystack: string, alias: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from <= haystack.length - alias.length) {
    const start = haystack.indexOf(alias, from);
    if (start < 0) {
      break;
    }
    const end = start + alias.length;
    if (isEvmAddress(alias) || isCaip19(alias) || isCashtag(alias) || alias.includes(" ")) {
      spans.push({ start, end });
    } else if (hasWordBoundary(haystack, start, end)) {
      spans.push({ start, end });
    }
    from = start + Math.max(1, alias.length);
  }
  return spans;
}

function namePresent(text: string, asset: RegistryAsset): boolean {
  const name = asset.name ? normalizeAlias(asset.name) : "";
  if (name.length < 4) {
    return false;
  }
  return findAliasSpans(text, name).length > 0;
}

function allowedByRules(
  alias: string,
  kind: AliasMatchKind,
  asset: RegistryAsset,
  candidates: readonly RegistryAsset[],
  text: string,
  rules: ResolverRules,
): boolean {
  if (isEvmAddress(alias) || isCaip19(alias)) {
    return true;
  }
  if (isCashtag(alias)) {
    return alias.length - 1 >= rules.cashtagMinLength;
  }
  if (alias.length < rules.minAliasLength) {
    return false;
  }
  const nameKey = asset.name ? normalizeAlias(asset.name) : "";
  const guarded = rules.ambiguousSymbols.includes(alias) || rules.commonWordNames.includes(alias);
  if (guarded) {
    if (kind === "cashtag") {
      return alias.length - 1 >= rules.cashtagMinLength;
    }
    return nameKey !== alias && namePresent(text, asset);
  }
  if (kind === "name" && rules.commonWordNames.includes(nameKey)) {
    return false;
  }
  if (candidates.length > 1) {
    return namePresent(text, asset);
  }
  return true;
}

export function resolveAssetsInText(
  text: string,
  registry: readonly RegistryAsset[],
  rules: ResolverRules,
): ExtractedAsset[] {
  const haystack = ` ${normalizeAlias(text)} `;
  const index = buildAliasIndex(registry);
  const scored = new Map<string, { asset: RegistryAsset; confidence: number }>();
  for (const [alias, candidates] of index) {
    if (findAliasSpans(haystack, alias).length === 0) {
      continue;
    }
    for (const asset of candidates) {
      const kind = matchKind(alias, asset);
      if (!allowedByRules(alias, kind, asset, candidates, haystack, rules)) {
        continue;
      }
      const confidence = confidenceFor(kind);
      const previous = scored.get(asset.canonicalId);
      if (!previous || previous.confidence < confidence) {
        scored.set(asset.canonicalId, { asset, confidence });
      }
    }
  }
  const ranked = [...scored.values()].sort((left, right) => {
    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }
    const leftRank = left.asset.marketCapRank ?? Number.MAX_SAFE_INTEGER;
    const rightRank = right.asset.marketCapRank ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  });
  const cap = Math.min(rules.perDocumentCap, MAX_ASSETS_PER_DOCUMENT);
  return takeBounded(ranked, cap).map((item) => toExtractedAsset(item.asset));
}

export function resolveEvidenceAssets(
  evidence: Array<{ title?: string | null; bodyText?: string | null }>,
  registry: readonly RegistryAsset[],
  rules: ResolverRules,
): ExtractedAsset[] {
  const found = new Map<string, ExtractedAsset>();
  for (const item of evidence) {
    const extracted = resolveAssetsInText(
      `${item.title ?? ""} ${item.bodyText ?? ""}`,
      registry,
      rules,
    );
    for (const asset of extracted) {
      found.set(asset.canonicalId, asset);
    }
  }
  return [...found.values()];
}

export function canonicalizeFromRegistry(
  input: {
    symbol?: string;
    name?: string;
    canonicalId?: string;
  },
  registry: readonly RegistryAsset[],
): ExtractedAsset | undefined {
  if (input.canonicalId) {
    const canonicalId = input.canonicalId.trim().toLowerCase();
    const found = registry.find((item) => item.canonicalId === canonicalId);
    return found ? toExtractedAsset(found) : undefined;
  }
  const key = normalizeAlias(input.symbol ?? input.name ?? "");
  if (!key) {
    return undefined;
  }
  const matches = registry.filter((item) => {
    const aliases = aliasesForAsset(item);
    return aliases.includes(key) || aliases.includes(`$${key}`);
  });
  if (matches.length !== 1) {
    return undefined;
  }
  const only = matches[0];
  return only ? toExtractedAsset(only) : undefined;
}

export function searchRegistry(
  registry: readonly RegistryAsset[],
  query: string,
  limit: number,
): RegistryAsset[] {
  const active = registry.filter((item) => item.status === "active");
  const ranked = [...active].sort((left, right) => {
    const leftRank = left.marketCapRank ?? Number.MAX_SAFE_INTEGER;
    const rightRank = right.marketCapRank ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  });
  const q = normalizeAlias(query);
  if (!q) {
    return takeBounded(ranked, limit);
  }
  const hits = ranked.filter((item) => {
    const aliases = aliasesForAsset(item);
    return aliases.some((alias) => alias.startsWith(q) || alias.includes(q));
  });
  return takeBounded(hits, limit);
}

export function escapeIlike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
