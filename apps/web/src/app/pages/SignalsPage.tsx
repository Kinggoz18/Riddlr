import { Button, Card, EmptyState, PageHeader } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { api, CLIENT_LIST_CAP, takeBoundedClient } from "../api.js";
import { catalystKindLabel } from "../format.js";

function SignalsPage() {
  const [rows, setRows] = useState<
    Array<{
      id: string;
      headline: string;
      risk: string;
      whyItMatters: string;
      createdAt: string;
      catalystKind?: string | null;
    }>
  >([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  useEffect(() => {
    void api<{ signals: typeof rows }>("/api/v1/signals?limit=50")
      .then((value) => {
        setRows(value.signals);
        setHasMore(value.signals.length === 50);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);
  if (loading) {
    return <p>Loading signals…</p>;
  }
  if (error) {
    return <EmptyState title="Unable to load signals" body={error} />;
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No signals"
        body="Signals appear after a material Crypto event is analyzed with proof."
      />
    );
  }
  return (
    <>
      <PageHeader
        title="Signals"
        description="Validated intelligence with proof. Empty until a material Crypto event is analyzed."
      />
      <section className="record-list">
        {rows.map((row) => (
          <Card key={row.id} className="record-row">
            <NavLink to={`/signals/${row.id}`}>{row.headline}</NavLink>
            <span className="badge danger">{row.risk}</span>
            {row.catalystKind ? (
              <p className="record-meta">
                <span>{catalystKindLabel(row.catalystKind)}</span>
              </p>
            ) : null}
            <p>{row.whyItMatters}</p>
          </Card>
        ))}
      </section>
      {hasMore && rows.length < CLIENT_LIST_CAP ? (
        <Button
          onClick={async () => {
            const last = rows.at(-1);
            if (!last) {
              return;
            }
            const body = await api<{ signals: typeof rows }>(
              `/api/v1/signals?limit=50&before=${encodeURIComponent(last.createdAt)}`,
            );
            setRows((current) => takeBoundedClient(current, body.signals));
            setHasMore(body.signals.length === 50);
          }}
        >
          Load older
        </Button>
      ) : null}
    </>
  );
}
export { SignalsPage };
