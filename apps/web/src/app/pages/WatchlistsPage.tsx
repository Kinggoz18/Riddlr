import { MAX_WATCHLIST_ITEMS } from "@riddlr/domain/web";
import { Card, EmptyState, PageHeader, Skeleton } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useParams } from "react-router-dom";
import { api } from "../api.js";
import { WatchlistAssets } from "../WatchlistAssets.js";
import { WATCHLIST_TILE_LIMIT, type WatchlistSummary } from "../watchlist-view.js";

function useWatchlists() {
  const [data, setData] = useState<WatchlistSummary[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    void api<{ watchlists: WatchlistSummary[] }>("/api/v1/watchlists")
      .then((body) => setData(body.watchlists))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"));
  }, []);
  return { data, error };
}

function WatchlistIndex() {
  const { data, error } = useWatchlists();
  if (error) {
    return <EmptyState title="Unable to load watchlists" body={error} />;
  }
  return (
    <>
      <PageHeader
        title="Watchlists"
        description={`Named assets each agent watches. Canonical IDs such as coingecko:bitcoin or sec:0000320193 are stored underneath. Cap is ${MAX_WATCHLIST_ITEMS} assets per list.`}
      />
      {!data ? <Skeleton label="Loading watchlists…" /> : null}
      {data?.length === 0 ? (
        <EmptyState
          title="No watchlists"
          body="Create an agent to get a watchlist of named assets."
          action={
            <NavLink to="/agents/new" className="ui-button ui-button-primary">
              Create agent
            </NavLink>
          }
        />
      ) : null}
      {data && data.length > 0 ? (
        <section className="watchlist-grid">
          {data.map((list) => {
            const items = list.items ?? [];
            return (
              <NavLink
                key={list.id}
                to={`/watchlists/${list.id}`}
                className="watchlist-tile"
                aria-label={`${list.name}. ${list.agentName}. ${items.length} of ${MAX_WATCHLIST_ITEMS} assets`}
              >
                <p className="record-meta">{list.agentName}</p>
                <h2>{list.name}</h2>
                <p className="watchlist-count">
                  {items.length} of {MAX_WATCHLIST_ITEMS} assets
                </p>
                <WatchlistAssets items={items} limit={WATCHLIST_TILE_LIMIT} />
              </NavLink>
            );
          })}
        </section>
      ) : null}
    </>
  );
}

function WatchlistDetail() {
  const { id } = useParams();
  const { data, error } = useWatchlists();
  if (error) {
    return <EmptyState title="Unable to load watchlists" body={error} />;
  }
  if (!data) {
    return <Skeleton label="Loading watchlist…" />;
  }
  const list = data.find((item) => item.id === id);
  if (!list) {
    return <EmptyState title="Watchlist not found" body="This watchlist does not exist." />;
  }
  const items = list.items ?? [];
  return (
    <>
      <PageHeader
        title={list.name}
        description={`${list.agentName} watches these named assets. Edit the list on the agent.`}
        actions={
          <>
            <NavLink to="/watchlists" className="ui-button ui-button-ghost">
              All watchlists
            </NavLink>
            <NavLink to={`/agents/${list.agentId}/edit`} className="ui-button ui-button-primary">
              Edit watchlist
            </NavLink>
          </>
        }
      />
      <Card>
        <div className="panel-heading">
          <h2>Assets</h2>
          <span className="record-meta">
            {items.length} of {MAX_WATCHLIST_ITEMS}
          </span>
        </div>
        <WatchlistAssets items={items} empty="Empty watchlist" toAsset />
      </Card>
    </>
  );
}

function WatchlistsPage() {
  return (
    <Routes>
      <Route index element={<WatchlistIndex />} />
      <Route path=":id" element={<WatchlistDetail />} />
    </Routes>
  );
}

export { WatchlistsPage };
