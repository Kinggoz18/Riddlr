import { Button, Card, EmptyState, Field, PageHeader, StatusBadge } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { AssetPicker } from "../AssetPicker.js";
import { api } from "../api.js";
import { assetLabel } from "../format.js";

type ObservationHealth = {
  provider?: string;
  lastPollAt?: string | null;
  lastResult?: string | null;
  subjectCount?: number;
  seriesCount?: number;
  freshnessGapSeconds?: number | null;
  intervalSeconds?: number;
  retentionDays?: number;
};

type Pin = {
  id: string;
  provider: string;
  metric: string;
  subjectCanonicalId: string;
};

function HealthPage() {
  const [data, setData] = useState<{
    postgres: boolean;
    valkey: boolean;
    workerHeartbeat: string | null;
    workerConcurrency?: number;
    memory?: { rss: number; peakRss: number };
    enrichmentBacklog?: number;
    staleAssessments?: number;
    observations?: ObservationHealth;
  }>();
  const [pins, setPins] = useState<Pin[]>([]);
  const [pinIds, setPinIds] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  function refreshPins() {
    void api<{ pins: Pin[] }>("/api/v1/observations/pins")
      .then((body) => {
        setPins(body.pins);
        setPinIds([]);
      })
      .catch(() => {
        setPins([]);
      });
  }
  useEffect(() => {
    void api<NonNullable<typeof data>>("/api/v1/health")
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"));
    refreshPins();
  }, []);
  if (error) {
    return <EmptyState title="Unable to load health" body={error} />;
  }
  if (!data) {
    return <p>Loading health…</p>;
  }
  const observations = data.observations;
  return (
    <>
      <PageHeader
        title="System health"
        description="PostgreSQL is source of truth. Valkey down pauses jobs; authenticated reads can continue."
      />
      <section className="health-grid">
        <Card>
          <div className="panel-heading">
            <h2>PostgreSQL</h2>
            <StatusBadge
              label={data.postgres ? "Healthy" : "Down"}
              tone={data.postgres ? "ok" : "danger"}
            />
          </div>
        </Card>
        <Card>
          <div className="panel-heading">
            <h2>Valkey</h2>
            <StatusBadge
              label={data.valkey ? "Healthy" : "Down"}
              tone={data.valkey ? "ok" : "danger"}
            />
          </div>
        </Card>
        <Card>
          <div className="panel-heading">
            <h2>Worker</h2>
            <StatusBadge
              label={data.workerHeartbeat ? "Online" : "Missing"}
              tone={data.workerHeartbeat ? "ok" : "danger"}
            />
          </div>
          <p className="metric-line">
            <span>Concurrency</span>
            <strong>{data.workerConcurrency ?? "—"}</strong>
          </p>
        </Card>
        {data.memory ? (
          <Card>
            <h2>API memory</h2>
            <div className="metric-pair">
              <p>
                <span>RSS</span>
                <strong>{(data.memory.rss / 1_048_576).toFixed(1)} MiB</strong>
              </p>
              <p>
                <span>Peak</span>
                <strong>{(data.memory.peakRss / 1_048_576).toFixed(1)} MiB</strong>
              </p>
            </div>
          </Card>
        ) : null}
        <Card>
          <h2>Enrichment backlog</h2>
          <p className="metric-line">
            <span>Snippet evidence</span>
            <strong>{data.enrichmentBacklog ?? 0}</strong>
          </p>
        </Card>
        <Card>
          <h2>Stale assessments</h2>
          <p className="metric-line">
            <span>Legacy unassessed</span>
            <strong>{data.staleAssessments ?? 0}</strong>
          </p>
        </Card>
        <Card>
          <div className="panel-heading">
            <h2>Observations</h2>
            <StatusBadge
              label={
                observations?.lastResult === "ok" ? "Polling" : (observations?.lastResult ?? "Idle")
              }
              tone={observations?.lastResult === "ok" ? "ok" : "soon"}
            />
          </div>
          <p className="metric-line">
            <span>Subjects</span>
            <strong>{observations?.subjectCount ?? 0}</strong>
          </p>
          <p className="metric-line">
            <span>Series rows</span>
            <strong>{observations?.seriesCount ?? 0}</strong>
          </p>
          <p className="metric-line">
            <span>Freshness gap</span>
            <strong>
              {observations?.freshnessGapSeconds == null
                ? "—"
                : `${observations.freshnessGapSeconds}s`}
            </strong>
          </p>
          <p className="field-note">
            Interval {observations?.intervalSeconds ?? 60}s for CoinGecko spot. DefiLlama (opt-in)
            polls every 15 minutes. Retention {observations?.retentionDays ?? 90} days then daily
            downsample. Last poll {observations?.lastPollAt ?? "never"}.
          </p>
        </Card>
      </section>
      <Card>
        <h2>Pinned series</h2>
        <p className="field-note">
          Subjects nobody watches are not polled. Pin a registry asset to keep its series without a
          watchlist.
        </p>
        <ul className="asset-list">
          {pins.map((pin) => (
            <li key={pin.id}>
              <span className="asset-copy">
                <strong>{assetLabel(pin.subjectCanonicalId)}</strong>
                <small>
                  {pin.metric} · {pin.provider}
                </small>
              </span>
              <Button
                variant="ghost"
                onClick={() => {
                  void api(`/api/v1/observations/pins/${pin.id}`, { method: "DELETE" }).then(
                    refreshPins,
                  );
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
        {pins.length === 0 ? <p className="quiet-state">No pinned series</p> : null}
        <Field label="Pin an asset">
          <AssetPicker
            values={pinIds}
            onChange={(values) => {
              const next = values[values.length - 1];
              if (!next) {
                setPinIds(values);
                return;
              }
              void api("/api/v1/observations/pins", {
                method: "POST",
                body: JSON.stringify({ subjectCanonicalId: next }),
              }).then(refreshPins);
            }}
          />
        </Field>
      </Card>
    </>
  );
}
export { HealthPage };
