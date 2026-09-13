import { z } from "zod";
import type { ReliabilityStatus } from "./reliability.js";
import { SIGNAL_OUTPUT_KINDS } from "./reliability.js";

export const RISK_LEVELS = ["low", "moderate", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const signalOutputSchema = z
  .object({
    headline: z.string().min(1),
    whyItMatters: z.string().min(1),
    proof: z.object({
      evidenceIds: z.array(z.string().min(1)).min(1),
      claimIds: z.array(z.string().min(1)).optional(),
      summary: z.string().min(1),
    }),
    action: z.string().min(1),
    risk: z.enum(RISK_LEVELS),
    confidence: z.number(),
    assets: z.array(z.string()),
    eventType: z.string(),
    marketContext: z.string(),
    contradictoryEvidence: z.string(),
    invalidationConditions: z.string(),
    outputKind: z.enum(SIGNAL_OUTPUT_KINDS).optional(),
    claimedReliability: z.string().optional(),
  })
  .strict();

export type SignalOutput = z.infer<typeof signalOutputSchema>;

export const SIGNAL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "headline",
    "whyItMatters",
    "proof",
    "action",
    "risk",
    "confidence",
    "assets",
    "eventType",
    "marketContext",
    "contradictoryEvidence",
    "invalidationConditions",
  ],
  properties: {
    headline: { type: "string" },
    whyItMatters: { type: "string" },
    proof: {
      type: "object",
      additionalProperties: false,
      required: ["evidenceIds", "summary"],
      properties: {
        evidenceIds: { type: "array", items: { type: "string" } },
        claimIds: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
      },
    },
    action: { type: "string" },
    risk: { type: "string", enum: [...RISK_LEVELS] },
    confidence: { type: "number" },
    assets: { type: "array", items: { type: "string" } },
    eventType: { type: "string" },
    marketContext: { type: "string" },
    contradictoryEvidence: { type: "string" },
    invalidationConditions: { type: "string" },
    outputKind: { type: "string", enum: [...SIGNAL_OUTPUT_KINDS] },
    claimedReliability: { type: "string" },
  },
} as const;

export class InvalidSignalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSignalError";
  }
}

export function validateSignalOutput(
  value: unknown,
  allowedEvidenceIds: ReadonlySet<string>,
  allowedClaimIds: ReadonlySet<string> = new Set(),
  computedReliability?: ReliabilityStatus,
  claimEvidenceLinks?: ReadonlyMap<string, ReadonlySet<string>>,
): SignalOutput {
  const parsed = signalOutputSchema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidSignalError(parsed.error.message);
  }
  if (parsed.data.proof.evidenceIds.length === 0) {
    throw new InvalidSignalError("Signal proof must include evidence IDs.");
  }
  for (const id of parsed.data.proof.evidenceIds) {
    if (!allowedEvidenceIds.has(id)) {
      throw new InvalidSignalError(`Proof evidence ID is not on the event: ${id}`);
    }
  }
  if (
    allowedClaimIds.size > 0 &&
    (!parsed.data.proof.claimIds || parsed.data.proof.claimIds.length === 0)
  ) {
    throw new InvalidSignalError("Signal proof must include claim IDs.");
  }
  for (const id of parsed.data.proof.claimIds ?? []) {
    if (!allowedClaimIds.has(id)) {
      throw new InvalidSignalError(`Proof claim ID is not on the event: ${id}`);
    }
    const linked = claimEvidenceLinks?.get(id);
    if (
      claimEvidenceLinks &&
      (!linked || ![...parsed.data.proof.evidenceIds].some((evidenceId) => linked.has(evidenceId)))
    ) {
      throw new InvalidSignalError(`Proof claim ${id} is not supported by cited event evidence.`);
    }
  }
  if (parsed.data.confidence < 0 || parsed.data.confidence > 1) {
    throw new InvalidSignalError("Confidence must be between 0 and 1.");
  }
  if (
    parsed.data.claimedReliability &&
    computedReliability &&
    parsed.data.claimedReliability !== computedReliability
  ) {
    throw new InvalidSignalError("Model cannot promote reliability status.");
  }
  if (
    computedReliability &&
    computedReliability !== "corroborated" &&
    computedReliability !== "primary_confirmed" &&
    parsed.data.claimedReliability === "corroborated"
  ) {
    throw new InvalidSignalError("Model cannot promote single-source evidence to corroborated.");
  }
  return parsed.data;
}

export function wrapUntrustedSource(content: string): string {
  const escaped = content
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("untrusted-source", "untrusted_source");
  return `<untrusted-source length="${escaped.length}">\n${escaped}\n</untrusted-source>`;
}

export const INSTRUCTION_HIERARCHY = [
  "system_policy",
  "agent_policy",
  "skill_policy",
  "source_content",
] as const;
