import { MAX_ENRICH_CHARS } from "./enrichment.js";

export type ExtractedHtml = {
  title?: string;
  byline?: string;
  text: string;
  language?: string;
  failure?: "no_main_content" | "paywall" | "challenge" | "login" | "js_shell";
};

const ENTITY: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function stripChrome(html: string): string {
  return html
    .replace(/<(nav|aside|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ");
}

const CHROME_OUTBOUND_HOSTS = new Set([
  "twitter.com",
  "www.twitter.com",
  "x.com",
  "www.x.com",
  "t.co",
  "facebook.com",
  "www.facebook.com",
  "instagram.com",
  "www.instagram.com",
  "linkedin.com",
  "www.linkedin.com",
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "reddit.com",
  "www.reddit.com",
  "tiktok.com",
  "www.tiktok.com",
  "whatsapp.com",
  "api.whatsapp.com",
  "telegram.org",
  "t.me",
  "accounts.google.com",
  "apple.com",
  "cloudflare.com",
  "doubleclick.net",
]);

export function chromeOutboundHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (CHROME_OUTBOUND_HOSTS.has(host)) {
    return true;
  }
  return [...CHROME_OUTBOUND_HOSTS].some((item) => host.endsWith(`.${item}`));
}

export function preferEvidenceTitle(
  searchTitle?: string,
  extractedTitle?: string,
): string | undefined {
  const search = searchTitle?.trim();
  const extracted = extractedTitle?.trim();
  if (!extracted) {
    return search;
  }
  if (!search) {
    return extracted;
  }
  if (extracted.length < 16 || extracted.length > 160) {
    return search;
  }
  if (search.length >= 24 && extracted.length < search.length * 0.6) {
    return search;
  }
  return extracted;
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, token: string) => {
    if (token.startsWith("#x") || token.startsWith("#X")) {
      const code = Number.parseInt(token.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (token.startsWith("#")) {
      const code = Number.parseInt(token.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITY[token.toLowerCase()] ?? match;
  });
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h1|h2|h3|li|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function firstMatch(html: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(html);
  const value = match
    ?.slice(1)
    .find((item) => item?.trim())
    ?.trim();
  return value ? decodeEntities(value) : undefined;
}

export function extractMainHtml(html: string): ExtractedHtml {
  const bounded = html.slice(0, MAX_ENRICH_CHARS * 4);
  const lower = bounded.toLowerCase();
  if (/just a moment|cf-challenge|captcha/.test(lower)) {
    return { text: "", failure: "challenge" };
  }
  if (/subscribe to continue|paywall|metered content/.test(lower)) {
    return { text: "", failure: "paywall" };
  }
  if (/sign in to continue|log in to read/.test(lower)) {
    return { text: "", failure: "login" };
  }
  const title = firstMatch(bounded, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const byline = firstMatch(
    bounded,
    /<(?:meta[^>]+name=["']author["'][^>]+content=["']([^"']+)|[^>]*class=["'][^"']*author[^"']*["'][^>]*>([\s\S]*?)<)/i,
  );
  const article =
    firstMatch(bounded, /<article[\s\S]*?>([\s\S]*?)<\/article>/i) ??
    firstMatch(bounded, /<main[\s\S]*?>([\s\S]*?)<\/main>/i) ??
    firstMatch(bounded, /<body[\s\S]*?>([\s\S]*?)<\/body>/i) ??
    bounded;
  const text = stripTags(stripChrome(article)).slice(0, MAX_ENRICH_CHARS);
  if (text.length < 40) {
    const scripts = (bounded.match(/<script/gi) ?? []).length;
    return { title, byline, text, failure: scripts > 8 ? "js_shell" : "no_main_content" };
  }
  const language = firstMatch(bounded, /<html[^>]+lang=["']([^"']+)/i);
  return { title, byline, text, language };
}

export function extractOutboundUrls(html: string, pageUrl?: string): string[] {
  const bounded = html.slice(0, MAX_ENRICH_CHARS * 4);
  const pageHost = pageUrl
    ? (() => {
        try {
          return new URL(pageUrl).hostname.toLowerCase();
        } catch {
          return undefined;
        }
      })()
    : undefined;
  const found = new Set<string>();
  const pattern = /<a\s+[^>]*href=["'](https?:\/\/[^"']+)["']/gi;
  let match = pattern.exec(bounded);
  while (match) {
    const href = match[1];
    if (!href) {
      match = pattern.exec(bounded);
      continue;
    }
    try {
      const parsed = new URL(href);
      const host = parsed.hostname.toLowerCase();
      if (chromeOutboundHost(host)) {
        match = pattern.exec(bounded);
        continue;
      }
      if (!pageHost || host !== pageHost) {
        found.add(parsed.href);
      }
    } catch {
      // skip
    }
    if (found.size >= 8) {
      break;
    }
    match = pattern.exec(bounded);
  }
  return [...found];
}

export function headlineBodyMismatch(title: string | undefined, body: string): boolean {
  const head = (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (head.length < 12) {
    return false;
  }
  const tokens = head
    .split(" ")
    .filter((item) => item.length > 3)
    .slice(0, 6);
  if (tokens.length === 0) {
    return false;
  }
  const hay = body.toLowerCase();
  const hits = tokens.filter((token) => hay.includes(token)).length;
  return hits / tokens.length < 0.34;
}
