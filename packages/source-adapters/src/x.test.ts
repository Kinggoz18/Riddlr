import { describe, expect, it } from "vitest";
import {
  buildRecentSearchQuery,
  createXAdapter,
  MAX_X_LOOKBACK_HOURS,
  parseXSearchPayload,
  X_API_BASE,
  X_RECENT_SEARCH_PATH,
} from "./x.js";

const fetchedAt = new Date("2026-09-10T12:00:00.000Z");

describe("X official recent search adapter", () => {
  it("parses posts and builds an x.com status URL", () => {
    const parsed = parseXSearchPayload(
      {
        data: [
          {
            id: "123",
            text: "Bitcoin ETF inflows",
            created_at: "2026-09-10T11:00:00.000Z",
            author_id: "9",
            public_metrics: { like_count: 2 },
          },
        ],
        includes: { users: [{ id: "9", username: "alice" }] },
      },
      fetchedAt,
    );
    expect(parsed.evidence).toHaveLength(1);
    expect(parsed.evidence[0]?.url).toBe("https://x.com/alice/status/123");
    expect(parsed.evidence[0]?.adapterPayload?.publicMetrics).toEqual({ like_count: 2 });
  });

  it("maps plan errors to capability_missing and never treats archive as available", () => {
    const parsed = parseXSearchPayload(
      {
        title: "Client Forbidden",
        detail: "This operation is not allowed.",
        status: 403,
        type: "https://api.x.com/2/problems/client-forbidden",
      },
      fetchedAt,
    );
    expect(parsed.evidence).toHaveLength(0);
    expect(parsed.errors[0]?.class).toBe("capability_missing");
    expect(parsed.errors[0]?.message).toMatch(/Archive search is not used/);
  });

  it("advertises 7-day recent search and rejects lookback beyond that window", async () => {
    const adapter = createXAdapter();
    expect(adapter.capabilities.lookbackNotes).toMatch(/last 7 days/);
    expect(adapter.capabilities.lookbackNotes).toMatch(/search\/all/);
    expect(MAX_X_LOOKBACK_HOURS).toBe(168);
    const invalid = await adapter.validate({
      token: "BearerTokenValueHere",
      keywords: ["bitcoin"],
      lookbackHours: 400,
    });
    expect(invalid.ok).toBe(false);
  });

  it("builds a bounded recent-search query from authors and keywords", () => {
    const query = buildRecentSearchQuery({
      authors: ["@alice", "bob"],
      keywords: ["bitcoin", "etf"],
    });
    expect(query).toContain("from:alice");
    expect(query).toContain("from:bob");
    expect(query).toContain("bitcoin");
    expect(query.length).toBeLessThanOrEqual(512);
  });

  it("calls recent search only and maps 403 to a plan gap", async () => {
    const calls: string[] = [];
    const adapter = createXAdapter(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      return Response.json(
        { title: "Client Forbidden", detail: "Not available on this plan.", status: 403 },
        { status: 403 },
      );
    });
    const result = await adapter.fetch(
      { token: "BearerTokenValueHere", keywords: ["bitcoin"], lookbackHours: 24 },
      { query: "bitcoin", limit: 20 },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`${X_API_BASE}${X_RECENT_SEARCH_PATH}`);
    expect(calls[0]).not.toContain("search/all");
    expect(result.errors[0]?.class).toBe("capability_missing");
  });

  it("parses a successful recent-search fetch", async () => {
    const adapter = createXAdapter(async () =>
      Response.json({
        data: [
          {
            id: "99",
            text: "stablecoin depeg chatter",
            created_at: "2026-09-10T11:00:00.000Z",
            author_id: "1",
          },
        ],
        includes: { users: [{ id: "1", username: "bob" }] },
      }),
    );
    const result = await adapter.fetch(
      { token: "BearerTokenValueHere", keywords: ["stablecoin"], lookbackHours: 12 },
      { query: "", limit: 20 },
    );
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.url).toBe("https://x.com/bob/status/99");
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
        meta: page < 3 ? { next_token: `cursor-${page}` } : {},
      });
    });
    const result = await adapter.fetch(
      { token: "BearerTokenValueHere", keywords: ["bitcoin"], lookbackHours: 12 },
      { query: "", limit: 50 },
    );
    expect(tokens).toEqual([null, "cursor-1", "cursor-2"]);
    expect(result.evidence).toHaveLength(3);
  });
});
