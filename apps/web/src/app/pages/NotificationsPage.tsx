import { Card, EmptyState, PageHeader, StatusBadge } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { api } from "../api.js";

function NotificationsPage() {
  const [data, setData] = useState<{
    deliveries: Array<{ id: string; channel: string; status: string; destination?: string }>;
  }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    void api<NonNullable<typeof data>>("/api/v1/notifications")
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"));
  }, []);
  if (error) {
    return <EmptyState title="Unable to load notifications" body={error} />;
  }
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Deliveries after a signal passes risk, cooldown, and quiet-hour policy."
      />
      {!data ? <p>Loading notifications…</p> : null}
      {data?.deliveries.length === 0 ? (
        <EmptyState title="No deliveries" body="Configure a channel in Settings." />
      ) : null}
      {data?.deliveries.length ? (
        <Card>
          <ul className="data-list">
            {data.deliveries.map((item) => (
              <li key={item.id}>
                <span>
                  <strong>{item.channel}</strong>
                  {item.destination ? <small>{item.destination}</small> : null}
                </span>
                <StatusBadge
                  label={item.status}
                  tone={item.status === "failed" ? "danger" : "ok"}
                />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
export { NotificationsPage };
