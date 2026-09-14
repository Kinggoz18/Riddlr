import {
  DEFAULT_SNAPSHOT_LOOKBACK_SECONDS,
  MAX_ENRICH_CHARS,
  MAX_SNAPSHOT_BODY_BYTES,
  MAX_SNAPSHOT_CALLS_PER_MINUTE,
  MAX_SNAPSHOT_PROPOSALS,
  MAX_SNAPSHOT_SPACES,
  type RawEvidence,
  takeBounded,
} from "@riddlr/domain";
import {
  assertSafeHttpUrl,
  classifyHttpStatus,
  type FetchQuery,
  type FetchResult,
  readBoundedJson,
  redactRequestUrl,
  type SourceAdapter,
  type SourceErrorClass,
} from "./types.js";

export const SNAPSHOT_ADAPTER_ID = "snapshot";
export const SNAPSHOT_FAMILY = "governance";
export const SNAPSHOT_GRAPHQL_URL = "https://hub.snapshot.org/graphql";
export const SNAPSHOT_USER_AGENT = "Riddlr/0.1 (https://github.com/Kinggoz18/Riddlr)";

const SPACE_RE = /^[A-Za-z0-9._-]{3,80}$/;
const MIN_CALL_GAP_MS = Math.ceil(60_000 / MAX_SNAPSHOT_CALLS_PER_MINUTE);

const PROPOSALS_QUERY = `query Proposals($spaces: [String!]!, $created: Int!) {
  proposals(
    first: 50
    where: { space_in: $spaces, created_gt: $created }
    orderBy: "created"
    orderDirection: "asc"
  ) {
    id
    created
    title
    body
    choices
    start
    end
    state
    author
    space { id name }
    scores
    scores_total
    votes
    link
  }
}`;

type SourceError = FetchResult["errors"][number];

export type ParsedSnapshotProposal = {
  id: string;
  created: number;
  title: string;
  body: string;
  choices: string[];
  start?: number;
  end?: number;
  state: string;
  author: string;
  spaceId: string;
  spaceName: string;
  scoresTotal?: number;
  votes?: number;
  link: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function looksLikeHtml(payload: unknown, contentType: string | null): boolean {
  if (contentType?.toLowerCase().includes("text/html")) {
    return true;
  }
  return typeof payload === "string" && /<html[\s>]/i.test(payload);
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

export function parseSnapshotSpaces(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const spaces: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const space = item.trim().toLowerCase();
    if (!SPACE_RE.test(space)) {
      continue;
    }
    spaces.push(space);
  }
  return takeBounded([...new Set(spaces)], MAX_SNAPSHOT_SPACES);
}

export function snapshotProposalUrl(spaceId: string, proposalId: string, link?: string): string {
  if (typeof link === "string" && /^https:\/\/snapshot\.box\//i.test(link.trim())) {
    return link.trim();
  }
  return `https://snapshot.box/#/s:${spaceId}/proposal/${proposalId}`;
}

export function parseSnapshotGraphQL(payload: unknown): {
  proposals: ParsedSnapshotProposal[];
  errors: SourceError[];
} {
  const row = asRecord(payload);
  if (!row) {
    return {
      proposals: [],
      errors: [{ class: "malformed", message: "Snapshot body is not an object." }],
    };
  }
  const graphqlErrors = row.errors;
  const errors: SourceError[] = [];
  if (Array.isArray(graphqlErrors) && graphqlErrors.length > 0) {
    const first = asRecord(graphqlErrors[0]);
    const message =
      typeof first?.message === "string" ? first.message : "Snapshot GraphQL returned errors.";
    errors.push({ class: "malformed", message });
  }
  const data = asRecord(row.data);
  const list = data?.proposals;
  if (list === undefined && errors.length > 0) {
    return { proposals: [], errors };
  }
  if (!Array.isArray(list)) {
    errors.push({ class: "malformed", message: "Snapshot proposals list is missing." });
    return { proposals: [], errors };
  }
  const proposals: ParsedSnapshotProposal[] = [];
  for (const item of takeBounded(list, MAX_SNAPSHOT_PROPOSALS)) {
    const parsed = parseSnapshotProposal(item);
    errors.push(...parsed.errors);
    if (parsed.proposal) {
      proposals.push(parsed.proposal);
    }
  }
  return { proposals, errors };
}

export function parseSnapshotProposal(payload: unknown): {
  proposal?: ParsedSnapshotProposal;
  errors: SourceError[];
} {
  const row = asRecord(payload);
  if (!row) {
    return {
      errors: [{ class: "malformed", message: "Snapshot proposal is not an object." }],
    };
  }
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) {
    return { errors: [{ class: "malformed", message: "Snapshot proposal is missing id." }] };
  }
  const space = asRecord(row.space);
  const spaceId = typeof space?.id === "string" ? space.id.trim().toLowerCase() : "";
  if (!SPACE_RE.test(spaceId)) {
    return { errors: [{ class: "malformed", message: "Snapshot proposal is missing space id." }] };
  }
  const created = parseFinite(row.created);
  if (!created) {
    return { errors: [{ class: "malformed", message: "Snapshot proposal is missing created." }] };
  }
  const title = typeof row.title === "string" ? row.title : id;
  const body = typeof row.body === "string" ? row.body : "";
  const author = typeof row.author === "string" ? row.author : "";
  const state = typeof row.state === "string" ? row.state : "unknown";
  const link = typeof row.link === "string" ? row.link : undefined;
  const choices = Array.isArray(row.choices)
    ? row.choices.filter((item): item is string => typeof item === "string")
    : [];
  return {
    proposal: {
      id,
      created,
      title,
      body,
      choices,
      start: parseFinite(row.start),
      end: parseFinite(row.end),
      state,
      author,
      spaceId,
      spaceName: typeof space?.name === "string" ? space.name : spaceId,
      scoresTotal: parseFinite(row.scores_total),
      votes: parseFinite(row.votes),
      link: snapshotProposalUrl(spaceId, id, link),
    },
    errors: [],
  };
}

export function snapshotEvidenceFromProposal(
  proposal: ParsedSnapshotProposal,
  fetchedAt: Date,
  subjectCanonicalId?: string,
): RawEvidence {
  const body = proposal.body.slice(0, MAX_ENRICH_CHARS);
  const votes = proposal.scoresTotal ?? proposal.votes;
  const voteLine =
    typeof votes === "number" ? `${votes} votes` : "voting has not recorded a scores_total";
  const bodyText = [
    `Snapshot vote in ${proposal.spaceName} (${proposal.spaceId}).`,
    `Governance proposal state ${proposal.state}.`,
    `Choices: ${proposal.choices.join(", ") || "none"}.`,
    voteLine,
    body,
  ].join("\n\n");
  return {
    sourceFamily: SNAPSHOT_FAMILY,
    adapterId: SNAPSHOT_ADAPTER_ID,
    externalId: proposal.id,
    url: proposal.link,
    canonicalUrl: proposal.link,
    title: proposal.title,
    bodyText,
    author: proposal.author,
    publishedAt: new Date(proposal.created * 1000),
    fetchedAt,
    contentCompleteness: "native_complete",
    originKey: `snapshot:${proposal.spaceId}`,
    sourceIdentity: {
      platform: "snapshot",
      externalId: proposal.spaceId,
      displayName: proposal.spaceName,
      hostname: "snapshot.box",
    },
    adapterPayload: {
      spaceId: proposal.spaceId,
      state: proposal.state,
      choices: proposal.choices,
      scoresTotal: proposal.scoresTotal,
      votes: proposal.votes,
      start: proposal.start,
      end: proposal.end,
      subjectCanonicalId,
    },
  };
}

export function createSnapshotAdapter(fetchImpl: typeof fetch = fetch): SourceAdapter {
  let lastCallAt = 0;
  return {
    id: SNAPSHOT_ADAPTER_ID,
    family: SNAPSHOT_FAMILY,
    capabilities: {
      modes: ["poll"],
      supportsTimeRange: true,
      supportsPagination: false,
      supportsDomainFilter: false,
      lookbackNotes:
        "Opt-in. Free Snapshot GraphQL, no key. Pin space ids such as grovefinance.eth. One POST to hub.snapshot.org/graphql, first 50 proposals created after the last cursor (default 7 days). Native-complete proposal evidence. Hub rate limit 100/min; Riddlr caps 60/min.",
      partialResults: true,
    },
    async validate(config) {
      parseSnapshotSpaces(config.spaces);
      parseSnapshotSpaces(config.derivedSpaces);
      return { ok: true, message: "ok" };
    },
    async healthCheck() {
      try {
        assertSafeHttpUrl(SNAPSHOT_GRAPHQL_URL);
        const response = await fetchImpl(SNAPSHOT_GRAPHQL_URL, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "user-agent": SNAPSHOT_USER_AGENT,
          },
          body: JSON.stringify({ query: "{ __typename }" }),
          signal: AbortSignal.timeout(15_000),
          redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400) {
          return { ok: false, message: "Snapshot redirected; redirects are not followed." };
        }
        if (!response.ok) {
          return { ok: false, message: `Snapshot HTTP ${response.status}` };
        }
        await readBoundedJson(response, MAX_SNAPSHOT_BODY_BYTES);
        return { ok: true, message: "Snapshot GraphQL answered." };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "Snapshot health check failed.",
        };
      }
    },
    async fetch(config, _query: FetchQuery): Promise<FetchResult> {
      const spaces = parseSnapshotSpaces([
        ...(Array.isArray(config.spaces) ? config.spaces : []),
        ...(Array.isArray(config.derivedSpaces) ? config.derivedSpaces : []),
      ]);
      const spaceAssets = asRecord(config.spaceAssets) ?? {};
      if (spaces.length === 0) {
        return {
          evidence: [],
          partial: false,
          errors: [],
          unresponsiveEngines: [],
        };
      }
      const nowUnix = Math.floor(Date.now() / 1000);
      const persisted = parseFinite(config.lastCreatedUnix);
      const createdGt =
        persisted && persisted > 0 ? persisted : nowUnix - DEFAULT_SNAPSHOT_LOOKBACK_SECONDS;
      const requestUrl = redactRequestUrl(SNAPSHOT_GRAPHQL_URL);
      try {
        assertSafeHttpUrl(SNAPSHOT_GRAPHQL_URL);
        const wait = Math.max(0, MIN_CALL_GAP_MS - (Date.now() - lastCallAt));
        if (wait > 0) {
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
        lastCallAt = Date.now();
        const response = await fetchImpl(SNAPSHOT_GRAPHQL_URL, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "user-agent": SNAPSHOT_USER_AGENT,
          },
          body: JSON.stringify({
            query: PROPOSALS_QUERY,
            variables: { spaces, created: createdGt },
          }),
          signal: AbortSignal.timeout(20_000),
          redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400) {
          return {
            evidence: [],
            partial: true,
            errors: [
              { class: "unavailable", message: "Snapshot redirected; redirects are not followed." },
            ],
            unresponsiveEngines: [],
            requestUrl,
            responseStatus: response.status,
          };
        }
        if (!response.ok) {
          const retryAfter = response.headers.get("retry-after");
          const classified = classifyHttpStatus(response.status) as SourceErrorClass;
          const message =
            response.status === 429 && retryAfter
              ? `Snapshot HTTP 429; Retry-After ${retryAfter}`
              : `Snapshot HTTP ${response.status}`;
          return {
            evidence: [],
            partial: true,
            errors: [{ class: classified, message }],
            unresponsiveEngines: [],
            requestUrl,
            responseStatus: response.status,
          };
        }
        const contentType = response.headers.get("content-type");
        if (contentType?.toLowerCase().includes("text/html")) {
          return {
            evidence: [],
            partial: true,
            errors: [{ class: "unavailable", message: "Snapshot returned HTML instead of JSON." }],
            unresponsiveEngines: [],
            requestUrl,
            responseStatus: response.status,
          };
        }
        let payload: unknown;
        try {
          payload = await readBoundedJson(response, MAX_SNAPSHOT_BODY_BYTES);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Snapshot body too large.";
          const timedOut = /timeout|aborted/i.test(message);
          const tooLarge = /size bound|too large/i.test(message);
          return {
            evidence: [],
            partial: true,
            errors: [
              {
                class: timedOut ? "timeout" : tooLarge ? "too_large" : "malformed",
                message,
              },
            ],
            unresponsiveEngines: [],
            requestUrl,
            responseStatus: response.status,
          };
        }
        if (looksLikeHtml(payload, contentType)) {
          return {
            evidence: [],
            partial: true,
            errors: [{ class: "unavailable", message: "Snapshot returned HTML instead of JSON." }],
            unresponsiveEngines: [],
            requestUrl,
            responseStatus: response.status,
          };
        }
        const parsed = parseSnapshotGraphQL(payload);
        const fetchedAt = new Date();
        const evidence = takeBounded(
          parsed.proposals.map((item) =>
            snapshotEvidenceFromProposal(
              item,
              fetchedAt,
              typeof spaceAssets[item.spaceId] === "string"
                ? String(spaceAssets[item.spaceId])
                : undefined,
            ),
          ),
          MAX_SNAPSHOT_PROPOSALS,
        );
        const maxCreated = parsed.proposals.reduce(
          (max, item) => Math.max(max, item.created),
          createdGt,
        );
        return {
          evidence,
          partial: parsed.errors.length > 0,
          errors: parsed.errors,
          unresponsiveEngines: [],
          requestUrl,
          responseStatus: response.status,
          adapterMetadata: {
            persistConfig: { lastCreatedUnix: maxCreated },
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Snapshot request failed.";
        const timedOut = /timeout|aborted/i.test(message);
        return {
          evidence: [],
          partial: true,
          errors: [{ class: timedOut ? "timeout" : "unavailable", message }],
          unresponsiveEngines: [],
          requestUrl,
        };
      }
    },
  };
}
