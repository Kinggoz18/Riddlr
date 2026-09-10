import { Button, Card, EmptyState } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { api, CLIENT_LIST_CAP, takeBoundedClient } from "../api.js";

function EventsPage() {
  const [rows, setRows] = useState<
    Array<{
      id: string;
      title: string;
      independentCount: number;
      derivedCount: number;
      windowStart: string;
    }>
  >([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  useEffect(() => {
    void api<{ events: typeof rows }>("/api/v1/events?limit=50")
      .then((value) => {
        setRows(value.events);
        setHasMore(value.events.length === 50);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);
  if (loading) {
    return <p>Loading events…</p>;
  }
  if (error) {
    return <EmptyState title="Unable to load events" body={error} />;
  }
  if (rows.length === 0) {
    return (
      <EmptyState title="No events" body="Events appear when evidence clusters after a scan." />
    );
  }
  return (
    <>
      <h1>Events</h1>
      {rows.map((row) => (
        <Card key={row.id}>
          <NavLink to={`/events/${row.id}`}>{row.title}</NavLink>
          <p>
            Independent {row.independentCount} · Derived {row.derivedCount}
          </p>
        </Card>
      ))}
      {hasMore && rows.length < CLIENT_LIST_CAP ? (
        <Button
          onClick={async () => {
            const last = rows.at(-1);
            if (!last) {
              return;
            }
            const body = await api<{ events: typeof rows }>(
              `/api/v1/events?limit=50&before=${encodeURIComponent(last.windowStart)}`,
            );
            setRows((current) => takeBoundedClient(current, body.events));
            setHasMore(body.events.length === 50);
          }}
        >
          Load older
        </Button>
      ) : null}
    </>
  );
}
export { EventsPage };
