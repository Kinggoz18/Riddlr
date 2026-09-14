export function formatObservationAlert(input: {
  metric: string;
  op: string;
  threshold: number;
  value: number;
  unit?: string;
  provider: string;
  subjectCanonicalId: string;
  observedAt: Date;
}): string {
  const unit = input.unit ? ` ${input.unit}` : "";
  return [
    "OBSERVATION",
    "This is an observation, not a signal.",
    `METRIC: ${input.metric}`,
    `VALUE: ${input.value}${unit}`,
    `THRESHOLD: ${input.op} ${input.threshold}`,
    `PROVIDER: ${input.provider}`,
    `SUBJECT: ${input.subjectCanonicalId}`,
    `OBSERVED AT: ${input.observedAt.toISOString()}`,
  ].join("\n");
}
