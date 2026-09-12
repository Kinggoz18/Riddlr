import { Card, EmptyState, PageHeader, Skeleton, StatusBadge } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../api.js";
import { dateTime, eventStatusLabel } from "../format.js";
import { WatchlistAssets } from "../WatchlistAssets.js";
import { WATCHLIST_PREVIEW_LIMIT, type WatchlistSummary } from "../watchlist-view.js";

function OverviewPage() {
  const [data, setData] = useState<{
    agents: Array<{ id: string; name: string; kind: string }>;
    signals: Array<{ id: string; headline: string; risk: string }>;
    sources: Array<{ name: string; lastHealthOk: boolean | null }>;
    scans: Array<{ id: string; status: string; startedAt: string; partial: boolean }>;
    events: Array<{ id: string; title: string; status: string; windowStart: string }>;
    aiUsage: Array<{ promptTokens?: number | null }>;
    llmConfigured?: boolean;
    totpEnabled?: boolean;
    workerHealthy?: boolean;
    nextSteps?: Array<{ id: string; title: string; body: string; href: string; done: boolean }>;
  }>();
  const [error, setError] = useState<string>();
  const [watchlists, setWatchlists] = useState<WatchlistSummary[]>();
  useEffect(() => {
    void api<NonNullable<typeof data>>("/api/v1/overview")
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"));
  }, []);
  useEffect(() => {
    void api<{ watchlists: WatchlistSummary[] }>("/api/v1/watchlists")
      .then((body) => setWatchlists(body.watchlists))
      .catch(() => setWatchlists([]));
  }, []);
  if (error) {
    return <EmptyState title="Unable to load overview" body={error} />;
  }
  if (!data) {
    return <Skeleton label="Loading overview…" />;
  }
  const defaultAgent = data.agents.find((item) => item.kind === "system_default");
  const healthySources = data.sources.filter((source) => source.lastHealthOk === true).length;
  const latestSignal = data.signals[0];
  const lastScan = data.scans[0];
  const tokens = data.aiUsage.reduce((sum, row) => sum + (row.promptTokens ?? 0), 0);
  const remainingSteps = (data.nextSteps ?? []).filter((item) => !item.done);
  const scanActive = lastScan?.status === "queued" || lastScan?.status === "running";
  const deskNeedsAttention = remainingSteps.some((item) => item.id === "llm" || item.id === "scan");
  const featuredWatchlist =
    watchlists?.find((list) => list.agentId === defaultAgent?.id) ?? watchlists?.[0];
  return (
    <>
      <PageHeader
        title="Overview"
        description="Current Crypto desk: latest validated signal, recent evidence clusters, and source health."
      />
      {remainingSteps.length ? (
        <details className="desk-checklist" open={deskNeedsAttention}>
          <summary>
            <span>
              <h2>Finish the desk</h2>
              <span className="desk-count">{remainingSteps.length} remaining</span>
            </span>
          </summary>
          <p className="field-note">
            First-run is done. These remaining items are what make a full intelligence loop.
          </p>
          <ol className="next-steps">
            {remainingSteps.map((item, index) => (
              <li key={item.id}>
                <a href={item.href} target="_blank" rel="noreferrer">
                  <span className="step-index">{index + 1}</span>
                  <span className="next-step-copy">
                    <strong>{item.title}</strong>
                    <small>{item.body}</small>
                  </span>
                  <span aria-hidden="true">↗</span>
                </a>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {data.llmConfigured === false ? (
        <p className="notice notice-info">
          No model connected. Scans still collect evidence. Analysis waits until you add a provider
          in <NavLink to="/settings">Settings</NavLink>.
        </p>
      ) : null}
      <section className="overview-desk">
        <article className="intelligence-panel">
          <div className="panel-heading">
            <h2>Latest signal</h2>
            <NavLink to="/signals">View all</NavLink>
          </div>
          {latestSignal ? (
            <NavLink className="signal-lead" to={`/signals/${latestSignal.id}`}>
              <span>{latestSignal.headline}</span>
              <StatusBadge label={latestSignal.risk} tone="risk" />
            </NavLink>
          ) : scanActive ? (
            <div className="quiet-state">
              <p>{lastScan?.status === "running" ? "Scanning…" : "First scan queued"}</p>
              <p>
                {data.workerHealthy === false
                  ? "The worker is not running yet. Evidence collection starts when it is."
                  : "Signals appear after a material event is analyzed."}
              </p>
            </div>
          ) : (
            <div className="quiet-state">
              <p>No signals yet</p>
              <NavLink to="/agents">Run a scan</NavLink>
            </div>
          )}
        </article>
        <aside className="overview-status">
          <div>
            <span>Agents</span>
            <strong>{data.agents.length}</strong>
          </div>
          <div>
            <span>Sources healthy</span>
            <strong>
              {healthySources}/{data.sources.length}
            </strong>
          </div>
          <div>
            <span>Domain</span>
            <strong>Crypto</strong>
          </div>
        </aside>
      </section>
      <section className="overview-row" aria-label="Workspace status">
        <Card>
          <div className="panel-heading">
            <h2>Recent events</h2>
            <NavLink to="/events">View all</NavLink>
          </div>
          {data.events.length ? (
            <ul className="data-list">
              {data.events.slice(0, 5).map((event) => (
                <li key={event.id}>
                  <span>
                    <NavLink to={`/events/${event.id}`}>{event.title}</NavLink>
                    <small>{eventStatusLabel(event.status)}</small>
                  </span>
                  <time dateTime={event.windowStart}>
                    {dateTime.format(new Date(event.windowStart))}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="quiet-state">No events yet</p>
          )}
        </Card>
        <Card>
          <div className="panel-heading">
            <h2>Last scan</h2>
            <NavLink to="/scans">History</NavLink>
          </div>
          {lastScan ? (
            <p className="stat-value">
              {lastScan.status}
              {lastScan.partial ? " · partial" : ""} ·{" "}
              {dateTime.format(new Date(lastScan.startedAt))}
            </p>
          ) : (
            <p className="quiet-state">No scans yet</p>
          )}
          <p className="field-note">
            {defaultAgent?.name ?? "Default agent not configured"} · {tokens} prompt tokens recorded
          </p>
        </Card>
      </section>
      <section className="overview-row" aria-label="Sources">
        <Card>
          <div className="panel-heading">
            <h2>Sources</h2>
            <NavLink to="/sources">Manage</NavLink>
          </div>
          {data.sources.length ? (
            <ul className="status-list">
              {data.sources.map((source) => (
                <li key={source.name}>
                  <span>{source.name}</span>
                  <StatusBadge
                    label={
                      source.lastHealthOk === false
                        ? "Degraded"
                        : source.lastHealthOk
                          ? "Healthy"
                          : "Pending"
                    }
                    tone={source.lastHealthOk === false ? "danger" : "ok"}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="quiet-state">No sources</p>
          )}
        </Card>
        <Card>
          <div className="panel-heading">
            <h2>Watchlist</h2>
            <NavLink to={featuredWatchlist ? `/watchlists/${featuredWatchlist.id}` : "/watchlists"}>
              View all
            </NavLink>
          </div>
          {featuredWatchlist ? (
            <>
              <p className="field-note">
                {featuredWatchlist.agentName} · {featuredWatchlist.items?.length ?? 0} assets
              </p>
              <WatchlistAssets
                items={featuredWatchlist.items ?? []}
                limit={WATCHLIST_PREVIEW_LIMIT}
                moreHref={`/watchlists/${featuredWatchlist.id}`}
                empty="No assets on this watcher"
              />
            </>
          ) : watchlists ? (
            <p className="quiet-state">No watchlist yet</p>
          ) : (
            <p className="quiet-state">Loading watchlist…</p>
          )}
        </Card>
      </section>
    </>
  );
}
export { OverviewPage };
