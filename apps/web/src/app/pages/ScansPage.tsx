import { Button, Card, EmptyState, PageHeader, StatusBadge } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { api, CLIENT_LIST_CAP, takeBoundedClient } from "../api.js";

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

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
      <PageHeader
        title="Scan history"
        description="Each run records source success, partial failure, and evidence counts. Failed sources do not invent empty success."
      />
      <section className="record-list">
        {data.scans.map((scan) => (
          <Card key={scan.id} className="record-row">
            <time dateTime={scan.startedAt}>{dateTime.format(new Date(scan.startedAt))}</time>
            <StatusBadge
              label={scan.partial ? `${scan.status} · partial` : scan.status}
              tone={scan.status === "failed" ? "danger" : "ok"}
            />
          </Card>
        ))}
      </section>
      {data.sourceRuns.some((run) => run.errorMessage) ? (
        <Card>
          <h2>Source errors</h2>
          <ul className="data-list">
            {data.sourceRuns
              .filter((run) => run.errorMessage)
              .map((run, index) => (
                <li key={`${run.status}-${run.errorMessage}-${index}`}>{run.errorMessage}</li>
              ))}
          </ul>
        </Card>
      ) : null}
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
