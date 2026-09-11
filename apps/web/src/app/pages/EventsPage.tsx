import { Button, Card, EmptyState, PageHeader, StatusBadge } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { api, CLIENT_LIST_CAP, takeBoundedClient } from "../api.js";
import {
  candidateKindLabel,
  dateTime,
  epistemicStatusLabel,
  eventStatusLabel,
  independenceCopy,
} from "../format.js";

type EventRow = {
  id: string;
  title: string;
  status: string;
  independentCount: number;
  derivedCount: number;
  windowStart: string;
  materialityReason?: string | null;
  epistemicStatus?: string | null;
  candidateKind?: string | null;
  assets?: Array<{ canonicalId: string; symbol?: string | null; name?: string | null }>;
};

function EventsPage() {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  useEffect(() => {
    void api<{ events: EventRow[] }>("/api/v1/events?limit=50")
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
  return (
    <>
      <PageHeader
        title="Events"
        description="Clusters of related evidence. Discovery can surface a candidate before analysis. A candidate is not a recommendation to buy, sell, or trade. Signals are created later, only after material analysis and the signal gate."
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No events"
          body="An event is a cluster of evidence from a scan — not a single search hit. Run a scan from Agents."
        />
      ) : (
        <>
          <section className="record-list">
            {rows.map((row) => (
              <Card key={row.id} className="record-row">
                <NavLink to={`/events/${row.id}`}>{row.title}</NavLink>
                <StatusBadge label={eventStatusLabel(row.status)} />
                <p className="record-meta">
                  <span>{independenceCopy(row.independentCount, row.derivedCount)}</span>
                  {row.candidateKind ? <span>{candidateKindLabel(row.candidateKind)}</span> : null}
                  {row.epistemicStatus ? (
                    <span>{epistemicStatusLabel(row.epistemicStatus)}</span>
                  ) : null}
                  <time dateTime={row.windowStart}>
                    {dateTime.format(new Date(row.windowStart))}
                  </time>
                  {(row.assets ?? []).length > 0 ? (
                    <span>
                      {(row.assets ?? [])
                        .map((asset) => asset.symbol || asset.name || asset.canonicalId)
                        .join(", ")}
                    </span>
                  ) : null}
                </p>
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
                const body = await api<{ events: EventRow[] }>(
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
      )}
    </>
  );
}
export { EventsPage };
