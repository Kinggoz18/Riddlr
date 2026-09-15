import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalizeUrl } from "@riddlr/domain";
import { describe, expect, it } from "vitest";
import {
  createSnapshotAdapter,
  parseSnapshotGraphQL,
  parseSnapshotProposal,
  parseSnapshotSpaces,
  SNAPSHOT_ADAPTER_ID,
  snapshotEvidenceFromProposal,
  snapshotProposalUrl,
} from "./snapshot.js";
import { classifyHttpStatus } from "./types.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/snapshot");

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as unknown;
}

const fetchedAt = new Date("2026-09-14T17:31:00.000Z");

describe("Snapshot governance adapter", () => {
  it("parses captured Grove proposals, link, and zero scores_total", () => {
    const parsed = parseSnapshotGraphQL(readJson("proposals-grove-truncated.json"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.proposals).toHaveLength(2);
    expect(parsed.proposals[0]?.id).toBe(
      "0x1a95608718c0fa345422e19fffce5f7e93f3af6d5a7e8318f567d11cfe545335",
    );
    expect(parsed.proposals[0]?.spaceId).toBe("grovefinance.eth");
    expect(parsed.proposals[0]?.state).toBe("active");
    expect(parsed.proposals[0]?.created).toBe(1789402292);
    expect(parsed.proposals[0]?.scoresTotal).toBe(0);
    expect(parsed.proposals[0]?.link).toBe(
      "https://snapshot.box/#/s:grovefinance.eth/proposal/0x1a95608718c0fa345422e19fffce5f7e93f3af6d5a7e8318f567d11cfe545335",
    );
    const firstProposal = parsed.proposals[0];
    const secondProposal = parsed.proposals[1];
    expect(firstProposal).toBeDefined();
    expect(secondProposal).toBeDefined();
    const first = snapshotEvidenceFromProposal(
      firstProposal as NonNullable<typeof firstProposal>,
      fetchedAt,
    );
    const second = snapshotEvidenceFromProposal(
      secondProposal as NonNullable<typeof secondProposal>,
      fetchedAt,
    );
    expect(canonicalizeUrl(first.canonicalUrl)).toContain("grovefinance.eth/proposal/");
    expect(canonicalizeUrl(first.canonicalUrl)).not.toBe(canonicalizeUrl(second.canonicalUrl));
  });

  it("builds native-complete evidence with a snapshot space identity", () => {
    const parsed = parseSnapshotGraphQL(readJson("proposals-grove-truncated.json"));
    const proposal = parsed.proposals[0];
    expect(proposal).toBeDefined();
    const evidence = snapshotEvidenceFromProposal(
      proposal as NonNullable<typeof proposal>,
      fetchedAt,
      "coingecko:grove",
    );
    expect(evidence.sourceFamily).toBe("governance");
    expect(evidence.adapterId).toBe(SNAPSHOT_ADAPTER_ID);
    expect(evidence.contentCompleteness).toBe("native_complete");
    expect(evidence.bodyText).toMatch(/governance proposal/i);
    expect(evidence.bodyText).toContain("0 votes");
    expect(evidence.sourceIdentity).toEqual({
      platform: "snapshot",
      externalId: "grovefinance.eth",
      displayName: "Grove",
      hostname: "snapshot.box",
    });
    expect(evidence.adapterPayload?.subjectCanonicalId).toBe("coingecko:grove");
  });

  it("returns no proposals for the documented empty list", () => {
    const parsed = parseSnapshotGraphQL(readJson("empty-proposals.json"));
    expect(parsed.proposals).toEqual([]);
    expect(parsed.errors).toEqual([]);
  });

  it("classifies a captured GraphQL errors array as malformed", () => {
    const parsed = parseSnapshotGraphQL(readJson("errors-unknown-argument.json"));
    expect(parsed.proposals).toEqual([]);
    expect(parsed.errors[0]?.class).toBe("malformed");
    expect(parsed.errors[0]?.message).toContain("Unknown argument");
  });

  it("classifies an empty object body as malformed", () => {
    const parsed = parseSnapshotGraphQL(readJson("empty-object.json"));
    expect(parsed.proposals).toEqual([]);
    expect(parsed.errors[0]?.class).toBe("malformed");
  });

  it("classifies a captured proposal missing id as malformed", () => {
    const parsed = parseSnapshotProposal(
      (readJson("proposals-drift-missing-id.json") as { data: { proposals: unknown[] } }).data
        .proposals[0],
    );
    expect(parsed.proposal).toBeUndefined();
    expect(parsed.errors[0]?.class).toBe("malformed");
    expect(parsed.errors[0]?.message).toContain("id");
  });

  it("polls pinned spaces through the captured GraphQL body", async () => {
    const grove = readJson("proposals-grove-truncated.json");
    const adapter = createSnapshotAdapter(async (input, init) => {
      expect(String(input)).toBe("https://hub.snapshot.org/graphql");
      expect(init?.method).toBe("POST");
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      expect(body.variables.spaces).toContain("grovefinance.eth");
      return Response.json(grove);
    });
    const result = await adapter.fetch({ spaces: ["grovefinance.eth"] }, { query: "", limit: 50 });
    expect(result.errors).toEqual([]);
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[0]?.canonicalUrl).toContain("grovefinance.eth/proposal/");
    expect(result.adapterMetadata?.persistConfig).toMatchObject({ lastCreatedUnix: 1789402292 });
  });

  it("classifies 429 with Retry-After and writes no evidence", async () => {
    const adapter = createSnapshotAdapter(
      async () => new Response("slow down", { status: 429, headers: { "retry-after": "8" } }),
    );
    const result = await adapter.fetch({ spaces: ["grovefinance.eth"] }, { query: "" });
    expect(result.evidence).toEqual([]);
    expect(result.errors[0]?.class).toBe("rate_limited");
    expect(result.errors[0]?.message).toContain("Retry-After 8");
    expect(classifyHttpStatus(429)).toBe("rate_limited");
  });

  it("does not follow redirects", async () => {
    const adapter = createSnapshotAdapter(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://example.com/graphql" },
        }),
    );
    const result = await adapter.fetch({ spaces: ["grovefinance.eth"] }, { query: "" });
    expect(result.evidence).toEqual([]);
    expect(result.errors[0]?.class).toBe("unavailable");
  });

  it("classifies an HTML 200 as unavailable", async () => {
    const adapter = createSnapshotAdapter(
      async () =>
        new Response("<html><body>nope</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    const result = await adapter.fetch({ spaces: ["grovefinance.eth"] }, { query: "" });
    expect(result.evidence).toEqual([]);
    expect(result.errors[0]?.class).toBe("unavailable");
  });

  it("fetches nothing when no spaces are pinned or derived", async () => {
    const adapter = createSnapshotAdapter(async () => {
      throw new Error("Snapshot must not be called without spaces");
    });
    const result = await adapter.fetch({ spaces: [] }, { query: "" });
    expect(result.evidence).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("uses persisted lastCreatedUnix as created_gt", async () => {
    const adapter = createSnapshotAdapter(async (_input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(String(init?.body)) : {};
      expect(body.variables.created).toBe(1789402292);
      return Response.json({ data: { proposals: [] } });
    });
    const result = await adapter.fetch(
      { spaces: ["grovefinance.eth"], lastCreatedUnix: 1789402292 },
      { query: "" },
    );
    expect(result.evidence).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("classifies HTTP 503 as unavailable", async () => {
    const adapter = createSnapshotAdapter(async () => new Response("down", { status: 503 }));
    const result = await adapter.fetch({ spaces: ["grovefinance.eth"] }, { query: "" });
    expect(result.evidence).toEqual([]);
    expect(result.errors[0]?.class).toBe("unavailable");
  });

  it("normalizes space ids and builds the documented snapshot.box URL", () => {
    expect(parseSnapshotSpaces(["GroveFinance.eth", "bad space"])).toEqual(["grovefinance.eth"]);
    expect(snapshotProposalUrl("aave.eth", "0xabc")).toBe(
      "https://snapshot.box/#/s:aave.eth/proposal/0xabc",
    );
  });
});
