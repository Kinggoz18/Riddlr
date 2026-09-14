import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createEdgarAdapter,
  edgarAtomUrl,
  edgarEvidenceFromAtom,
  edgarUserAgent,
  padCik,
  parseContactEmail,
  parseEdgarAtom,
  parseEdgarItems,
  parseEftsHits,
  parseForm4Xml,
  parseSecCompanyTickers,
  secCanonicalId,
} from "./edgar.js";
import { classifyHttpStatus } from "./types.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/edgar");
const fetchedAt = new Date("2026-09-14T20:52:00.000Z");

function readFixture(name: string): string {
  return readFileSync(join(fixtures, name), "utf8");
}

function readJson(name: string): unknown {
  return JSON.parse(readFixture(name)) as unknown;
}

describe("EDGAR adapter", () => {
  it("parses a captured 8-K Atom page into CIK, items, and accession", () => {
    const parsed = parseEdgarAtom(readFixture("atom-8k-truncated.xml"), fetchedAt);
    expect(parsed.errors).toEqual([]);
    expect(parsed.entries).toHaveLength(4);
    expect(parsed.entries[0]?.form).toBe("8-K");
    expect(parsed.entries[0]?.cik).toBe("0001527613");
    expect(parsed.entries[0]?.issuerName).toBe("CIMG Inc.");
    expect(parsed.entries[0]?.items).toEqual(["5.02", "9.01"]);
    expect(parsed.entries[0]?.accessionNumber).toBe("0001493152-26-042596");
    expect(parsed.entries[1]?.items).toContain("1.01");
    expect(padCik(320193)).toBe("0000320193");
    expect(secCanonicalId("0000320193")).toBe("sec:0000320193");
  });

  it("builds native-complete filing evidence with an official SEC identity", () => {
    const parsed = parseEdgarAtom(readFixture("atom-8k-truncated.xml"), fetchedAt);
    const entry = parsed.entries[0];
    expect(entry).toBeDefined();
    const evidence = edgarEvidenceFromAtom(entry as NonNullable<typeof entry>, fetchedAt);
    expect(evidence.sourceFamily).toBe("filing");
    expect(evidence.adapterId).toBe("edgar");
    expect(evidence.contentCompleteness).toBe("native_complete");
    expect(evidence.sourceIdentity).toEqual({
      platform: "sec",
      externalId: "0001527613",
      displayName: "CIMG Inc.",
      hostname: "www.sec.gov",
    });
    expect(evidence.adapterPayload?.items).toEqual(["5.02", "9.01"]);
  });

  it("returns no entries for an empty Atom channel", () => {
    const parsed = parseEdgarAtom(readFixture("atom-8k-empty.xml"), fetchedAt);
    expect(parsed.entries).toEqual([]);
    expect(parsed.errors).toEqual([]);
  });

  it("classifies a captured entry missing title as malformed", () => {
    const parsed = parseEdgarAtom(readFixture("atom-8k-drift-missing-title.xml"), fetchedAt);
    expect(parsed.entries).toEqual([]);
    expect(parsed.errors[0]?.class).toBe("malformed");
    expect(parsed.errors[0]?.message).toContain("title");
  });

  it("rejects DTD and external entities", () => {
    const parsed = parseEdgarAtom(
      `<?xml version="1.0"?><!DOCTYPE feed [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><feed xmlns="http://www.w3.org/2005/Atom"></feed>`,
      fetchedAt,
    );
    expect(parsed.entries).toEqual([]);
    expect(parsed.errors[0]?.message).toMatch(/DTD/);
  });

  it("parses captured company_tickers rows including AAPL", () => {
    const parsed = parseSecCompanyTickers(readJson("company-tickers-truncated.json"));
    expect(parsed.errors).toEqual([]);
    const apple = parsed.rows.find((row) => row.ticker === "AAPL");
    expect(apple).toEqual({
      cik: "0000320193",
      ticker: "AAPL",
      title: "Apple Inc.",
    });
    expect(parsed.rows.some((row) => row.ticker === "SPY")).toBe(true);
  });

  it("skips ticker rows with the ticker removed", () => {
    const parsed = parseSecCompanyTickers(readJson("company-tickers-drift-missing-ticker.json"));
    expect(parsed.rows).toEqual([]);
  });

  it("parses a captured Form 4 sale with officer, shares, and price", () => {
    const parsed = parseForm4Xml(readFixture("form4.xml"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.cik).toBe("0000320193");
    expect(parsed.symbol).toBe("AAPL");
    expect(parsed.transaction?.code).toBe("S");
    expect(parsed.transaction?.shares).toBe(1438);
    expect(parsed.transaction?.price).toBe(317.23);
    expect(parsed.transaction?.officer).toBe(true);
    expect(parsed.transaction?.ownerName).toBe("Newstead Jennifer");
    expect((parsed.transaction?.shares ?? 0) * (parsed.transaction?.price ?? 0)).toBeCloseTo(
      1438 * 317.23,
    );
  });

  it("classifies a Form 4 missing transactionCode as malformed", () => {
    const parsed = parseForm4Xml(readFixture("form4-drift-missing-code.xml"));
    expect(parsed.transaction).toBeUndefined();
    expect(parsed.errors[0]?.class).toBe("malformed");
  });

  it("parses captured EFTS bitcoin 8-K hits", () => {
    const parsed = parseEftsHits(readJson("efts-bitcoin-8k-truncated.json"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.hits[0]?.cik).toBe("0002027708");
    expect(parsed.hits[0]?.form).toBe("8-K");
    expect(parsed.hits[0]?.items).toEqual(["7.01", "9.01"]);
    expect(parseEftsHits(readJson("efts-empty.json")).hits).toEqual([]);
  });

  it("requires a contact email and formats User-Agent without a browser token", () => {
    expect(parseContactEmail("not-an-email")).toBeUndefined();
    expect(parseContactEmail("ops@example.com")).toBe("ops@example.com");
    expect(edgarUserAgent("ops@example.com")).toBe("Riddlr/0.1 ops@example.com");
    expect(edgarAtomUrl("8-K")).toContain("type=8-K");
    expect(parseEdgarItems("2.02,9.01")).toEqual(["2.02", "9.01"]);
  });

  it("filters Atom filings to watched CIKs and skips unwatched issuers", async () => {
    const atom = readFixture("atom-8k-truncated.xml");
    const adapter = createEdgarAdapter(async (input) => {
      const url = String(input);
      expect(url).toContain("browse-edgar");
      if (!url.includes("type=8-K")) {
        return new Response(readFixture("atom-8k-empty.xml"), {
          status: 200,
          headers: { "content-type": "application/atom+xml" },
        });
      }
      return new Response(atom, {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      });
    });
    const none = await adapter.fetch(
      { contactEmail: "ops@example.com", watchedCiks: [], scanMode: "issuer" },
      { query: "" },
    );
    expect(none.evidence).toEqual([]);
    const watched = await adapter.fetch(
      {
        contactEmail: "ops@example.com",
        watchedCiks: ["0001527613"],
        scanMode: "issuer",
      },
      { query: "" },
    );
    expect(watched.errors).toEqual([]);
    expect(watched.evidence).toHaveLength(1);
    expect(watched.evidence[0]?.sourceIdentity?.externalId).toBe("0001527613");
    expect(watched.evidence[0]?.adapterPayload?.items).toEqual(["5.02", "9.01"]);
  });

  it("classifies captured 403 undeclared-tool HTML as blocked", async () => {
    const adapter = createEdgarAdapter(
      async () =>
        new Response(readFixture("403-undeclared-tool.html"), {
          status: 403,
          headers: { "content-type": "text/html" },
        }),
    );
    const result = await adapter.fetch(
      { contactEmail: "ops@example.com", watchedCiks: ["0000320193"], scanMode: "issuer" },
      { query: "" },
    );
    expect(result.evidence).toEqual([]);
    expect(result.errors[0]?.class).toBe("blocked");
    expect(result.errors[0]?.message).toMatch(/contact email/);
    expect(classifyHttpStatus(403)).toBe("capability_missing");
  });

  it("does not call SEC when the contact email is missing", async () => {
    const adapter = createEdgarAdapter(async () => {
      throw new Error("EDGAR must not be called without a contact email");
    });
    const result = await adapter.fetch({ watchedCiks: ["0000320193"] }, { query: "" });
    expect(result.evidence).toEqual([]);
    expect(result.errors[0]?.class).toBe("blocked");
    const validated = await adapter.validate({});
    expect(validated.ok).toBe(false);
  });

  it("classifies HTML 200 as unavailable", async () => {
    const adapter = createEdgarAdapter(
      async () =>
        new Response(readFixture("html-200-8k-index.html"), {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    const result = await adapter.fetch(
      { contactEmail: "ops@example.com", watchedCiks: ["0000320193"], scanMode: "issuer" },
      { query: "" },
    );
    expect(result.evidence).toEqual([]);
    expect(result.errors[0]?.class).toBe("unavailable");
  });

  it("fetches Form 4 XML for a watched issuer", async () => {
    const atom = readFixture("atom-form4-truncated.xml");
    const xml = readFixture("form4.xml");
    const adapter = createEdgarAdapter(async (input) => {
      const url = String(input);
      if (url.includes("output=atom")) {
        return new Response(atom, {
          status: 200,
          headers: { "content-type": "application/atom+xml" },
        });
      }
      if (url.endsWith("form4.xml")) {
        return new Response(xml, {
          status: 200,
          headers: { "content-type": "application/xml" },
        });
      }
      return new Response("missing", { status: 404 });
    });
    const result = await adapter.fetch(
      {
        contactEmail: "ops@example.com",
        watchedCiks: ["0001734770"],
        scanMode: "issuer",
      },
      { query: "" },
    );
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence[0]?.adapterPayload?.transactionCode).toBe("S");
    expect(result.evidence[0]?.adapterPayload?.shares).toBe(1438);
  });

  it("runs EFTS keyword search for crypto-adjacent issuers", async () => {
    const efts = readJson("efts-bitcoin-8k-truncated.json");
    const adapter = createEdgarAdapter(async (input) => {
      expect(String(input)).toContain("efts.sec.gov");
      expect(String(input)).toContain("bitcoin");
      return Response.json(efts);
    });
    const result = await adapter.fetch(
      {
        contactEmail: "ops@example.com",
        scanMode: "efts",
        eftsKeywords: ["bitcoin"],
      },
      { query: "" },
    );
    expect(result.errors).toEqual([]);
    expect(result.evidence[0]?.sourceIdentity?.externalId).toBe("0002027708");
    expect(result.evidence[0]?.adapterPayload?.form).toBe("8-K");
  });

  it("classifies 429 with Retry-After and writes no evidence", async () => {
    const adapter = createEdgarAdapter(
      async () => new Response("slow down", { status: 429, headers: { "retry-after": "8" } }),
    );
    const result = await adapter.fetch(
      { contactEmail: "ops@example.com", watchedCiks: ["0000320193"] },
      { query: "" },
    );
    expect(result.evidence).toEqual([]);
    expect(result.errors[0]?.class).toBe("rate_limited");
    expect(result.errors[0]?.message).toContain("Retry-After 8");
  });

  it("does not follow redirects", async () => {
    const adapter = createEdgarAdapter(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://www.sec.gov/elsewhere" },
        }),
    );
    const result = await adapter.fetch(
      { contactEmail: "ops@example.com", watchedCiks: ["0000320193"] },
      { query: "" },
    );
    expect(result.evidence).toEqual([]);
    expect(result.errors[0]?.class).toBe("unavailable");
  });
});
