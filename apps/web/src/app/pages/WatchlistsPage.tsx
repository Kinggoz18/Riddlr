import { Card, EmptyState, PageHeader } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ChipList } from "../ChipInput.js";
import { assetLabel } from "../format.js";

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
  if (error) {
    return <EmptyState title="Unable to load watchlists" body={error} />;
  }
  return (
    <>
      <PageHeader
        title="Watchlists"
        description="Named assets on each agent. Canonical IDs such as coingecko:bitcoin are stored underneath."
      />
      {!data ? <p>Loading watchlists…</p> : null}
      {data?.watchlists.length === 0 ? (
        <EmptyState title="No watchlists" body="Create an agent to get a watchlist." />
      ) : null}
      {data?.watchlists.map((list) => (
        <Card key={list.id}>
          <h2>{list.name}</h2>
          <p>{list.agentName}</p>
          <ChipList
            values={(list.items ?? []).map((item) => item.canonicalId)}
            format={assetLabel}
            empty="Empty watchlist"
          />
        </Card>
      ))}
    </>
  );
}
export { WatchlistsPage };
