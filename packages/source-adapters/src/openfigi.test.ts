import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mapOpenFigiIdentifiers, parseOpenFigiMapping } from "./openfigi.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/openfigi");

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as unknown;
}

const jobs = [
  { idType: "TICKER" as const, idValue: "AAPL", exchCode: "US" },
  { idType: "TICKER" as const, idValue: "NOTATICKERXYZ", exchCode: "US" },
  { idType: "TICKER" as const, idValue: "SAN" },
];

describe("OpenFIGI mapping", () => {
  it("parses a captured hit, miss, and multi-match in one mapping response", () => {
    const parsed = parseOpenFigiMapping(readJson("mapping-hit-miss-multi.json"), jobs);
    expect(parsed.error).toBeUndefined();
    expect(parsed.results).toHaveLength(3);
    expect(parsed.results[0]?.status).toBe("mapped");
    expect(parsed.results[0]?.match?.figi).toBe("BBG000B9XRY4");
    expect(parsed.results[0]?.match?.compositeFigi).toBe("BBG000B9XRY4");
    expect(parsed.results[0]?.match?.exchCode).toBe("US");
    expect(parsed.results[1]?.status).toBe("unmapped");
    expect(parsed.results[1]?.warning).toMatch(/No identifier found/i);
    expect(parsed.results[2]?.status).toBe("multi_match");
    expect(parsed.results[2]?.matches.length).toBeGreaterThan(1);
  });

  it("qualifies a multi-match down to the requested exchange", () => {
    const parsed = parseOpenFigiMapping(readJson("mapping-hit-miss-multi.json"), [
      { idType: "TICKER", idValue: "AAPL", exchCode: "US" },
      { idType: "TICKER", idValue: "NOTATICKERXYZ", exchCode: "US" },
      { idType: "TICKER", idValue: "SAN", exchCode: "US" },
    ]);
    expect(parsed.results[2]?.status).toBe("mapped");
    expect(parsed.results[2]?.match?.figi).toBe("BBG000BTJS47");
    expect(parsed.results[2]?.match?.exchCode).toBe("US");
  });

  it("classifies an empty array as no mappings and an object as malformed", () => {
    expect(parseOpenFigiMapping([], []).results).toEqual([]);
    expect(parseOpenFigiMapping(readJson("mapping-empty-object.json"), jobs).error).toMatch(
      /not an array/,
    );
  });

  it("classifies a captured row missing figi as unmapped", () => {
    const parsed = parseOpenFigiMapping(readJson("mapping-drift-missing-figi.json"), jobs);
    expect(parsed.results[0]?.status).toBe("unmapped");
  });

  it("posts mapping jobs and does not follow redirects", async () => {
    const captured = readJson("mapping-hit-miss-multi.json");
    const mapped = await mapOpenFigiIdentifiers({
      jobs,
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe("https://api.openfigi.com/v3/mapping");
        expect(init?.method).toBe("POST");
        return Response.json(captured);
      },
    });
    expect(mapped.results[0]?.status).toBe("mapped");
    const redirected = await mapOpenFigiIdentifiers({
      jobs: [{ idType: "TICKER", idValue: "AAPL", exchCode: "US" }],
      fetchImpl: async () =>
        new Response(null, { status: 302, headers: { location: "https://example.com" } }),
    });
    expect(redirected.results).toEqual([]);
    expect(redirected.error).toMatch(/redirect/);
  });
});
