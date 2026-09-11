import { Card, EmptyState, PageHeader, StatusBadge } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api.js";
import { eventStatusLabel, independenceCopy } from "../format.js";

function EventDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState<{
    event?: {
      title: string;
      status: string;
      independentCount: number;
      derivedCount: number;
      materialityReason?: string | null;
    };
    evidence: Array<{ id: string; title?: string; canonicalUrl?: string }>;
    roles: Array<{ evidenceId: string; role: string }>;
    observations?: Array<{ kind: string; value: unknown; sourceId: string }>;
    assets?: Array<{ canonicalId: string; symbol?: string | null; name?: string | null }>;
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
      <PageHeader
        title={data.event.title}
        description="Evidence clustered for one possible happening. Independent count is distinct hosts, not how many times a story was copied."
      />
      <p className="record-meta">
        <StatusBadge label={eventStatusLabel(data.event.status)} />
        <span>{independenceCopy(data.event.independentCount, data.event.derivedCount)}</span>
        {data.event.materialityReason ? (
          <span>Materiality: {data.event.materialityReason.replaceAll("_", " ")}</span>
        ) : null}
      </p>
      {data.assets && data.assets.length > 0 ? (
        <Card>
          <h2>Assets</h2>
          <p>
            {data.assets.map((item) => item.name || item.symbol || item.canonicalId).join(", ")}
          </p>
        </Card>
      ) : null}
      {data.observations && data.observations.length > 0 ? (
        <Card>
          <h2>Sourced observations</h2>
          <ul className="data-list">
            {data.observations.map((item) => (
              <li key={`${item.kind}-${item.sourceId}`}>
                <span>
                  {item.kind}: {String(item.value)}
                </span>
                <small>{item.sourceId}</small>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card>
        <h2>Evidence</h2>
        <ul className="data-list">
          {data.evidence.map((item) => (
            <li key={item.id}>
              <span>
                {item.canonicalUrl ? (
                  <a href={item.canonicalUrl}>{item.title ?? item.id}</a>
                ) : (
                  (item.title ?? item.id)
                )}
                <small>
                  {data.roles.find((role) => role.evidenceId === item.id)?.role ?? "primary"}
                  {data.independence?.nodes.find((node) => node.evidenceId === item.id)
                    ? ` · ${data.independence.nodes.find((node) => node.evidenceId === item.id)?.hostname}`
                    : ""}
                </small>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
export { EventDetailPage };
