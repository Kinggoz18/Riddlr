import { isEnglishStopword } from "./english-stopwords.js";
import { MAX_RELEVANCE_TERMS, takeBounded } from "./limits.js";
import { normalizeAlias } from "./resolve.js";

export const RELEVANCE_GATED_FAMILIES = ["search"] as const;

export function isRelevanceGatedFamily(family: string | null | undefined): boolean {
  return family === "search";
}

function hasWordBoundary(text: string, start: number, end: number): boolean {
  const before = start === 0 ? " " : (text[start - 1] ?? " ");
  const after = end >= text.length ? " " : (text[end] ?? " ");
  return /[^\p{L}\p{N}$]/u.test(before) && /[^\p{L}\p{N}$]/u.test(after);
}

export function textContainsRelevanceTerm(text: string, terms: readonly string[]): boolean {
  const haystack = ` ${normalizeAlias(text)} `;
  for (const term of takeBounded(terms, MAX_RELEVANCE_TERMS)) {
    const needle = normalizeAlias(term);
    if (!needle || isEnglishStopword(needle)) {
      continue;
    }
    if (needle.includes(" ")) {
      if (haystack.includes(` ${needle} `) || haystack.includes(needle)) {
        return true;
      }
      continue;
    }
    let from = 0;
    while (from <= haystack.length - needle.length) {
      const start = haystack.indexOf(needle, from);
      if (start < 0) {
        break;
      }
      const end = start + needle.length;
      if (hasWordBoundary(haystack, start, end)) {
        return true;
      }
      from = start + Math.max(1, needle.length);
    }
  }
  return false;
}

export function mentionIsDomainRelevant(input: {
  title?: string | null;
  bodyText?: string | null;
  resolvedCanonicalIds: readonly string[];
  watchlistCanonicalIds: readonly string[];
  relevanceTerms: readonly string[];
}): boolean {
  const watched = new Set(input.watchlistCanonicalIds);
  if (input.resolvedCanonicalIds.some((id) => watched.has(id))) {
    return true;
  }
  return textContainsRelevanceTerm(
    `${input.title ?? ""} ${input.bodyText ?? ""}`,
    input.relevanceTerms,
  );
}
