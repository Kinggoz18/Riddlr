import {
  canonicalizeUrl,
  DEFAULT_EDGAR_BUSINESS_POLL_SECONDS,
  DEFAULT_EDGAR_OFFHOURS_POLL_SECONDS,
  EFTS_KEYWORD_INTERVAL_MS,
  extractMainHtml,
  MAX_EDGAR_BODY_BYTES,
  MAX_EDGAR_DOCUMENT_CHARS,
  MAX_EDGAR_DOCUMENT_FETCHES,
  MAX_EDGAR_FILINGS,
  MAX_EFTS_HITS,
  MAX_EFTS_KEYWORDS,
  MAX_EQUITIES_REGISTRY,
  MIN_EDGAR_CALL_GAP_MS,
  OBSERVE_CLOCK_SKEW_MS,
  type RawEvidence,
  takeBounded,
} from "@riddlr/domain";
import {
  assertSafeHttpUrl,
  classifyHttpStatus,
  type FetchQuery,
  type FetchResult,
  readBoundedBytes,
  redactRequestUrl,
  type SourceAdapter,
  type SourceErrorClass,
} from "./types.js";
import { atomHref, extractBlocks, innerXmlText, xmlForbidsDtd } from "./xml.js";

export const EDGAR_ADAPTER_ID = "edgar";
export const EDGAR_FAMILY = "filing";
export const EDGAR_ATOM_BASE = "https://www.sec.gov/cgi-bin/browse-edgar";
export const EDGAR_COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
export const EDGAR_SUBMISSIONS_BASE = "https://data.sec.gov/submissions";
export const EDGAR_EFTS_URL = "https://efts.sec.gov/LATEST/search-index";
export const EDGAR_ARCHIVES_HOST = "www.sec.gov";
export const EDGAR_VERSION = "0.1";
export const EDGAR_ATOM_TYPES = ["8-K", "4", "10-Q", "SC 13D"] as const;

const CONTACT_EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

type SourceError = FetchResult["errors"][number];

export type EdgarAtomEntry = {
  form: string;
  issuerName: string;
  cik: string;
  accessionNumber?: string;
  items: string[];
  indexUrl?: string;
  title: string;
  summary?: string;
  updated?: Date;
  externalId: string;
};

export type EdgarForm4Transaction = {
  code: string;
  shares?: number;
  price?: number;
  date?: string;
  officer?: boolean;
  officerTitle?: string;
  ownerName?: string;
};

export type EdgarCompanyTicker = {
  cik: string;
  ticker: string;
  title: string;
};

export function padCik(value: string | number): string | undefined {
  const digits = String(value).replace(/\D/g, "");
  if (!digits) {
    return undefined;
  }
  return digits.padStart(10, "0").slice(-10);
}

export function secCanonicalId(cik: string): string {
  return `sec:${cik}`;
}

export function parseContactEmail(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const email = value.trim();
  if (!CONTACT_EMAIL_RE.test(email)) {
    return undefined;
  }
  return email;
}

export function edgarUserAgent(contactEmail: string): string {
  return `Riddlr/${EDGAR_VERSION} ${contactEmail.trim()}`;
}

export function isUsSecBusinessHours(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  if (!weekday || !Number.isFinite(hour)) {
    return false;
  }
  const weekend = weekday === "Sat" || weekday === "Sun";
  return !weekend && hour >= 9 && hour < 17;
}

export function edgarPollIntervalSeconds(now: Date): number {
  return isUsSecBusinessHours(now)
    ? DEFAULT_EDGAR_BUSINESS_POLL_SECONDS
    : DEFAULT_EDGAR_OFFHOURS_POLL_SECONDS;
}

export function edgarAtomUrl(formType: string): string {
  const params = new URLSearchParams({
    action: "getcurrent",
    type: formType,
    count: "100",
    output: "atom",
  });
  return `${EDGAR_ATOM_BASE}?${params.toString()}`;
}

export function edgarSubmissionsUrl(cik: string): string {
  return `${EDGAR_SUBMISSIONS_BASE}/CIK${cik}.json`;
}

export function edgarArchivesPath(cik: string, accession: string, file: string): string {
  const numeric = String(Number(cik));
  const accNodash = accession.replaceAll("-", "");
  const name = file.replace(/^xslF345X\d+\//i, "");
  return `https://${EDGAR_ARCHIVES_HOST}/Archives/edgar/data/${numeric}/${accNodash}/${name}`;
}

function parseTimestamp(value: string | undefined, fetchedAt: Date): Date | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  if (parsed.getTime() - fetchedAt.getTime() > OBSERVE_CLOCK_SKEW_MS) {
    return fetchedAt;
  }
  return parsed;
}

function boundChars(value: string | undefined, max = MAX_EDGAR_DOCUMENT_CHARS): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length <= max ? value : value.slice(0, max);
}

export function parseEdgarItems(text: string | undefined): string[] {
  if (!text) {
    return [];
  }
  const items: string[] = [];
  const re = /\bItem\s+(\d+\.\d+)/gi;
  let match = re.exec(text);
  while (match?.[1]) {
    items.push(match[1]);
    match = re.exec(text);
  }
  if (items.length === 0) {
    for (const part of text.split(/[,\s]+/)) {
      if (/^\d+\.\d+$/.test(part)) {
        items.push(part);
      }
    }
  }
  return [...new Set(items)];
}

export function parseEdgarAtom(
  xml: string,
  fetchedAt: Date,
): {
  entries: EdgarAtomEntry[];
  errors: SourceError[];
} {
  const stripped = xml.replace(/^\uFEFF/, "").trim();
  if (xmlForbidsDtd(stripped)) {
    return {
      entries: [],
      errors: [{ class: "malformed", message: "XML DTD and external entities are not allowed." }],
    };
  }
  if (!/<feed\b/i.test(stripped)) {
    return {
      entries: [],
      errors: [{ class: "malformed", message: "Body is not an Atom 1.0 EDGAR feed." }],
    };
  }
  const errors: SourceError[] = [];
  const entries: EdgarAtomEntry[] = [];
  for (const block of takeBounded(extractBlocks(stripped, "entry"), MAX_EDGAR_FILINGS)) {
    const title = innerXmlText(block, "title");
    if (!title) {
      errors.push({ class: "malformed", message: "EDGAR Atom entry missing title." });
      continue;
    }
    const parsedTitle = /^([0-9A-Z][0-9A-Z/-]*)\s+-\s+(.+?)\s+\((\d+)\)/i.exec(title);
    const form = parsedTitle?.[1]?.toUpperCase() ?? "";
    const issuerName = parsedTitle?.[2]?.trim() ?? title;
    const cik = padCik(parsedTitle?.[3] ?? "");
    const summary = innerXmlText(block, "summary");
    const accession =
      /AccNo:\s*([0-9]{10}-[0-9]{2}-[0-9]{6})/i.exec(summary ?? "")?.[1] ??
      /accession-number=([0-9]{10}-[0-9]{2}-[0-9]{6})/i.exec(innerXmlText(block, "id") ?? "")?.[1];
    const indexUrl = atomHref(block);
    const updated = parseTimestamp(innerXmlText(block, "updated"), fetchedAt);
    const externalId = accession ?? innerXmlText(block, "id") ?? indexUrl ?? title;
    if (!cik || !form || !externalId) {
      errors.push({ class: "malformed", message: "EDGAR Atom entry missing CIK or form." });
      continue;
    }
    entries.push({
      form,
      issuerName,
      cik,
      accessionNumber: accession,
      items: parseEdgarItems(summary),
      indexUrl: canonicalizeUrl(indexUrl) ?? indexUrl,
      title,
      summary,
      updated,
      externalId,
    });
  }
  return { entries, errors };
}

export function parseSecCompanyTickers(payload: unknown): {
  rows: EdgarCompanyTicker[];
  errors: SourceError[];
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      rows: [],
      errors: [{ class: "malformed", message: "company_tickers.json is not an object." }],
    };
  }
  const rows: EdgarCompanyTicker[] = [];
  for (const value of Object.values(payload as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const row = value as Record<string, unknown>;
    const ticker = typeof row.ticker === "string" ? row.ticker.trim().toUpperCase() : "";
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const cik = padCik(row.cik_str as string | number);
    if (!ticker || !cik) {
      continue;
    }
    rows.push({ cik, ticker, title: title || ticker });
    if (rows.length >= MAX_EQUITIES_REGISTRY) {
      break;
    }
  }
  return { rows, errors: [] };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function parseForm4Xml(xml: string): {
  transaction?: EdgarForm4Transaction;
  cik?: string;
  symbol?: string;
  issuerName?: string;
  errors: SourceError[];
} {
  const stripped = xml.replace(/^\uFEFF/, "").trim();
  if (xmlForbidsDtd(stripped)) {
    return {
      errors: [{ class: "malformed", message: "XML DTD and external entities are not allowed." }],
    };
  }
  if (!/<ownershipDocument\b/i.test(stripped)) {
    return {
      errors: [{ class: "malformed", message: "Body is not a Form 4 ownership document." }],
    };
  }
  const issuer = extractBlocks(stripped, "issuer")[0] ?? "";
  const owner = extractBlocks(stripped, "reportingOwner")[0] ?? "";
  const txn = extractBlocks(stripped, "nonDerivativeTransaction")[0];
  const code = txn ? innerXmlText(txn, "transactionCode") : undefined;
  if (!txn || !code) {
    return { errors: [{ class: "malformed", message: "Form 4 transaction code is missing." }] };
  }
  const shares = Number(innerXmlText(txn, "transactionShares"));
  const price = Number(innerXmlText(txn, "transactionPricePerShare"));
  const officerRaw = innerXmlText(owner, "isOfficer")?.toLowerCase();
  return {
    cik: padCik(innerXmlText(issuer, "issuerCik") ?? ""),
    symbol: innerXmlText(issuer, "issuerTradingSymbol"),
    issuerName: innerXmlText(issuer, "issuerName"),
    transaction: {
      code,
      shares: Number.isFinite(shares) ? shares : undefined,
      price: Number.isFinite(price) ? price : undefined,
      date: innerXmlText(txn, "transactionDate"),
      officer: officerRaw === "true" || officerRaw === "1",
      officerTitle: innerXmlText(owner, "officerTitle"),
      ownerName: innerXmlText(owner, "rptOwnerName"),
    },
    errors: [],
  };
}

export type ParsedEftsHit = {
  id: string;
  cik?: string;
  form?: string;
  items: string[];
  adsh?: string;
  fileDate?: string;
  displayName?: string;
  fileType?: string;
};

export function parseEftsHits(payload: unknown): {
  hits: ParsedEftsHit[];
  errors: SourceError[];
} {
  const row = asRecord(payload);
  if (!row) {
    return {
      hits: [],
      errors: [{ class: "malformed", message: "EFTS body is not an object." }],
    };
  }
  const hitsWrap = asRecord(row.hits);
  const list = hitsWrap?.hits;
  if (!Array.isArray(list)) {
    return { hits: [], errors: [{ class: "malformed", message: "EFTS hits list is missing." }] };
  }
  const hits: ParsedEftsHit[] = [];
  const errors: SourceError[] = [];
  for (const item of takeBounded(list, MAX_EFTS_HITS)) {
    const rec = asRecord(item);
    const source = rec ? asRecord(rec._source) : undefined;
    const id = typeof rec?._id === "string" ? rec._id : undefined;
    if (!id) {
      errors.push({ class: "malformed", message: "EFTS hit missing id." });
      continue;
    }
    const ciks = asStringArray(source?.ciks);
    const forms = asStringArray(source?.root_forms);
    const items = asStringArray(source?.items);
    hits.push({
      id,
      cik: padCik(ciks[0] ?? ""),
      form: typeof source?.form === "string" ? source.form : forms[0],
      items,
      adsh: typeof source?.adsh === "string" ? source.adsh : undefined,
      fileDate: typeof source?.file_date === "string" ? source.file_date : undefined,
      displayName:
        typeof source?.display_names === "string"
          ? source.display_names
          : asStringArray(source?.display_names)[0],
      fileType: typeof source?.file_type === "string" ? source.file_type : undefined,
    });
  }
  return { hits, errors };
}

function looksLikeHtml(body: string, contentType: string | null): boolean {
  if (contentType?.toLowerCase().includes("text/html")) {
    return true;
  }
  return /<html[\s>]/i.test(body);
}

function undeclaredTool(body: string): boolean {
  return /undeclared automated tool/i.test(body);
}

export function edgarEvidenceFromAtom(
  entry: EdgarAtomEntry,
  fetchedAt: Date,
  extra?: {
    bodyText?: string;
    form4?: EdgarForm4Transaction;
    subjectCanonicalId?: string;
  },
): RawEvidence {
  const url = entry.indexUrl;
  const bodyParts = [
    extra?.bodyText,
    entry.summary,
    extra?.form4
      ? `Form 4 ${extra.form4.code} ${extra.form4.shares ?? ""} shares at ${extra.form4.price ?? ""} by ${extra.form4.ownerName ?? "reporting owner"}`
      : undefined,
  ].filter(Boolean);
  return {
    sourceFamily: EDGAR_FAMILY,
    adapterId: EDGAR_ADAPTER_ID,
    externalId: entry.externalId,
    url,
    canonicalUrl: url,
    title: entry.title,
    bodyText: boundChars(bodyParts.join("\n\n")),
    author: entry.issuerName,
    publishedAt: entry.updated,
    fetchedAt,
    contentCompleteness: "native_complete",
    originKey: `sec:${entry.cik}`,
    sourceIdentity: {
      platform: "sec",
      externalId: entry.cik,
      displayName: entry.issuerName,
      hostname: EDGAR_ARCHIVES_HOST,
    },
    adapterPayload: {
      form: entry.form,
      items: entry.items,
      accessionNumber: entry.accessionNumber,
      cik: entry.cik,
      issuerName: entry.issuerName,
      subjectCanonicalId: extra?.subjectCanonicalId ?? secCanonicalId(entry.cik),
      transactionCode: extra?.form4?.code,
      shares: extra?.form4?.shares,
      price: extra?.form4?.price,
      officer: extra?.form4?.officer,
      officerTitle: extra?.form4?.officerTitle,
      ownerName: extra?.form4?.ownerName,
      transactionDate: extra?.form4?.date,
    },
  };
}

function parseWatchedCiks(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const ciks: string[] = [];
  for (const item of value) {
    const cik = padCik(typeof item === "string" || typeof item === "number" ? item : "");
    if (cik) {
      ciks.push(cik);
    }
  }
  return takeBounded([...new Set(ciks)], MAX_EDGAR_FILINGS);
}

function parseKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const words: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const word = item.trim().toLowerCase();
    if (word.length >= 3) {
      words.push(word);
    }
  }
  return takeBounded([...new Set(words)], MAX_EFTS_KEYWORDS);
}

function parseFinite(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function createEdgarAdapter(fetchImpl: typeof fetch = fetch): SourceAdapter {
  let lastCallAt = 0;
  async function throttledGet(url: string, userAgent: string): Promise<Response> {
    const wait = Math.max(0, MIN_EDGAR_CALL_GAP_MS - (Date.now() - lastCallAt));
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastCallAt = Date.now();
    assertSafeHttpUrl(url);
    return fetchImpl(url, {
      headers: {
        accept: "application/atom+xml, application/json, text/xml, */*",
        "user-agent": userAgent,
      },
      signal: AbortSignal.timeout(20_000),
      redirect: "manual",
    });
  }

  return {
    id: EDGAR_ADAPTER_ID,
    family: EDGAR_FAMILY,
    capabilities: {
      modes: ["poll"],
      supportsTimeRange: false,
      supportsPagination: false,
      supportsDomainFilter: true,
      lookbackNotes:
        "SEC EDGAR current-filings Atom, submissions JSON, and EFTS. Required User-Agent is Riddlr/<version> plus an operator contact email. Fair-use cap 10 requests/s. Equities agents filter Atom by watchlist CIKs. Crypto agents use EFTS keyword search only, one query per watched keyword per hour, cap 100 hits. Poll every 2 minutes in US business hours, otherwise 15 minutes.",
      partialResults: true,
    },
    async validate(config) {
      const email = parseContactEmail(config.contactEmail);
      if (!email) {
        return {
          ok: false,
          message:
            "Set an operator contact email. SEC requires User-Agent Riddlr/<version> <email>.",
        };
      }
      return { ok: true, message: "ok" };
    },
    async healthCheck(config) {
      const email = parseContactEmail(config.contactEmail);
      if (!email) {
        return {
          ok: false,
          message:
            "Set an operator contact email. SEC requires User-Agent Riddlr/<version> <email>.",
        };
      }
      try {
        const url = edgarAtomUrl("8-K");
        const response = await throttledGet(url, edgarUserAgent(email));
        if (response.status === 403) {
          return {
            ok: false,
            message:
              "SEC returned 403 undeclared automated tool. Set a contact email on the EDGAR source (User-Agent: Riddlr/<version> <email>).",
          };
        }
        if (!response.ok) {
          return { ok: false, message: `EDGAR HTTP ${response.status}` };
        }
        await readBoundedBytes(response, MAX_EDGAR_BODY_BYTES);
        return { ok: true, message: "EDGAR Atom answered." };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "EDGAR health check failed.",
        };
      }
    },
    async fetch(config, _query: FetchQuery): Promise<FetchResult> {
      const email = parseContactEmail(config.contactEmail);
      if (!email) {
        return {
          evidence: [],
          partial: true,
          errors: [
            {
              class: "blocked",
              message:
                "Set an operator contact email. SEC requires User-Agent Riddlr/<version> <email>.",
            },
          ],
          unresponsiveEngines: [],
        };
      }
      const userAgent = edgarUserAgent(email);
      const now = new Date();
      const lastPollAt = parseFinite(config.lastPollAt);
      const intervalMs = edgarPollIntervalSeconds(now) * 1000;
      if (lastPollAt && now.getTime() - lastPollAt < intervalMs) {
        return { evidence: [], partial: false, errors: [], unresponsiveEngines: [] };
      }
      const scanMode = config.scanMode === "efts" ? "efts" : "issuer";
      const watchedCiks = new Set(parseWatchedCiks(config.watchedCiks));
      const keywords = parseKeywords(config.eftsKeywords);
      const errors: SourceError[] = [];
      const evidence: RawEvidence[] = [];
      let documentFetches = 0;

      async function readBody(response: Response): Promise<string> {
        const buffer = await readBoundedBytes(response, MAX_EDGAR_BODY_BYTES);
        return buffer.toString("utf8");
      }

      async function classifyFailure(response: Response, requestUrl: string): Promise<FetchResult> {
        const body = await response.text().catch(() => "");
        if (response.status === 403 || undeclaredTool(body)) {
          return {
            evidence: [],
            partial: true,
            errors: [
              {
                class: "blocked",
                message:
                  "SEC returned 403 undeclared automated tool. Set a contact email on the EDGAR source (User-Agent: Riddlr/<version> <email>).",
              },
            ],
            unresponsiveEngines: [],
            requestUrl,
            responseStatus: response.status,
          };
        }
        const retryAfter = response.headers.get("retry-after");
        const classified = classifyHttpStatus(response.status) as SourceErrorClass;
        const message =
          response.status === 429 && retryAfter
            ? `EDGAR HTTP 429; Retry-After ${retryAfter}`
            : `EDGAR HTTP ${response.status}`;
        return {
          evidence: [],
          partial: true,
          errors: [{ class: classified, message }],
          unresponsiveEngines: [],
          requestUrl,
          responseStatus: response.status,
        };
      }

      if (scanMode === "efts") {
        if (keywords.length === 0) {
          return { evidence: [], partial: false, errors: [], unresponsiveEngines: [] };
        }
        const lastEfts = asRecord(config.lastEftsAt) ?? {};
        const persistEfts: Record<string, number> = { ...lastEfts } as Record<string, number>;
        for (const keyword of keywords) {
          const prior = parseFinite(lastEfts[keyword]);
          if (prior && now.getTime() - prior < EFTS_KEYWORD_INTERVAL_MS) {
            continue;
          }
          const url = `${EDGAR_EFTS_URL}?${new URLSearchParams({
            q: `"${keyword}"`,
            forms: "8-K",
          }).toString()}`;
          const requestUrl = redactRequestUrl(url);
          try {
            const response = await throttledGet(url, userAgent);
            if (response.status >= 300 && response.status < 400) {
              errors.push({
                class: "unavailable",
                message: "EDGAR redirected; redirects are not followed.",
              });
              continue;
            }
            if (!response.ok) {
              const failed = await classifyFailure(response, requestUrl);
              return failed;
            }
            const contentType = response.headers.get("content-type");
            const body = await readBody(response);
            if (looksLikeHtml(body, contentType)) {
              if (undeclaredTool(body)) {
                return {
                  evidence: [],
                  partial: true,
                  errors: [
                    {
                      class: "blocked",
                      message:
                        "SEC returned 403 undeclared automated tool. Set a contact email on the EDGAR source (User-Agent: Riddlr/<version> <email>).",
                    },
                  ],
                  unresponsiveEngines: [],
                  requestUrl,
                  responseStatus: response.status,
                };
              }
              errors.push({ class: "unavailable", message: "EFTS returned HTML." });
              continue;
            }
            const parsed = parseEftsHits(JSON.parse(body) as unknown);
            errors.push(...parsed.errors);
            for (const hit of parsed.hits) {
              if (!hit.cik || !hit.form) {
                continue;
              }
              const entry: EdgarAtomEntry = {
                form: hit.form,
                issuerName: hit.displayName ?? hit.cik,
                cik: hit.cik,
                accessionNumber: hit.adsh,
                items: hit.items,
                indexUrl: hit.adsh
                  ? edgarArchivesPath(hit.cik, hit.adsh, `${hit.adsh}-index.htm`)
                  : undefined,
                title: `${hit.form} - ${hit.displayName ?? hit.cik} (${hit.cik}) (Filer)`,
                summary: hit.fileType,
                updated: hit.fileDate ? parseTimestamp(`${hit.fileDate}T00:00:00Z`, now) : now,
                externalId: hit.id,
              };
              evidence.push(edgarEvidenceFromAtom(entry, now));
            }
            persistEfts[keyword] = now.getTime();
          } catch (error) {
            errors.push({
              class: "unavailable",
              message: error instanceof Error ? error.message : "EFTS request failed.",
            });
          }
        }
        return {
          evidence: takeBounded(evidence, MAX_EDGAR_FILINGS),
          partial: errors.length > 0,
          errors,
          unresponsiveEngines: [],
          adapterMetadata: {
            persistConfig: { lastPollAt: now.getTime(), lastEftsAt: persistEfts },
          },
        };
      }

      if (watchedCiks.size === 0) {
        return {
          evidence: [],
          partial: false,
          errors: [],
          unresponsiveEngines: [],
          adapterMetadata: { persistConfig: { lastPollAt: now.getTime() } },
        };
      }

      for (const formType of EDGAR_ATOM_TYPES) {
        const url = edgarAtomUrl(formType);
        const requestUrl = redactRequestUrl(url);
        try {
          const response = await throttledGet(url, userAgent);
          if (response.status >= 300 && response.status < 400) {
            errors.push({
              class: "unavailable",
              message: "EDGAR redirected; redirects are not followed.",
            });
            continue;
          }
          if (!response.ok) {
            return await classifyFailure(response, requestUrl);
          }
          const contentType = response.headers.get("content-type");
          const body = await readBody(response);
          if (looksLikeHtml(body, contentType) && !/<feed\b/i.test(body)) {
            if (undeclaredTool(body)) {
              return {
                evidence: [],
                partial: true,
                errors: [
                  {
                    class: "blocked",
                    message:
                      "SEC returned 403 undeclared automated tool. Set a contact email on the EDGAR source (User-Agent: Riddlr/<version> <email>).",
                  },
                ],
                unresponsiveEngines: [],
                requestUrl,
                responseStatus: response.status,
              };
            }
            errors.push({ class: "unavailable", message: "EDGAR Atom returned HTML." });
            continue;
          }
          const parsed = parseEdgarAtom(body, now);
          errors.push(...parsed.errors);
          for (const entry of parsed.entries) {
            if (!watchedCiks.has(entry.cik)) {
              continue;
            }
            let form4: EdgarForm4Transaction | undefined;
            let documentText: string | undefined;
            const wantXml = entry.form === "4" || entry.form === "4/A";
            if (wantXml && entry.accessionNumber && documentFetches < MAX_EDGAR_DOCUMENT_FETCHES) {
              documentFetches += 1;
              const xmlUrl = edgarArchivesPath(entry.cik, entry.accessionNumber, "form4.xml");
              try {
                const xmlResponse = await throttledGet(xmlUrl, userAgent);
                if (xmlResponse.ok) {
                  const xmlBody = await readBody(xmlResponse);
                  const parsedXml = parseForm4Xml(xmlBody);
                  errors.push(...parsedXml.errors);
                  form4 = parsedXml.transaction;
                }
              } catch (error) {
                errors.push({
                  class: "unavailable",
                  message: error instanceof Error ? error.message : "Form 4 fetch failed.",
                });
              }
            } else if (
              entry.accessionNumber &&
              documentFetches < MAX_EDGAR_DOCUMENT_FETCHES &&
              (entry.form.startsWith("8-K") || entry.form === "10-Q" || entry.form.startsWith("SC"))
            ) {
              documentFetches += 1;
              const primary =
                typeof config.primaryDocuments === "object" &&
                config.primaryDocuments &&
                !Array.isArray(config.primaryDocuments)
                  ? String(
                      (config.primaryDocuments as Record<string, unknown>)[entry.accessionNumber] ??
                        "",
                    )
                  : "";
              if (primary) {
                const docUrl = edgarArchivesPath(entry.cik, entry.accessionNumber, primary);
                try {
                  const docResponse = await throttledGet(docUrl, userAgent);
                  if (docResponse.ok) {
                    const docBody = await readBody(docResponse);
                    documentText = boundChars(extractMainHtml(docBody).text);
                  }
                } catch {
                  errors.push({ class: "unavailable", message: "EDGAR document fetch failed." });
                }
              }
            }
            evidence.push(
              edgarEvidenceFromAtom(entry, now, {
                bodyText: documentText,
                form4,
                subjectCanonicalId: secCanonicalId(entry.cik),
              }),
            );
          }
        } catch (error) {
          errors.push({
            class: "unavailable",
            message: error instanceof Error ? error.message : "EDGAR Atom fetch failed.",
          });
        }
      }

      return {
        evidence: takeBounded(evidence, MAX_EDGAR_FILINGS),
        partial: errors.length > 0,
        errors,
        unresponsiveEngines: [],
        adapterMetadata: { persistConfig: { lastPollAt: now.getTime() } },
      };
    },
  };
}
