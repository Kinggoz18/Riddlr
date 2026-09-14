import {
  MAX_OPENFIGI_BODY_BYTES,
  MAX_OPENFIGI_JOBS_AUTH,
  MAX_OPENFIGI_JOBS_UNAUTH,
  takeBounded,
} from "@riddlr/domain";
import { assertSafeHttpUrl, classifyHttpStatus, readBoundedJson } from "./types.js";

export const OPENFIGI_MAPPING_URL = "https://api.openfigi.com/v3/mapping";
export const OPENFIGI_USER_AGENT = "Riddlr/0.1";

export type OpenFigiJob = {
  idType: "TICKER" | "ID_ISIN";
  idValue: string;
  exchCode?: string;
};

export type OpenFigiMatch = {
  figi: string;
  name?: string;
  ticker?: string;
  exchCode?: string;
  compositeFigi?: string;
  shareClassFigi?: string;
  securityType?: string;
};

export type OpenFigiMappingResult = {
  status: "mapped" | "unmapped" | "multi_match" | "malformed";
  job: OpenFigiJob;
  match?: OpenFigiMatch;
  matches: OpenFigiMatch[];
  warning?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function parseMatch(value: unknown): OpenFigiMatch | undefined {
  const row = asRecord(value);
  if (!row) {
    return undefined;
  }
  const figi = typeof row.figi === "string" ? row.figi.trim() : "";
  if (!figi) {
    return undefined;
  }
  return {
    figi,
    name: typeof row.name === "string" ? row.name : undefined,
    ticker: typeof row.ticker === "string" ? row.ticker : undefined,
    exchCode: typeof row.exchCode === "string" ? row.exchCode : undefined,
    compositeFigi: typeof row.compositeFIGI === "string" ? row.compositeFIGI : undefined,
    shareClassFigi: typeof row.shareClassFIGI === "string" ? row.shareClassFIGI : undefined,
    securityType: typeof row.securityType === "string" ? row.securityType : undefined,
  };
}

export function parseOpenFigiMapping(
  payload: unknown,
  jobs: readonly OpenFigiJob[],
): { results: OpenFigiMappingResult[]; error?: string } {
  if (!Array.isArray(payload)) {
    return { results: [], error: "OpenFIGI mapping body is not an array." };
  }
  const results: OpenFigiMappingResult[] = [];
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    if (!job) {
      continue;
    }
    const row = payload[index];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      results.push({ status: "malformed", job, matches: [] });
      continue;
    }
    const rec = row as Record<string, unknown>;
    const warning = typeof rec.warning === "string" ? rec.warning : undefined;
    const error = typeof rec.error === "string" ? rec.error : undefined;
    const data = Array.isArray(rec.data) ? rec.data : [];
    const matches = data
      .map((item) => parseMatch(item))
      .filter((item): item is OpenFigiMatch => Boolean(item));
    if (warning || error || matches.length === 0) {
      results.push({
        status: "unmapped",
        job,
        matches,
        warning: warning ?? error ?? "No identifier found.",
      });
      continue;
    }
    const qualified = job.exchCode
      ? matches.filter((item) => item.exchCode === job.exchCode)
      : matches;
    const pool = qualified.length > 0 ? qualified : matches;
    if (pool.length > 1) {
      results.push({ status: "multi_match", job, matches: pool });
      continue;
    }
    const match = pool[0];
    if (!match) {
      results.push({ status: "unmapped", job, matches, warning: "No identifier found." });
      continue;
    }
    results.push({ status: "mapped", job, match, matches: pool });
  }
  return { results };
}

export async function mapOpenFigiIdentifiers(input: {
  jobs: readonly OpenFigiJob[];
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ results: OpenFigiMappingResult[]; error?: string; status?: number }> {
  const cap = input.apiKey ? MAX_OPENFIGI_JOBS_AUTH : MAX_OPENFIGI_JOBS_UNAUTH;
  const jobs = takeBounded(input.jobs, cap);
  if (jobs.length === 0) {
    return { results: [] };
  }
  assertSafeHttpUrl(OPENFIGI_MAPPING_URL);
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": OPENFIGI_USER_AGENT,
  };
  if (input.apiKey) {
    headers["X-OPENFIGI-APIKEY"] = input.apiKey;
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(OPENFIGI_MAPPING_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(jobs),
    signal: AbortSignal.timeout(15_000),
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    return {
      results: [],
      error: "OpenFIGI redirected; redirects are not followed.",
      status: response.status,
    };
  }
  if (!response.ok) {
    const classified = classifyHttpStatus(response.status);
    return {
      results: [],
      error: `OpenFIGI HTTP ${response.status} (${classified})`,
      status: response.status,
    };
  }
  const contentType = response.headers.get("content-type");
  if (contentType?.toLowerCase().includes("text/html")) {
    return { results: [], error: "OpenFIGI returned HTML.", status: response.status };
  }
  const payload = await readBoundedJson(response, MAX_OPENFIGI_BODY_BYTES);
  return parseOpenFigiMapping(payload, jobs);
}
