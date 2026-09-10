import { Button, Card, EmptyState } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { api, CLIENT_LIST_CAP, takeBoundedClient } from "../api.js";

function ScansPage() {
  const [data, setData] = useState<{
    scans: Array<{ id: string; status: string; partial: boolean; startedAt: string }>;
    sourceRuns: Array<{ status: string; errorMessage?: string | null }>;
  }>();
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    void api<NonNullable<typeof data>>("/api/v1/scans?limit=50")
      .then((value) => {
        setData(value);
        setHasMore(value.scans.length === 50);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"));
  }, []);
  if (error) {
    return <EmptyState title="Unable to load scans" body={error} />;
  }
  if (!data) {
    return <p>Loading scans…</p>;
  }
  if (!data.scans.length) {
    return <EmptyState title="No scans" body="Queue a scan from the Agents page." />;
  }
  return (
    <>
      <h1>Scan history</h1>
      {data.scans.map((scan) => (
        <Card key={scan.id}>
          <p>
            {scan.status} {scan.partial ? "(partial)" : ""}
          </p>
        </Card>
      ))}
      {data.sourceRuns.map((run, index) => (
        <p key={`${run.status}-${run.errorMessage ?? "ok"}-${index}`}>
          Source run: {run.status}
          {run.errorMessage ? ` — ${run.errorMessage}` : ""}
        </p>
      ))}
      {hasMore && data.scans.length < CLIENT_LIST_CAP ? (
        <Button
          onClick={async () => {
            const last = data.scans.at(-1);
            if (!last) {
              return;
            }
            const body = await api<NonNullable<typeof data>>(
              `/api/v1/scans?limit=50&before=${encodeURIComponent(last.startedAt)}`,
            );
            setData((current) =>
              current
                ? {
                    scans: takeBoundedClient(current.scans, body.scans),
                    sourceRuns: takeBoundedClient(current.sourceRuns, body.sourceRuns),
                  }
                : body,
            );
            setHasMore(body.scans.length === 50);
          }}
        >
          Load older
        </Button>
      ) : null}
    </>
  );
}
export { ScansPage };
