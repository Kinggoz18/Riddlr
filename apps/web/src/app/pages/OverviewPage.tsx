import { Card, EmptyState, Skeleton } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { api } from "../api.js";

function OverviewPage() {
  const [data, setData] = useState<{
    agents: Array<{ id: string; name: string; kind: string }>;
    signals: Array<{ id: string; headline: string; risk: string }>;
    sources: Array<{ name: string; lastHealthOk: boolean | null }>;
    domains: Array<{ id: string; name: string; status: string; comingSoon: boolean }>;
  }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    void api<NonNullable<typeof data>>("/api/v1/overview")
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"));
  }, []);
  if (error) {
    return <EmptyState title="Unable to load overview" body={error} />;
  }
  if (!data) {
    return <Skeleton label="Loading overview…" />;
  }
  return (
    <>
      <h1>Overview</h1>
      <div className="grid">
        <Card>
          <h2>Default agent</h2>
          <p>{data.agents.find((item) => item.kind === "system_default")?.name ?? "Not created"}</p>
          <p className="badge">Crypto</p>
        </Card>
        <Card>
          <h2>Markets</h2>
          {data.domains.map((domain) => (
            <p key={domain.id}>
              {domain.name}{" "}
              {domain.comingSoon ? (
                <span className="badge soon">Coming soon</span>
              ) : (
                <span className="badge">Supported</span>
              )}
            </p>
          ))}
        </Card>
        <Card>
          <h2>Source health</h2>
          {data.sources.length === 0 ? (
            <p>No sources scanned yet.</p>
          ) : (
            data.sources.map((source) => (
              <p key={source.name}>
                {source.name}:{" "}
                {source.lastHealthOk === false
                  ? "degraded"
                  : source.lastHealthOk
                    ? "ok"
                    : "unknown"}
              </p>
            ))
          )}
        </Card>
        <Card>
          <h2>Signals</h2>
          {data.signals[0] ? (
            <p>{data.signals[0].headline}</p>
          ) : (
            <p>No signals yet. Run a scan from Agents.</p>
          )}
        </Card>
      </div>
    </>
  );
}
export { OverviewPage };
