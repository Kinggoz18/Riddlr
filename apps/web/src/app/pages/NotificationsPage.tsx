import { EmptyState } from "@riddlr/ui";
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
  return (
    <>
      <h1>Notifications</h1>
      {error ? <p role="alert">{error}</p> : null}
      {!data ? <p>Loading notifications…</p> : null}
      {data?.deliveries.length === 0 ? (
        <EmptyState title="No deliveries" body="Validated signals notify configured channels." />
      ) : null}
      <ul>
        {(data?.deliveries ?? []).map((item) => (
          <li key={item.id}>
            {item.channel} · {item.status}
            {item.destination ? ` · ${item.destination}` : ""}
          </li>
        ))}
      </ul>
    </>
  );
}
export { NotificationsPage };
