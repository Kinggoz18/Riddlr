import { RELIABILITY_STATUSES } from "@riddlr/domain/web";
import { Button, Card, EmptyState, Field, PageHeader, StatusBadge } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { api, CLIENT_LIST_CAP, takeBoundedClient } from "../api.js";
import {
  candidateKindLabel,
  catalystKindLabel,
  dateTime,
  epistemicStatusLabel,
  eventStatusLabel,
  independenceCopy,
  leadTimeLabel,
  lifecycleStatusLabel,
  reliabilityStatusLabel,
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
  catalystKind?: string | null;
  reliabilityStatus?: string | null;
  impactLevel?: string | null;
  contentCompleteness?: string | null;
  lifecycleState?: string | null;
  leadTimeHours?: number | null;
  assets?: Array<{ canonicalId: string; symbol?: string | null; name?: string | null }>;
};

function EventsPage() {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [reliability, setReliability] = useState("");

  function eventsUrl(before?: string) {
    const params = new URLSearchParams({ limit: "50" });
    if (before) {
      params.set("before", before);
    }
    if (reliability) {
      params.set("reliability", reliability);
    }
    return `/api/v1/events?${params.toString()}`;
  }

  useEffect(() => {
    setLoading(true);
    setError(undefined);
    void api<{ events: EventRow[] }>(eventsUrl())
      .then((value) => {
        setRows(value.events);
        setHasMore(value.events.length === 50);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"))
      .finally(() => setLoading(false));
  }, [reliability]);

  return (
    <>
      <PageHeader
        title="Events"
        description="Clusters of related evidence. Independent origins are not reprints. Discovery can surface a candidate before analysis. A candidate is not a recommendation to buy, sell, or trade. Signals are created later, only after material analysis and the signal gate."
      />
      <Field label="Reliability">
        <select
          value={reliability}
          onChange={(event) => setReliability(event.target.value)}
          aria-label="Reliability"
        >
          <option value="">All statuses</option>
          {RELIABILITY_STATUSES.map((status) => (
            <option key={status} value={status}>
              {reliabilityStatusLabel(status)}
            </option>
          ))}
        </select>
      </Field>
      {loading ? (
        <p>Loading events…</p>
      ) : error ? (
        <EmptyState title="Unable to load events" body={error} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No events"
          body="An event is a cluster of evidence — a web article or a quantitative anomaly on a watched asset. Independent origins are not reprints. Run a scan from Agents, or wait for the observation poll."
        />
      ) : (
        <>
          <section className="record-list">
            {rows.map((row) => (
              <Card key={row.id} className="record-row">
                <NavLink to={`/events/${row.id}`}>{row.title}</NavLink>
                <StatusBadge label={eventStatusLabel(row.status)} />
                {row.lifecycleState ? (
                  <StatusBadge label={lifecycleStatusLabel(row.lifecycleState)} />
                ) : null}
                <p className="record-meta">
                  <span>{independenceCopy(row.independentCount, row.derivedCount)}</span>
                  {row.candidateKind ? <span>{candidateKindLabel(row.candidateKind)}</span> : null}
                  {row.catalystKind ? <span>{catalystKindLabel(row.catalystKind)}</span> : null}
                  {row.reliabilityStatus ? (
                    <span>{reliabilityStatusLabel(row.reliabilityStatus)}</span>
                  ) : null}
                  {leadTimeLabel(row.leadTimeHours) ? (
                    <span>{leadTimeLabel(row.leadTimeHours)}</span>
                  ) : null}
                  {row.impactLevel ? <span>Impact {row.impactLevel}</span> : null}
                  {row.contentCompleteness ? (
                    <span>{row.contentCompleteness.replaceAll("_", " ")}</span>
                  ) : null}
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
                const body = await api<{ events: EventRow[] }>(eventsUrl(last.windowStart));
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
