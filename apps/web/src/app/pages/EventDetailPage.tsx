import { EmptyState } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api.js";

function EventDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState<{
    event?: { title: string; independentCount: number; derivedCount: number };
    evidence: Array<{ id: string; title?: string; canonicalUrl?: string }>;
    roles: Array<{ evidenceId: string; role: string }>;
    observations?: Array<{ kind: string; value: unknown; sourceId: string }>;
    assets?: Array<{ canonicalId: string }>;
    independence?: { nodes: Array<{ evidenceId: string; hostname: string; role: string }> };
  }>();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!id) {
      return;
    }
    void api<NonNullable<typeof data>>(`/api/v1/events/${id}`)
      .then(setData)
      .catch(() => setMissing(true));
  }, [id]);
  if (missing) {
    return <EmptyState title="Event not found" body="This event does not exist." />;
  }
  if (!data?.event) {
    return <p>Loading event…</p>;
  }
  return (
    <>
      <h1>{data.event.title}</h1>
      <p>
        Independent {data.event.independentCount} · Derived reprints {data.event.derivedCount}
      </p>
      {data.assets && data.assets.length > 0 ? (
        <p>Assets: {data.assets.map((item) => item.canonicalId).join(", ")}</p>
      ) : null}
      {data.observations && data.observations.length > 0 ? (
        <ul>
          {data.observations.map((item) => (
            <li key={`${item.kind}-${item.sourceId}`}>
              {item.kind}: {String(item.value)} ({item.sourceId})
            </li>
          ))}
        </ul>
      ) : null}
      {data.independence?.nodes && data.independence.nodes.length > 0 ? (
        <p>
          Hosts:{" "}
          {[
            ...new Set(data.independence.nodes.map((item) => `${item.hostname} (${item.role})`)),
          ].join(", ")}
        </p>
      ) : null}
      <ul>
        {data.evidence.map((item) => (
          <li key={item.id}>
            {item.title} ({data.roles.find((role) => role.evidenceId === item.id)?.role})
          </li>
        ))}
      </ul>
    </>
  );
}
export { EventDetailPage };
