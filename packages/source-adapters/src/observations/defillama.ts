import {
  canonicalizeUrl,
  DEFAULT_DEFILLAMA_INTERVAL_MS,
  DEFILLAMA_HACKS_INTERVAL_MS,
  DEFILLAMA_PROTOCOLS_INTERVAL_MS,
  isFiniteNumber,
  MAX_DEFILLAMA_BODY_BYTES,
  MAX_DEFILLAMA_CALLS_PER_MINUTE,
  MAX_DEFILLAMA_CHAIN_SLUGS,
  MAX_DEFILLAMA_COIN_IDS,
  MAX_DEFILLAMA_HACKS_PER_POLL,
  MAX_DEFILLAMA_PROTOCOL_FETCHES,
  MAX_REGISTRY_ASSETS,
  OBSERVE_CLOCK_SKEW_MS,
  originKey,
  type RawEvidence,
  type SeriesObservation,
  takeBounded,
} from "@riddlr/domain";
import {
  assertSafeHttpUrl,
  classifyHttpStatus,
  readBoundedJson,
  redactRequestUrl,
  type SourceAdapter,
} from "../types.js";
import type { ObservationProvider, ObserveQuery, ObserveResult } from "./types.js";

export const DEFILLAMA_PROVIDER_ID = "defillama";
export const DEFILLAMA_FAMILY = "observation";
export const DEFILLAMA_API_BASE = "https://api.llama.fi";
export const DEFILLAMA_STABLECOINS_BASE = "https://stablecoins.llama.fi";
export const DEFILLAMA_COINS_BASE = "https://coins.llama.fi";
export const DEFILLAMA_USER_AGENT = "Riddlr/0.1 (https://github.com/Kinggoz18/Riddlr)";

const METRICS = [
  "tvl_usd",
  "chain_tvl_usd",
  "stablecoin_circulating",
  "stablecoin_price",
  "stablecoin_basis",
  "spot_price",
] as const;

const SLUG_RE = /^[A-Za-z0-9._-]+$/;
const MIN_CALL_GAP_MS = Math.ceil(60_000 / MAX_DEFILLAMA_CALLS_PER_MINUTE);

export type ProtocolMapRow = {
  slug: string;
  name: string;
  geckoId: string;
  tvl?: number;
  change1d?: number;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function geckoIdFromCanonical(canonicalId: string): string | undefined {
  if (!canonicalId.startsWith("coingecko:")) {
    return undefined;
  }
  const id = canonicalId.slice("coingecko:".length).trim();
  return id.length > 0 ? id : undefined;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function unixToDate(value: unknown, fallback: Date): Date {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return fallback;
}

function clampObservedAt(observedAt: Date, fetchedAt: Date): Date {
  if (observedAt.getTime() - fetchedAt.getTime() > OBSERVE_CLOCK_SKEW_MS) {
    return fetchedAt;
  }
  return observedAt;
}

export function parseChainSlugs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const slugs: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const slug = item.trim();
    if (!slug || slug.includes("/") || slug.includes("://") || slug.includes("..")) {
      continue;
    }
    slugs.push(slug);
  }
  return takeBounded([...new Set(slugs)], MAX_DEFILLAMA_CHAIN_SLUGS);
}

export function parseProtocolSlugs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const slugs: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const slug = item.trim();
    if (!SLUG_RE.test(slug)) {
      continue;
    }
    slugs.push(slug);
  }
  return takeBounded([...new Set(slugs)], MAX_DEFILLAMA_PROTOCOL_FETCHES);
}

export function mapProtocolSlugsByGeckoId(rows: readonly ProtocolMapRow[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of rows) {
    const current = map[row.geckoId];
    if (!current) {
      map[row.geckoId] = row.slug;
      continue;
    }
    if (current === row.geckoId) {
      continue;
    }
    if (row.slug === row.geckoId) {
      map[row.geckoId] = row.slug;
    }
  }
  return map;
}

export function parseDefiLlamaProtocols(payload: unknown): {
  rows: ProtocolMapRow[];
  errors: ObserveResult["errors"];
} {
  if (!Array.isArray(payload)) {
    return {
      rows: [],
      errors: [{ class: "malformed", message: "DefiLlama /protocols payload was not an array." }],
    };
  }
  const rows: ProtocolMapRow[] = [];
  let skipped = 0;
  for (const item of takeBounded(payload, MAX_REGISTRY_ASSETS)) {
    const row = asRecord(item);
    if (!row) {
      skipped += 1;
      continue;
    }
    const slug = typeof row.slug === "string" ? row.slug.trim() : "";
    const geckoId = typeof row.gecko_id === "string" ? row.gecko_id.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : slug;
    if (!slug || !SLUG_RE.test(slug) || !geckoId) {
      skipped += 1;
      continue;
    }
    const mapped: ProtocolMapRow = { slug, name: name || slug, geckoId };
    if (isFiniteNumber(row.tvl)) {
      mapped.tvl = row.tvl;
    }
    if (isFiniteNumber(row.change_1d)) {
      mapped.change1d = row.change_1d;
    }
    rows.push(mapped);
  }
  return {
    rows,
    errors:
      skipped > 0
        ? [
            {
              class: "partial",
              message: `Skipped ${skipped} protocol rows without slug and gecko_id.`,
            },
          ]
        : [],
  };
}

export function parseDefiLlamaProtocolDetail(
  payload: unknown,
  slug: string,
  subjectCanonicalId: string,
  fetchedAt: Date,
): ObserveResult {
  if (typeof payload === "string" && /^\s*</.test(payload)) {
    return {
      observations: [],
      partial: true,
      errors: [{ class: "unavailable", message: `DefiLlama protocol ${slug} returned HTML.` }],
    };
  }
  const root = asRecord(payload);
  if (!root) {
    return {
      observations: [],
      partial: true,
      errors: [
        { class: "malformed", message: `DefiLlama protocol ${slug} payload was not an object.` },
      ],
    };
  }
  const history = asArray(root.tvl);
  const latest = asRecord(history[history.length - 1]);
  if (!latest || !isFiniteNumber(latest.totalLiquidityUSD)) {
    return {
      observations: [],
      partial: true,
      errors: [{ class: "malformed", message: `DefiLlama protocol ${slug} missing tvl.` }],
    };
  }
  const observedAt = clampObservedAt(unixToDate(latest.date, fetchedAt), fetchedAt);
  return {
    observations: [
      {
        provider: DEFILLAMA_PROVIDER_ID,
        metric: "tvl_usd",
        subjectCanonicalId,
        value: latest.totalLiquidityUSD,
        unit: "usd",
        observedAt,
        providerLastUpdatedAt: observedAt,
      },
    ],
    partial: false,
    errors: [],
  };
}

export function parseDefiLlamaHistoricalChainTvl(
  payload: unknown,
  chain: string,
  fetchedAt: Date,
): ObserveResult {
  if (!Array.isArray(payload)) {
    return {
      observations: [],
      partial: true,
      errors: [
        { class: "malformed", message: `DefiLlama historicalChainTvl ${chain} was not an array.` },
      ],
    };
  }
  const latest = asRecord(payload[payload.length - 1]);
  if (!latest || !isFiniteNumber(latest.tvl)) {
    return {
      observations: [],
      partial: true,
      errors: [{ class: "malformed", message: `DefiLlama chain ${chain} missing tvl.` }],
    };
  }
  const observedAt = clampObservedAt(unixToDate(latest.date, fetchedAt), fetchedAt);
  return {
    observations: [
      {
        provider: DEFILLAMA_PROVIDER_ID,
        metric: "chain_tvl_usd",
        subjectCanonicalId: `defillama:chain:${chain}`,
        value: latest.tvl,
        unit: "usd",
        observedAt,
        providerLastUpdatedAt: observedAt,
      },
    ],
    partial: false,
    errors: [],
  };
}

function circulatingAmount(row: Record<string, unknown>): number | undefined {
  const circulating = asRecord(row.circulating);
  if (!circulating) {
    return undefined;
  }
  if (isFiniteNumber(circulating.peggedUSD)) {
    return circulating.peggedUSD;
  }
  for (const value of Object.values(circulating)) {
    if (isFiniteNumber(value)) {
      return value;
    }
  }
  return undefined;
}

export function pegBasisPercent(price: number, pegType: string): number | undefined {
  if (pegType !== "peggedUSD") {
    return undefined;
  }
  const basis = (price - 1) * 100;
  return Number.isFinite(basis) ? basis : undefined;
}

export function parseDefiLlamaStablecoins(
  payload: unknown,
  requestedGeckoIds: readonly string[],
  fetchedAt: Date,
): ObserveResult {
  const root = asRecord(payload);
  const assets = asArray(root?.peggedAssets);
  if (!root || !Array.isArray(root.peggedAssets)) {
    return {
      observations: [],
      partial: true,
      errors: [
        { class: "malformed", message: "DefiLlama stablecoins payload missing peggedAssets." },
      ],
    };
  }
  const wanted = new Set(requestedGeckoIds);
  const observations: SeriesObservation[] = [];
  let skipped = 0;
  for (const item of takeBounded(assets, 500)) {
    const row = asRecord(item);
    if (!row) {
      skipped += 1;
      continue;
    }
    const geckoId = typeof row.gecko_id === "string" ? row.gecko_id.trim() : "";
    if (!geckoId || (wanted.size > 0 && !wanted.has(geckoId))) {
      continue;
    }
    const canonicalId = `coingecko:${geckoId}`;
    const circulating = circulatingAmount(row);
    if (circulating !== undefined) {
      observations.push({
        provider: DEFILLAMA_PROVIDER_ID,
        metric: "stablecoin_circulating",
        subjectCanonicalId: canonicalId,
        value: circulating,
        unit: "usd",
        observedAt: fetchedAt,
      });
    }
    if (isFiniteNumber(row.price)) {
      observations.push({
        provider: DEFILLAMA_PROVIDER_ID,
        metric: "stablecoin_price",
        subjectCanonicalId: canonicalId,
        value: row.price,
        unit: "usd",
        observedAt: fetchedAt,
      });
      const pegType = typeof row.pegType === "string" ? row.pegType : "";
      const basis = pegBasisPercent(row.price, pegType);
      if (basis !== undefined) {
        observations.push({
          provider: DEFILLAMA_PROVIDER_ID,
          metric: "stablecoin_basis",
          subjectCanonicalId: canonicalId,
          value: basis,
          unit: "percent",
          observedAt: fetchedAt,
        });
      }
    } else {
      skipped += 1;
    }
  }
  return {
    observations,
    partial: skipped > 0,
    errors: [],
  };
}

export function parseDefiLlamaCoins(payload: unknown, fetchedAt: Date): ObserveResult {
  const root = asRecord(payload);
  const coins = asRecord(root?.coins);
  if (!root || !coins) {
    return {
      observations: [],
      partial: true,
      errors: [{ class: "malformed", message: "DefiLlama coins payload missing coins." }],
    };
  }
  const observations: SeriesObservation[] = [];
  let skipped = 0;
  for (const [key, value] of Object.entries(coins)) {
    const row = asRecord(value);
    if (!key.startsWith("coingecko:") || !row || !isFiniteNumber(row.price)) {
      skipped += 1;
      continue;
    }
    const observedAt = clampObservedAt(unixToDate(row.timestamp, fetchedAt), fetchedAt);
    observations.push({
      provider: DEFILLAMA_PROVIDER_ID,
      metric: "spot_price",
      subjectCanonicalId: key,
      value: row.price,
      unit: "usd",
      observedAt,
      providerLastUpdatedAt: observedAt,
    });
  }
  return { observations, partial: skipped > 0, errors: [] };
}

export function parseDefiLlamaHacks(
  payload: unknown,
  fetchedAt: Date,
  nameToCanonicalId: Readonly<Record<string, string>>,
): { evidence: RawEvidence[]; errors: ObserveResult["errors"] } {
  if (!Array.isArray(payload)) {
    return {
      evidence: [],
      errors: [{ class: "malformed", message: "DefiLlama /hacks payload was not an array." }],
    };
  }
  const evidence: RawEvidence[] = [];
  for (const item of takeBounded(payload, MAX_DEFILLAMA_HACKS_PER_POLL)) {
    const row = asRecord(item);
    if (!row) {
      continue;
    }
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name) {
      continue;
    }
    const publishedAt = unixToDate(row.date, fetchedAt);
    const sourceUrl =
      typeof row.source === "string" && row.source.startsWith("http")
        ? canonicalizeUrl(row.source)
        : undefined;
    const amount = isFiniteNumber(row.amount) ? row.amount : undefined;
    const classification = typeof row.classification === "string" ? row.classification : "";
    const technique = typeof row.technique === "string" ? row.technique : "";
    const externalId = `${row.date ?? ""}:${name}`;
    const hostname = sourceUrl ? new URL(sourceUrl).hostname : undefined;
    const subjectCanonicalId = nameToCanonicalId[normalizeName(name)];
    evidence.push({
      sourceFamily: DEFILLAMA_FAMILY,
      adapterId: DEFILLAMA_PROVIDER_ID,
      externalId,
      url: sourceUrl,
      canonicalUrl: sourceUrl ?? `riddlr:defillama/hack/${encodeURIComponent(externalId)}`,
      title: `${name} ${classification || "hack"}`.trim(),
      bodyText: [name, classification, technique, amount != null ? `${amount} usd` : ""]
        .filter(Boolean)
        .join(". "),
      publishedAt,
      fetchedAt,
      contentCompleteness: "native_complete",
      originKey: originKey({ platform: "defillama", externalId: `hack:${externalId}` }),
      referencedOriginKey: hostname ? originKey({ platform: "search", hostname }) : undefined,
      outboundUrls: sourceUrl ? [sourceUrl] : undefined,
      sourceIdentity: {
        platform: "defillama",
        externalId: "hacks",
        displayName: "DefiLlama hacks",
        hostname: "defillama.com",
      },
      adapterPayload: {
        date: row.date,
        name,
        classification,
        technique,
        amount,
        chain: row.chain,
        source: row.source,
        subjectCanonicalId,
        ...(sourceUrl ? { outboundUrls: [sourceUrl] } : {}),
      },
    });
  }
  return { evidence, errors: [] };
}

function looksLikeHtml(payload: unknown, contentType: string | null): boolean {
  if (contentType?.includes("text/html")) {
    return true;
  }
  return typeof payload === "string" && /^\s*</.test(payload);
}

type LlamaCallResult =
  | { ok: true; payload: unknown; status: number; requestUrl: string }
  | {
      ok: false;
      errors: ObserveResult["errors"];
      status?: number;
      requestUrl: string;
    };

export function createDefiLlamaProvider(
  options: { fetchImpl?: typeof fetch; intervalMs?: number; minIntervalMs?: number } = {},
): ObservationProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const minIntervalMs = options.minIntervalMs ?? MIN_CALL_GAP_MS;
  let chain = Promise.resolve();
  let lastCallAt = 0;

  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function llamaGet(url: URL): Promise<LlamaCallResult> {
    return enqueue(async () => {
      const requestUrl = redactRequestUrl(url.toString());
      try {
        assertSafeHttpUrl(url.toString());
        const wait = minIntervalMs - (Date.now() - lastCallAt);
        if (wait > 0) {
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
        lastCallAt = Date.now();
        const response = await fetchImpl(url, {
          headers: {
            accept: "application/json",
            "user-agent": DEFILLAMA_USER_AGENT,
          },
          signal: AbortSignal.timeout(20_000),
          redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400) {
          return {
            ok: false,
            errors: [
              {
                class: "unavailable",
                message: "DefiLlama redirected; redirects are not followed.",
              },
            ],
            status: response.status,
            requestUrl,
          };
        }
        if (!response.ok) {
          const errorClass = classifyHttpStatus(response.status);
          return {
            ok: false,
            errors: [
              {
                class:
                  errorClass === "malformed" && response.status >= 500 ? "unavailable" : errorClass,
                message: `DefiLlama HTTP ${response.status}`,
              },
            ],
            status: response.status,
            requestUrl,
          };
        }
        const contentType = response.headers.get("content-type");
        let payload: unknown;
        try {
          payload = await readBoundedJson(response, MAX_DEFILLAMA_BODY_BYTES);
        } catch {
          return {
            ok: false,
            errors: [
              {
                class: "too_large",
                message: "DefiLlama body exceeded the 5 MB bound.",
              },
            ],
            status: response.status,
            requestUrl,
          };
        }
        if (looksLikeHtml(payload, contentType)) {
          return {
            ok: false,
            errors: [{ class: "unavailable", message: "DefiLlama returned HTML." }],
            status: response.status,
            requestUrl,
          };
        }
        return { ok: true, payload, status: response.status, requestUrl };
      } catch (error) {
        const message = error instanceof Error ? error.message : "DefiLlama request failed";
        return {
          ok: false,
          errors: [{ class: "unavailable", message }],
          requestUrl,
        };
      }
    });
  }

  return {
    id: DEFILLAMA_PROVIDER_ID,
    metrics: METRICS,
    defaultIntervalMs: options.intervalMs ?? DEFAULT_DEFILLAMA_INTERVAL_MS,
    optIn: true,
    async observe(config, query: ObserveQuery): Promise<ObserveResult> {
      const fetchedAt = query.observedAt;
      const observations: SeriesObservation[] = [];
      const evidence: RawEvidence[] = [];
      const errors: ObserveResult["errors"] = [];
      let lastUrl: string | undefined;
      let lastStatus: number | undefined;
      const geckoIds = [
        ...new Set(
          query.subjectCanonicalIds
            .map(geckoIdFromCanonical)
            .filter((item): item is string => Boolean(item)),
        ),
      ];
      const operatorSlugs = parseProtocolSlugs(config.protocolSlugs);
      const chainSlugs = parseChainSlugs(config.chainSlugs);
      let protocolSlugByGeckoId = asRecord(config.protocolSlugByGeckoId) as
        | Record<string, string>
        | undefined;
      const nameToCanonical: Record<string, string> = {};
      const storedNames = asRecord(config.protocolNameByGeckoId);
      if (storedNames) {
        for (const [geckoId, name] of Object.entries(storedNames)) {
          if (typeof name === "string") {
            nameToCanonical[normalizeName(name)] = `coingecko:${geckoId}`;
          }
        }
      }
      const protocolsAt =
        typeof config.lastProtocolsAt === "string"
          ? Date.parse(config.lastProtocolsAt)
          : Number.NaN;
      const protocolsDue =
        !protocolSlugByGeckoId ||
        Number.isNaN(protocolsAt) ||
        fetchedAt.getTime() - protocolsAt >= DEFILLAMA_PROTOCOLS_INTERVAL_MS;
      if (protocolsDue) {
        const listed = await llamaGet(new URL(`${DEFILLAMA_API_BASE}/protocols`));
        lastUrl = listed.requestUrl;
        lastStatus = listed.status;
        if (listed.ok) {
          const parsed = parseDefiLlamaProtocols(listed.payload);
          errors.push(...parsed.errors);
          protocolSlugByGeckoId = mapProtocolSlugsByGeckoId(parsed.rows);
          for (const row of parsed.rows) {
            nameToCanonical[normalizeName(row.name)] = `coingecko:${row.geckoId}`;
          }
        } else {
          errors.push(...listed.errors);
        }
      }
      const slugMap = protocolSlugByGeckoId ?? {};
      const slugsToFetch = new Map<string, string>();
      for (const geckoId of geckoIds) {
        const mapped = typeof slugMap[geckoId] === "string" ? slugMap[geckoId] : geckoId;
        if (SLUG_RE.test(mapped)) {
          slugsToFetch.set(mapped, `coingecko:${geckoId}`);
        }
      }
      for (const slug of operatorSlugs) {
        if (!slugsToFetch.has(slug)) {
          slugsToFetch.set(slug, `defillama:${slug}`);
        }
      }
      for (const [slug, subject] of takeBounded(
        [...slugsToFetch.entries()],
        MAX_DEFILLAMA_PROTOCOL_FETCHES,
      )) {
        const detail = await llamaGet(new URL(`${DEFILLAMA_API_BASE}/protocol/${slug}`));
        lastUrl = detail.requestUrl;
        lastStatus = detail.status;
        if (!detail.ok) {
          errors.push(...detail.errors);
          continue;
        }
        const parsed = parseDefiLlamaProtocolDetail(detail.payload, slug, subject, fetchedAt);
        observations.push(...parsed.observations);
        errors.push(...parsed.errors);
      }
      for (const chain of chainSlugs) {
        const hist = await llamaGet(
          new URL(`${DEFILLAMA_API_BASE}/v2/historicalChainTvl/${encodeURIComponent(chain)}`),
        );
        lastUrl = hist.requestUrl;
        lastStatus = hist.status;
        if (!hist.ok) {
          errors.push(...hist.errors);
          continue;
        }
        const parsed = parseDefiLlamaHistoricalChainTvl(hist.payload, chain, fetchedAt);
        observations.push(...parsed.observations);
        errors.push(...parsed.errors);
      }
      const stables = await llamaGet(
        new URL(`${DEFILLAMA_STABLECOINS_BASE}/stablecoins?includePrices=true`),
      );
      lastUrl = stables.requestUrl;
      lastStatus = stables.status;
      if (stables.ok) {
        const parsed = parseDefiLlamaStablecoins(stables.payload, geckoIds, fetchedAt);
        observations.push(...parsed.observations);
        errors.push(...parsed.errors);
      } else {
        errors.push(...stables.errors);
      }
      const coinIds = takeBounded(
        geckoIds.map((id) => `coingecko:${id}`),
        MAX_DEFILLAMA_COIN_IDS,
      );
      if (coinIds.length > 0) {
        const coins = await llamaGet(
          new URL(`${DEFILLAMA_COINS_BASE}/prices/current/${coinIds.join(",")}`),
        );
        lastUrl = coins.requestUrl;
        lastStatus = coins.status;
        if (coins.ok) {
          const parsed = parseDefiLlamaCoins(coins.payload, fetchedAt);
          observations.push(...parsed.observations);
          errors.push(...parsed.errors);
        } else {
          errors.push(...coins.errors);
        }
      }
      const hacksAt =
        typeof config.lastHacksAt === "string" ? Date.parse(config.lastHacksAt) : Number.NaN;
      const hacksDue =
        Number.isNaN(hacksAt) || fetchedAt.getTime() - hacksAt >= DEFILLAMA_HACKS_INTERVAL_MS;
      let lastHacksAt = typeof config.lastHacksAt === "string" ? config.lastHacksAt : undefined;
      if (hacksDue) {
        const hacks = await llamaGet(new URL(`${DEFILLAMA_API_BASE}/hacks`));
        lastUrl = hacks.requestUrl;
        lastStatus = hacks.status;
        if (hacks.ok) {
          const parsed = parseDefiLlamaHacks(hacks.payload, fetchedAt, nameToCanonical);
          evidence.push(...parsed.evidence);
          errors.push(...parsed.errors);
          lastHacksAt = fetchedAt.toISOString();
        } else {
          errors.push(...hacks.errors);
        }
      }
      const persistConfig: Record<string, unknown> = {
        lastPolledAt: fetchedAt.toISOString(),
      };
      if (protocolSlugByGeckoId) {
        persistConfig.protocolSlugByGeckoId = protocolSlugByGeckoId;
        persistConfig.lastProtocolsAt = fetchedAt.toISOString();
        const names: Record<string, string> = {};
        for (const [name, canonical] of Object.entries(nameToCanonical)) {
          const geckoId = geckoIdFromCanonical(canonical);
          if (geckoId) {
            names[geckoId] = name;
          }
        }
        persistConfig.protocolNameByGeckoId = names;
      }
      if (lastHacksAt) {
        persistConfig.lastHacksAt = lastHacksAt;
      }
      return {
        observations,
        evidence,
        persistConfig,
        partial: errors.length > 0,
        errors,
        requestUrl: lastUrl,
        responseStatus: lastStatus,
      };
    },
  };
}

export function createDefiLlamaAdapter(fetchImpl: typeof fetch = fetch): SourceAdapter {
  return {
    id: DEFILLAMA_PROVIDER_ID,
    family: DEFILLAMA_FAMILY,
    capabilities: {
      modes: ["poll"],
      supportsTimeRange: false,
      supportsPagination: false,
      supportsDomainFilter: false,
      lookbackNotes:
        "Opt-in. Personal, non-commercial DefiLlama terms: results stay in this operator database and are not re-exposed. Protocol TVL every 15 minutes (latest point only), chain TVL for pinned chains, stablecoin supply, secondary prices, and hourly hacks. No API key.",
      partialResults: true,
    },
    async validate(config) {
      try {
        parseChainSlugs(config.chainSlugs);
        parseProtocolSlugs(config.protocolSlugs);
        return { ok: true, message: "ok" };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "Invalid DefiLlama config.",
        };
      }
    },
    async healthCheck() {
      const url = `${DEFILLAMA_API_BASE}/v2/chains`;
      try {
        assertSafeHttpUrl(url);
        const response = await fetchImpl(url, {
          headers: { accept: "application/json", "user-agent": DEFILLAMA_USER_AGENT },
          signal: AbortSignal.timeout(15_000),
          redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400) {
          return { ok: false, message: "DefiLlama redirected; redirects are not followed." };
        }
        if (!response.ok) {
          return { ok: false, message: `DefiLlama HTTP ${response.status}` };
        }
        await readBoundedJson(response, MAX_DEFILLAMA_BODY_BYTES);
        return { ok: true, message: "DefiLlama /v2/chains answered." };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "DefiLlama health check failed.",
        };
      }
    },
    async fetch() {
      return {
        evidence: [],
        partial: false,
        errors: [],
        unresponsiveEngines: [],
      };
    },
  };
}
