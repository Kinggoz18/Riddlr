import { Button, Card, EmptyState, PageHeader, StatusBadge } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { api, CLIENT_LIST_CAP, takeBoundedClient } from "../api.js";
import { dateTime } from "../format.js";

type Delivery = {
  id: string;
  channel: string;
  status: string;
  destination?: string;
  createdAt: string;
};

function NotificationsPage() {
  const [rows, setRows] = useState<Delivery[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  useEffect(() => {
    void api<{ deliveries: Delivery[] }>("/api/v1/notifications?limit=50")
      .then((body) => {
        setRows(body.deliveries);
        setHasMore(body.deliveries.length === 50);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);
  if (error) {
    return <EmptyState title="Unable to load notifications" body={error} />;
  }
  if (loading) {
    return <p>Loading notifications…</p>;
  }
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Deliveries after a signal passes risk, cooldown, and quiet-hour policy."
      />
      {rows.length === 0 ? (
        <EmptyState title="No deliveries" body="Configure a channel in Settings." />
      ) : (
        <>
          <Card>
            <ul className="data-list">
              {rows.map((item) => (
                <li key={item.id}>
                  <span>
                    <strong>{item.channel}</strong>
                    {item.destination ? <small>{item.destination}</small> : null}
                  </span>
                  <span>
                    <StatusBadge
                      label={item.status}
                      tone={item.status === "failed" ? "danger" : "ok"}
                    />
                    {item.createdAt ? (
                      <small>
                        <time dateTime={item.createdAt}>
                          {dateTime.format(new Date(item.createdAt))}
                        </time>
                      </small>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          {hasMore && rows.length < CLIENT_LIST_CAP ? (
            <Button
              onClick={async () => {
                const last = rows.at(-1);
                if (!last?.createdAt) {
                  return;
                }
                const body = await api<{ deliveries: Delivery[] }>(
                  `/api/v1/notifications?limit=50&before=${encodeURIComponent(last.createdAt)}`,
                );
                setRows((current) => takeBoundedClient(current, body.deliveries));
                setHasMore(body.deliveries.length === 50);
              }}
            >
              Load older
            </Button>
          ) : null}
        </>
      )}
    </>
  );
}
export { NotificationsPage };
