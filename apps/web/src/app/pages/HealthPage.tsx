import { EmptyState } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { api } from "../api.js";

function HealthPage() {
  const [data, setData] = useState<{
    postgres: boolean;
    valkey: boolean;
    workerHeartbeat: string | null;
    workerConcurrency?: number;
    memory?: { rss: number; peakRss: number };
  }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    void api<NonNullable<typeof data>>("/api/v1/health")
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"));
  }, []);
  if (error) {
    return <EmptyState title="Unable to load health" body={error} />;
  }
  if (!data) {
    return <p>Loading health…</p>;
  }
  return (
    <>
      <h1>System health</h1>
      <p>PostgreSQL: {data.postgres ? "ok" : "down"}</p>
      <p>Valkey: {data.valkey ? "ok" : "down"}</p>
      <p>Worker heartbeat: {data.workerHeartbeat ?? "missing"}</p>
      <p>Worker concurrency: {data.workerConcurrency ?? "—"}</p>
      {data.memory ? (
        <p>
          RSS {(data.memory.rss / 1_048_576).toFixed(1)} MiB · peak{" "}
          {(data.memory.peakRss / 1_048_576).toFixed(1)} MiB
        </p>
      ) : null}
    </>
  );
}
export { HealthPage };
