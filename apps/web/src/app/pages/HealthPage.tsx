import { Card, EmptyState, PageHeader, StatusBadge } from "@riddlr/ui";
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
      <PageHeader
        title="System health"
        description="PostgreSQL is source of truth. Valkey down pauses jobs; authenticated reads can continue."
      />
      <section className="health-grid">
        <Card>
          <div className="panel-heading">
            <h2>PostgreSQL</h2>
            <StatusBadge
              label={data.postgres ? "Healthy" : "Down"}
              tone={data.postgres ? "ok" : "danger"}
            />
          </div>
        </Card>
        <Card>
          <div className="panel-heading">
            <h2>Valkey</h2>
            <StatusBadge
              label={data.valkey ? "Healthy" : "Down"}
              tone={data.valkey ? "ok" : "danger"}
            />
          </div>
        </Card>
        <Card>
          <div className="panel-heading">
            <h2>Worker</h2>
            <StatusBadge
              label={data.workerHeartbeat ? "Online" : "Missing"}
              tone={data.workerHeartbeat ? "ok" : "danger"}
            />
          </div>
          <p className="metric-line">
            <span>Concurrency</span>
            <strong>{data.workerConcurrency ?? "—"}</strong>
          </p>
        </Card>
        {data.memory ? (
          <Card>
            <h2>API memory</h2>
            <div className="metric-pair">
              <p>
                <span>RSS</span>
                <strong>{(data.memory.rss / 1_048_576).toFixed(1)} MiB</strong>
              </p>
              <p>
                <span>Peak</span>
                <strong>{(data.memory.peakRss / 1_048_576).toFixed(1)} MiB</strong>
              </p>
            </div>
          </Card>
        ) : null}
      </section>
    </>
  );
}
export { HealthPage };
