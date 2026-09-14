import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildRecentSearchQuery,
  createXAdapter,
  MAX_X_LOOKBACK_HOURS,
  MAX_X_PAGES,
  MAX_X_RESULTS,
  parseXSearchPayload,
  X_API_BASE,
  X_RECENT_SEARCH_PATH,
  X_TWEET_FIELDS,
} from "./x.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/x");

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as unknown;
}

const fetchedAt = new Date("2026-09-10T12:00:00.000Z");
const tokenConfig = {
  token: "BearerTokenValueHere",
  authors: ["alice"],
  lookbackHours: 24,
  monthlyReadBudget: 5000,
  monthlyReadsUsed: 0,
};

describe("X official recent search adapter", () => {
  it("parses posts, author URL, and expanded_url outbound links", () => {
    const parsed = parseXSearchPayload(
      {
        data: [
          {
            id: "123",
            text: "Bitcoin ETF inflows https://t.co/abc",
            created_at: "2026-09-10T11:00:00.000Z",
            author_id: "9",
            public_metrics: { like_count: 2 },
            entities: {
              urls: [
                { url: "https://t.co/abc", expanded_url: "https://www.reuters.com/markets/etf" },
              ],
              cashtags: [{ tag: "BTC" }],
            },
          },
        ],
        includes: { users: [{ id: "9", username: "alice", verified: true }] },
        meta: { result_count: 1 },
      },
      fetchedAt,
    );
    expect(parsed.evidence).toHaveLength(1);
    expect(parsed.evidence[0]?.url).toBe("https://x.com/alice/status/123");
    expect(parsed.evidence[0]?.adapterPayload?.publicMetrics).toEqual({ like_count: 2 });
    expect(parsed.evidence[0]?.contentCompleteness).toBe("native_complete");
    expect(parsed.evidence[0]?.originKey).toBe("x:9");
    expect(parsed.evidence[0]?.outboundUrls).toEqual(["https://www.reuters.com/markets/etf"]);
    expect(parsed.evidence[0]?.bodyText).toContain("$BTC");
    expect(parsed.evidence[0]?.sourceIdentity?.verifiedBadge).toBe(true);
  });

  it("points retweets at the referenced origin", () => {
    const parsed = parseXSearchPayload(
      {
        data: [
          {
            id: "2",
            text: "RT copied report",
            author_id: "9",
            referenced_tweets: [{ type: "retweeted", id: "1" }],
          },
        ],
        includes: { users: [{ id: "9", username: "alice" }] },
      },
      fetchedAt,
    );
    expect(parsed.evidence[0]?.referencedOriginKey).toBe("x:1");
    expect(parsed.evidence[0]?.originKey).toBe("x:1");
  });

  it("maps 403 plan errors and 402 credit depletion", () => {
    const forbidden = parseXSearchPayload(readJson("client-forbidden.json"), fetchedAt);
    expect(forbidden.evidence).toHaveLength(0);
    expect(forbidden.errors[0]?.class).toBe("capability_missing");
    expect(forbidden.errors[0]?.message).toMatch(/Archive search is not used/);
    expect(forbidden.errors[0]?.message).toMatch(/not enrolled|plan/i);
    const depleted = parseXSearchPayload(readJson("credits-depleted.json"), fetchedAt);
    expect(depleted.errors[0]?.class).toBe("capability_missing");
    expect(depleted.errors[0]?.message).toMatch(/credits are depleted/i);
  });

  it("treats an empty data array as empty success and a missing id as drift", () => {
    const empty = parseXSearchPayload(readJson("empty-data.json"), fetchedAt);
    expect(empty.evidence).toHaveLength(0);
    expect(empty.partial).toBe(false);
    const missing = parseXSearchPayload(readJson("empty-object.json"), fetchedAt);
    expect(missing.errors[0]?.class).toBe("malformed");
    const drift = parseXSearchPayload(readJson("search-drift-missing-id.json"), fetchedAt);
    expect(drift.evidence).toHaveLength(0);
    expect(drift.errors[0]?.message).toMatch(/missing id or text/);
  });

  it("advertises 7-day recent search and rejects lookback beyond that window", async () => {
    const adapter = createXAdapter();
    expect(adapter.capabilities.lookbackNotes).toMatch(/last 7 days/);
    expect(adapter.capabilities.lookbackNotes).toMatch(/search\/all/);
    expect(MAX_X_LOOKBACK_HOURS).toBe(168);
    expect(MAX_X_RESULTS).toBe(100);
    expect(MAX_X_PAGES).toBe(3);
    const invalid = await adapter.validate({
      token: "BearerTokenValueHere",
      authors: ["alice"],
      lookbackHours: 400,
    });
    expect(invalid.ok).toBe(false);
  });

  it("requires named-principal authors and ANDs optional keywords", () => {
    const built = buildRecentSearchQuery({
      authors: ["@alice", "bob"],
      keywords: ["bitcoin", "etf"],
    });
    expect(built.error).toBeUndefined();
    expect(built.query).toContain("from:alice");
    expect(built.query).toContain("from:bob");
    expect(built.query).toContain("-is:retweet");
    expect(built.query).toContain("-is:reply");
    expect(built.query).toContain("lang:en");
    expect(built.query).toContain("bitcoin");
    expect(built.query).toContain("etf");
    expect(built.query).not.toContain("bitcoin OR");
    expect(built.query.length).toBeLessThanOrEqual(512);
    const mentionsOnly = buildRecentSearchQuery({ authors: [], keywords: ["bitcoin"] });
    expect(mentionsOnly.error).toMatch(/authors are required/);
  });

  it("rejects keyword-only and mentions-only sources", async () => {
    const adapter = createXAdapter();
    expect(
      (await adapter.validate({ token: "BearerTokenValueHere", keywords: ["bitcoin"] })).ok,
    ).toBe(false);
    expect(
      (await adapter.validate({ token: "BearerTokenValueHere", mentions: ["alice"] })).ok,
    ).toBe(false);
    expect((await adapter.validate({ token: "BearerTokenValueHere", authors: ["alice"] })).ok).toBe(
      true,
    );
  });

  it("rejects a query that exceeds 512 characters", async () => {
    const adapter = createXAdapter();
    const authors = Array.from(
      { length: 30 },
      (_, index) => `user${String(index).padStart(4, "0")}`,
    );
    const result = await adapter.validate({
      token: "BearerTokenValueHere",
      authors,
      keywords: ["extraordinaryextraordinary", "listinglistinglisting"],
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/512/);
  });

  it("calls recent search only, requests documented fields, and maps 403", async () => {
    const calls: string[] = [];
    const adapter = createXAdapter(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      return Response.json(readJson("client-forbidden.json"), { status: 403 });
    });
    const result = await adapter.fetch(tokenConfig, { query: "", limit: 20 });
    expect(calls).toHaveLength(1);
    const href = calls[0] ?? "";
    expect(href).toContain(`${X_API_BASE}${X_RECENT_SEARCH_PATH}`);
    expect(href).not.toContain("search/all");
    const decoded = decodeURIComponent(href.replaceAll("+", " "));
    expect(decoded).toContain("from:alice");
    expect(decoded).toContain("-is:retweet");
    expect(decoded).toContain(X_TWEET_FIELDS);
    expect(decoded).toContain("user.fields=username,verified,public_metrics");
    expect(result.errors[0]?.class).toBe("capability_missing");
  });

  it("maps HTTP 402 to credits depleted", async () => {
    const adapter = createXAdapter(async () =>
      Response.json(readJson("credits-depleted.json"), { status: 402 }),
    );
    const result = await adapter.fetch(tokenConfig, { query: "", limit: 20 });
    expect(result.errors[0]?.class).toBe("capability_missing");
    expect(result.errors[0]?.message).toMatch(/credits are depleted/i);
  });

  it("refuses to fetch when the monthly read budget is exhausted", async () => {
    let called = 0;
    const adapter = createXAdapter(async () => {
      called += 1;
      return Response.json(readJson("empty-data.json"));
    });
    const result = await adapter.fetch(
      { ...tokenConfig, monthlyReadBudget: 5000, monthlyReadsUsed: 4995 },
      { query: "", limit: 20 },
    );
    expect(called).toBe(0);
    expect(result.errors[0]?.class).toBe("capability_missing");
    expect(result.errors[0]?.message).toMatch(/monthly read budget exhausted/);
  });

  it("uses lastSuccessAt for start_time and counts result_count as reads", async () => {
    let requested: URL | undefined;
    const adapter = createXAdapter(async (input) => {
      requested = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      return Response.json({
        data: [
          {
            id: "99",
            text: "stablecoin depeg chatter",
            created_at: "2026-09-10T11:00:00.000Z",
            author_id: "1",
          },
        ],
        includes: { users: [{ id: "1", username: "bob" }] },
        meta: { result_count: 1 },
      });
    });
    const lastSuccessAt = "2026-09-13T12:00:00.000Z";
    const result = await adapter.fetch({ ...tokenConfig, lastSuccessAt }, { query: "", limit: 20 });
    expect(requested?.searchParams.get("start_time")).toBe(lastSuccessAt);
    expect(requested?.searchParams.get("max_results")).toBe("20");
    expect(result.evidence).toHaveLength(1);
    expect(result.adapterMetadata?.readsCharged).toBe(1);
    expect(
      (result.adapterMetadata?.persistConfig as { lastSuccessAt?: string } | undefined)
        ?.lastSuccessAt,
    ).toBeTypeOf("string");
  });

  it("maps HTML 200, oversized bodies, 5xx, timeouts, and 429 with and without reset", async () => {
    const html = createXAdapter(
      async () =>
        new Response("<html>nope</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    expect((await html.fetch(tokenConfig, { query: "", limit: 10 })).errors[0]?.class).toBe(
      "malformed",
    );
    const oversized = createXAdapter(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "3000000" },
        }),
    );
    const oversizedFetch = oversized.fetch(tokenConfig, { query: "", limit: 10 });
    const oversizedResult = await oversizedFetch;
    expect(oversizedResult.errors[0]?.class).toBe("too_large");
    const server = createXAdapter(async () => new Response("fail", { status: 503 }));
    expect((await server.fetch(tokenConfig, { query: "", limit: 10 })).errors[0]?.class).toBe(
      "unavailable",
    );
    const timedOut = createXAdapter(async () => {
      throw new Error("The operation was aborted");
    });
    expect((await timedOut.fetch(tokenConfig, { query: "", limit: 10 })).errors[0]?.class).toBe(
      "unavailable",
    );
    const limited = createXAdapter(
      async () =>
        new Response("rate", { status: 429, headers: { "x-rate-limit-reset": "1710000000" } }),
    );
    const limitedResult = await limited.fetch(tokenConfig, { query: "", limit: 10 });
    expect(limitedResult.errors[0]?.class).toBe("rate_limited");
    expect(limitedResult.errors[0]?.message).toMatch(/1710000000/);
    const limitedBare = createXAdapter(async () => new Response("rate", { status: 429 }));
    expect(
      (await limitedBare.fetch(tokenConfig, { query: "", limit: 10 })).errors[0]?.message,
    ).toMatch(/rate-limited/);
  });

  it("follows a bounded next_token page and stops after three pages", async () => {
    const tokens: Array<string | null> = [];
    const adapter = createXAdapter(async (input) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      tokens.push(url.searchParams.get("next_token"));
      const page = tokens.length;
      return Response.json({
        data: [
          {
            id: String(page),
            text: `page ${page} bitcoin etf inflows after issuer filing covering listed products`,
            created_at: "2026-09-10T11:00:00.000Z",
            author_id: "1",
          },
        ],
        includes: { users: [{ id: "1", username: "bob" }] },
        meta: page < 3 ? { result_count: 1, next_token: `cursor-${page}` } : { result_count: 1 },
      });
    });
    const result = await adapter.fetch(tokenConfig, { query: "", limit: 50 });
    expect(tokens).toEqual([null, "cursor-1", "cursor-2"]);
    expect(result.evidence).toHaveLength(3);
    expect(result.adapterMetadata?.readsCharged).toBe(3);
  });
});
