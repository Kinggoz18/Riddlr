import { chartMetricLabel, DASHBOARD_CHART_METRICS } from "@riddlr/domain/web";
import { Card, EmptyState, PageHeader, Skeleton } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { api } from "../api.js";
import {
  assetDisplayName,
  catalystKindLabel,
  dateTime,
  formatSignedPct,
  formatSpotQuote,
  lifecycleStatusLabel,
  reliabilityStatusLabel,
} from "../format.js";
import { SeriesChart } from "../SeriesChart.js";

type AssetDesk = {
  asset: {
    canonicalId: string;
    symbol?: string | null;
    name?: string | null;
    assetClass?: string | null;
  };
  lastPrice?: { value: number; unit: string } | null;
  change24hPct?: number;
  funding?: { value: number; unit: string } | null;
  openInterest?: { value: number; unit: string } | null;
  tvl?: { value: number; unit: string } | null;
  series: Record<string, Array<{ observedAt: string; value: number }>>;
  events: Array<{
    id: string;
    title: string;
    reliabilityStatus: string;
    impactLevel?: string | null;
    lifecycleState: string;
    catalystKind?: string | null;
    firstObservedAt: string;
  }>;
  evidence: Array<{
    id: string;
    title?: string | null;
    canonicalUrl?: string | null;
    eventId: string;
    at: string;
  }>;
  claims: Array<{
    claimId: string;
    title: string;
    kind: string;
    stance: string;
    excerpt?: string | null;
    eventId: string;
  }>;
  firstIdentities: Array<{
    identityId: string;
    displayName?: string | null;
    eventId: string;
    reportedAt: string;
  }>;
};

function AssetPage() {
  const { canonicalId: raw } = useParams();
  const canonicalId = raw ? decodeURIComponent(raw) : undefined;
  const [data, setData] = useState<AssetDesk>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!canonicalId) {
      return;
    }
    void api<AssetDesk>(`/api/v1/asset-desk?canonicalId=${encodeURIComponent(canonicalId)}`)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"));
  }, [canonicalId]);
  if (error) {
    return <EmptyState title="Asset not found" body={error} />;
  }
  if (!data) {
    return <Skeleton label="Loading asset…" />;
  }
  const title = assetDisplayName(data.asset.canonicalId, data.asset);
  const markers = data.events.map((event) => ({
    at: event.firstObservedAt,
    href: `/events/${event.id}`,
    label: event.title,
  }));
  return (
    <>
      <PageHeader
        title={title}
        description="Observation series, events, evidence, claims, and identities that reported first. A candidate is not a recommendation to buy, sell, or trade."
      />
      <p className="record-meta">
        {data.lastPrice ? (
          <span>{formatSpotQuote(data.lastPrice.value, data.lastPrice.unit)}</span>
        ) : (
          <span>No spot yet</span>
        )}
        {formatSignedPct(data.change24hPct) ? (
          <span>{formatSignedPct(data.change24hPct)}</span>
        ) : null}
        {data.funding ? (
          <span>Funding {formatSpotQuote(data.funding.value, data.funding.unit)}</span>
        ) : null}
        {data.openInterest ? (
          <span>OI {formatSpotQuote(data.openInterest.value, data.openInterest.unit)}</span>
        ) : null}
        {data.tvl ? <span>TVL {formatSpotQuote(data.tvl.value, data.tvl.unit)}</span> : null}
      </p>
      {DASHBOARD_CHART_METRICS.map((metric) => (
        <Card key={metric}>
          <SeriesChart
            label={chartMetricLabel(metric)}
            points={data.series[metric] ?? []}
            markers={metric === "spot_price" ? markers : undefined}
            empty={`No ${chartMetricLabel(metric).toLowerCase()} observations yet`}
          />
        </Card>
      ))}
      <Card>
        <h2>Events</h2>
        {data.events.length ? (
          <ul className="data-list">
            {data.events.map((event) => (
              <li key={event.id}>
                <span>
                  <NavLink to={`/events/${event.id}`}>{event.title}</NavLink>
                  <small>
                    {reliabilityStatusLabel(event.reliabilityStatus)}
                    {event.impactLevel ? ` · Impact ${event.impactLevel}` : ""}
                    {` · ${lifecycleStatusLabel(event.lifecycleState)}`}
                    {event.catalystKind ? ` · ${catalystKindLabel(event.catalystKind)}` : ""}
                  </small>
                </span>
                <time dateTime={event.firstObservedAt}>
                  {dateTime.format(new Date(event.firstObservedAt))}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="quiet-state">No events for this asset</p>
        )}
      </Card>
      <Card>
        <h2>Evidence timeline</h2>
        {data.evidence.length ? (
          <ol className="lifecycle-timeline">
            {data.evidence.map((item) => (
              <li key={`${item.eventId}-${item.id}`}>
                <span>
                  <NavLink to={`/events/${item.eventId}`}>{item.title ?? item.id}</NavLink>
                  <small>{dateTime.format(new Date(item.at))}</small>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="quiet-state">No evidence on events for this asset</p>
        )}
      </Card>
      <Card>
        <h2>Claims</h2>
        {data.claims.length ? (
          <ul className="data-list">
            {data.claims.map((item) => (
              <li key={item.claimId}>
                <span>
                  {item.title}
                  <small>
                    {item.kind.replaceAll("_", " ")} · {item.stance}
                    {item.excerpt ? ` · “${item.excerpt}”` : ""}
                    {" · "}
                    <NavLink to={`/events/${item.eventId}`}>Event</NavLink>
                  </small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="quiet-state">No claims on events for this asset</p>
        )}
      </Card>
      <Card>
        <h2>First identities</h2>
        {data.firstIdentities.length ? (
          <ul className="data-list">
            {data.firstIdentities.map((item) => (
              <li key={`${item.eventId}-${item.identityId}`}>
                <span>
                  {item.displayName ?? "Unknown identity"}
                  <small>
                    {dateTime.format(new Date(item.reportedAt))} ·{" "}
                    <NavLink to={`/events/${item.eventId}`}>Event</NavLink>
                  </small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="quiet-state">No source identities recorded first on these events</p>
        )}
      </Card>
    </>
  );
}

export { AssetPage };
