import { Card, EmptyState } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { api } from "../api.js";

function WatchlistsPage() {
  const [data, setData] = useState<{
    watchlists: Array<{
      id: string;
      name: string;
      agentName: string;
      items?: Array<{ canonicalId: string; symbol?: string | null }>;
    }>;
  }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    void api<NonNullable<typeof data>>("/api/v1/watchlists")
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"));
  }, []);
  return (
    <>
      <h1>Watchlists</h1>
      {error ? <p role="alert">{error}</p> : null}
      {!data ? <p>Loading watchlists…</p> : null}
      {data?.watchlists.length === 0 ? (
        <EmptyState title="No watchlists" body="Create an agent to get a watchlist." />
      ) : null}
      {data?.watchlists.map((list) => (
        <Card key={list.id}>
          <h2>{list.name}</h2>
          <p>{list.agentName}</p>
          <ul>
            {(list.items ?? []).map((item) => (
              <li key={item.canonicalId}>
                {item.canonicalId}
                {item.symbol ? ` (${item.symbol})` : ""}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </>
  );
}
export { WatchlistsPage };
