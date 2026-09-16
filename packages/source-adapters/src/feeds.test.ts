import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_FEED_ITEMS, OBSERVE_CLOCK_SKEW_MS } from "@riddlr/domain";
import { describe, expect, it } from "vitest";
import {
  clampFeedPollIntervalSeconds,
  createFeedsAdapter,
  DEFAULT_CRYPTO_FEEDS,
  defaultTrustForFeedUrl,
  parseFeedXml,
} from "./feeds.js";
import type { LookupFn } from "./types.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/feeds");
const fetchedAt = new Date("2026-09-14T12:52:00.000Z");
const publicLookup: LookupFn = async () => [{ address: "8.8.8.8", family: 4 }];

function readFixture(name: string): string {
  return readFileSync(join(fixtures, name), "utf8");
}

function xmlResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/rss+xml", ...(init.headers ?? {}) },
    ...init,
  });
}

describe("RSS and Atom feed adapter", () => {
  it("parses a captured Federal Reserve RSS 2.0 feed into snippet evidence", () => {
    const parsed = parseFeedXml(readFixture("rss-federalreserve-press-all.xml"), fetchedAt, {
      feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml",
    });
    expect(parsed.errors).toEqual([]);
    expect(parsed.evidence).toHaveLength(3);
    expect(parsed.evidence[0]?.sourceFamily).toBe("feed");
    expect(parsed.evidence[0]?.adapterId).toBe("feeds");
    expect(parsed.evidence[0]?.contentCompleteness).toBe("snippet");
    expect(parsed.evidence[0]?.url).toBe(
      "https://www.federalreserve.gov/newsevents/pressreleases/bcreg20260911a.htm",
    );
    expect(parsed.evidence[0]?.title).toMatch(/third-party risk management/);
    expect(parsed.evidence[0]?.publishedAt?.toISOString()).toBe("2026-09-11T14:00:00.000Z");
    expect(parsed.evidence[0]?.sourceIdentity).toEqual({
      platform: "feed",
      externalId: "www.federalreserve.gov",
      displayName: "FRB: Press Release - All Releases",
      hostname: "www.federalreserve.gov",
    });
  });

  it("marks content:encoded above 400 characters as native_complete and leaves short items as snippets", () => {
    const parsed = parseFeedXml(readFixture("rss-native-complete-bitcoin.xml"), fetchedAt, {
      feedUrl: "https://news.example.com/rss.xml",
    });
    expect(parsed.errors).toEqual([]);
    expect(parsed.evidence).toHaveLength(2);
    expect(parsed.evidence[0]?.contentCompleteness).toBe("native_complete");
    expect(parsed.evidence[0]?.bodyText).toMatch(/Bitcoin bridge exploit drained/);
    expect((parsed.evidence[0]?.bodyText ?? "").length).toBeGreaterThanOrEqual(400);
    expect(parsed.evidence[1]?.contentCompleteness).toBe("snippet");
    expect(parsed.evidence[1]?.bodyText).toMatch(/Too short|one-line Bitcoin teaser/);
  });

  it("parses a captured GitHub Atom feed and keeps out-of-order updated timestamps", () => {
    const parsed = parseFeedXml(readFixture("atom-github-bitcoin-releases.xml"), fetchedAt, {
      feedUrl: "https://github.com/bitcoin/bitcoin/releases.atom",
    });
    expect(parsed.evidence).toHaveLength(2);
    expect(parsed.evidence[0]?.title).toBe("Bitcoin Core 29.4");
    expect(parsed.evidence[0]?.url).toBe("https://github.com/bitcoin/bitcoin/releases/tag/v29.4");
    expect(parsed.evidence[0]?.author).toBe("fanquake");
    expect(parsed.evidence[0]?.publishedAt?.toISOString()).toBe("2026-07-10T14:25:37.000Z");
    expect(parsed.evidence[1]?.title).toBe("Bitcoin Core 31.1");
    expect(parsed.evidence[1]?.publishedAt?.toISOString()).toBe("2026-07-08T09:14:15.000Z");
  });

  it("parses a captured YouTube channel Atom feed", () => {
    const parsed = parseFeedXml(readFixture("atom-youtube-google.xml"), fetchedAt, {
      feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCK8sQmJBp8GCxrOtXWBpyEA",
    });
    expect(parsed.evidence).toHaveLength(1);
    expect(parsed.evidence[0]?.externalId).toBe("yt:video:rPq7ITrWFvY");
    expect(parsed.evidence[0]?.url).toBe("https://www.youtube.com/watch?v=rPq7ITrWFvY");
    expect(parsed.evidence[0]?.title).toBe("The latest updates to Google Translate");
    expect(parsed.evidence[0]?.bodyText).toMatch(/Live translate/);
    expect(parsed.evidence[0]?.author).toBe("Google");
  });

  it("treats a captured empty channel as an empty success", () => {
    const parsed = parseFeedXml(readFixture("rss-federalreserve-empty-channel.xml"), fetchedAt, {
      feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml",
    });
    expect(parsed.evidence).toEqual([]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.partial).toBe(false);
  });

  it("keeps a captured item that drifted a missing title when a description remains", () => {
    const parsed = parseFeedXml(
      readFixture("rss-federalreserve-drift-missing-title.xml"),
      fetchedAt,
      { feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml" },
    );
    expect(parsed.evidence).toHaveLength(1);
    expect(parsed.evidence[0]?.title).toMatch(/third-party risk management/);
    expect(parsed.evidence[0]?.url).toContain("bcreg20260911a.htm");
  });

  it("rejects HTML bodies and XML DTDs", () => {
    const html = parseFeedXml(readFixture("html-200-federalreserve-home.html"), fetchedAt, {
      feedUrl: "https://www.federalreserve.gov/",
    });
    expect(html.evidence).toEqual([]);
    expect(html.errors[0]?.class).toBe("malformed");
    const xxe = parseFeedXml(
      `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss version="2.0"><channel></channel></rss>`,
      fetchedAt,
      { feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml" },
    );
    expect(xxe.evidence).toEqual([]);
    expect(xxe.errors[0]?.message).toMatch(/DTD/);
  });

  it("skips duplicate guids and items that lack link and guid", () => {
    const rss = readFixture("rss-federalreserve-press-all.xml");
    const doubled = rss.replace("</channel>", `${extractFirstItem(rss)}</channel>`);
    const parsed = parseFeedXml(doubled, fetchedAt, {
      feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml",
    });
    expect(parsed.evidence).toHaveLength(3);
    const missing = parseFeedXml(
      `<?xml version="1.0"?><rss version="2.0"><channel><item><title>No link</title></item></channel></rss>`,
      fetchedAt,
      { feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml" },
    );
    expect(missing.evidence).toEqual([]);
    expect(missing.errors[0]?.class).toBe("malformed");
  });

  it("clamps publishedAt that is more than five minutes in the future", () => {
    const future = new Date(fetchedAt.getTime() + OBSERVE_CLOCK_SKEW_MS + 60_000).toUTCString();
    const parsed = parseFeedXml(
      `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Skew</title><link>https://www.federalreserve.gov/future.htm</link><pubDate>${future}</pubDate></item></channel></rss>`,
      fetchedAt,
      { feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml" },
    );
    expect(parsed.evidence[0]?.publishedAt?.toISOString()).toBe(fetchedAt.toISOString());
  });

  it("does not walk more items than the explicit bound", () => {
    const items = Array.from(
      { length: 80 },
      (_, index) =>
        `<item><title>Item ${index}</title><guid>https://example.com/${index}</guid></item>`,
    ).join("");
    const parsed = parseFeedXml(
      `<?xml version="1.0"?><rss version="2.0"><channel>${items}</channel></rss>`,
      fetchedAt,
      { feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml", maxItems: 5 },
    );
    expect(parsed.evidence).toHaveLength(5);
    expect(MAX_FEED_ITEMS).toBe(50);
  });

  it("defaults suggested official hostnames to official firsthand trust", () => {
    expect(DEFAULT_CRYPTO_FEEDS).toHaveLength(3);
    expect(DEFAULT_CRYPTO_FEEDS.map((item) => item.url)).toEqual([
      "https://blog.ethereum.org/en/feed.xml",
      "https://www.coindesk.com/arc/outboundfeeds/rss/",
      "https://decrypt.co/feed",
    ]);
    expect(defaultTrustForFeedUrl("https://www.federalreserve.gov/feeds/press_all.xml")).toBe(
      "official_firsthand",
    );
    expect(defaultTrustForFeedUrl("https://blog.ethereum.org/en/feed.xml")).toBe(
      "official_firsthand",
    );
    expect(defaultTrustForFeedUrl("https://www.coindesk.com/arc/outboundfeeds/rss/")).toBe(
      "reputable_press",
    );
    expect(defaultTrustForFeedUrl("https://decrypt.co/feed")).toBe("reputable_press");
    expect(defaultTrustForFeedUrl("https://blog.example.com/feed")).toBe("community");
    expect(clampFeedPollIntervalSeconds(10)).toBe(60);
    expect(clampFeedPollIntervalSeconds(9_999)).toBe(3_600);
    expect(clampFeedPollIntervalSeconds(undefined)).toBe(300);
  });

  it("fetches a captured RSS body through the adapter and persists ETag metadata", async () => {
    const body = readFixture("rss-federalreserve-press-all.xml");
    const adapter = createFeedsAdapter(async () => {
      return xmlResponse(body, {
        headers: { etag: '"abc"', "last-modified": "Fri, 11 Sep 2026 14:00:13 GMT" },
      });
    }, publicLookup);
    const result = await adapter.fetch(
      { feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml" },
      { query: "", limit: 10 },
    );
    expect(result.evidence).toHaveLength(3);
    expect(result.responseStatus).toBe(200);
    const persist = result.adapterMetadata?.persistConfig as { lastEtag?: string };
    expect(persist.lastEtag).toBe('"abc"');
  });

  it("returns empty evidence on 304 and doubles backoff", async () => {
    const adapter = createFeedsAdapter(
      async () => new Response(null, { status: 304 }),
      publicLookup,
    );
    const result = await adapter.fetch(
      {
        feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml",
        lastEtag: '"abc"',
        pollIntervalSeconds: 300,
        backoffSeconds: 300,
        unchangedStreak: 0,
      },
      { query: "" },
    );
    expect(result.evidence).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.responseStatus).toBe(304);
    const persist = result.adapterMetadata?.persistConfig as { backoffSeconds?: number };
    expect(persist.backoffSeconds).toBe(600);
  });

  it("skips a poll inside the backoff window without calling the network", async () => {
    let called = 0;
    const adapter = createFeedsAdapter(async () => {
      called += 1;
      return xmlResponse(readFixture("rss-federalreserve-press-all.xml"));
    }, publicLookup);
    const result = await adapter.fetch(
      {
        feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml",
        lastPolledAt: new Date().toISOString(),
        pollIntervalSeconds: 300,
      },
      { query: "" },
    );
    expect(called).toBe(0);
    expect(result.adapterMetadata?.skipped).toBe("interval");
  });

  it("classifies 429 with and without Retry-After, 5xx, 451, and timeouts", async () => {
    const limited = createFeedsAdapter(
      async () => new Response("slow", { status: 429, headers: { "retry-after": "12" } }),
      publicLookup,
    );
    const withHeader = await limited.fetch(
      { feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml" },
      { query: "" },
    );
    expect(withHeader.errors[0]).toEqual({
      class: "rate_limited",
      message: "Feed HTTP 429; Retry-After 12",
    });
    const noHeader = createFeedsAdapter(
      async () => new Response("slow", { status: 429 }),
      publicLookup,
    );
    const without = await noHeader.fetch(
      { feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml" },
      { query: "" },
    );
    expect(without.errors[0]?.class).toBe("rate_limited");
    expect(without.errors[0]?.message).toBe("Feed HTTP 429");
    const down = createFeedsAdapter(
      async () => new Response("nope", { status: 503 }),
      publicLookup,
    );
    const unavailable = await down.fetch(
      { feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml" },
      { query: "" },
    );
    expect(unavailable.errors[0]?.class).toBe("unavailable");
    expect(unavailable.evidence).toEqual([]);
    const geo = createFeedsAdapter(
      async () => new Response("blocked", { status: 451 }),
      publicLookup,
    );
    const blocked = await geo.fetch(
      { feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml" },
      { query: "" },
    );
    expect(blocked.errors[0]?.class).toBe("blocked");
    const timed = createFeedsAdapter(async () => {
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    }, publicLookup);
    const timeout = await timed.fetch(
      { feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml" },
      { query: "" },
    );
    expect(timeout.errors[0]?.class).toBe("timeout");
  });

  it("treats HTML 200, oversized bodies, and redirects to blocked hosts as failures", async () => {
    const html = createFeedsAdapter(
      async () =>
        new Response(readFixture("html-200-federalreserve-home.html"), {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      publicLookup,
    );
    const htmlResult = await html.fetch(
      { feedUrl: "https://www.federalreserve.gov/" },
      { query: "" },
    );
    expect(htmlResult.errors[0]?.class).toBe("malformed");
    const oversized = createFeedsAdapter(
      async () =>
        new Response("tiny", {
          status: 200,
          headers: { "content-length": "3000000", "content-type": "application/xml" },
        }),
      publicLookup,
    );
    const large = await oversized.fetch(
      { feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml" },
      { query: "" },
    );
    expect(large.errors[0]?.class).toBe("too_large");
    const redirected = createFeedsAdapter(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        }),
      publicLookup,
    );
    const ssrf = await redirected.fetch(
      { feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml" },
      { query: "" },
    );
    expect(ssrf.errors[0]?.class).toBe("blocked");
  });

  it("rejects loopback feed URLs at validate", async () => {
    const adapter = createFeedsAdapter();
    const result = await adapter.validate({ feedUrl: "http://127.0.0.1/feed.xml" });
    expect(result.ok).toBe(false);
  });
});

function extractFirstItem(rss: string): string {
  const start = rss.indexOf("<item>");
  const end = rss.indexOf("</item>") + "</item>".length;
  return rss.slice(start, end);
}
