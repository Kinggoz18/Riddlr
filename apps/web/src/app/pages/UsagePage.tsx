import { Button, EmptyState, PageHeader } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { api, CLIENT_LIST_CAP, takeBoundedClient } from "../api.js";

function UsagePage() {
  const [rows, setRows] = useState<
    Array<{
      provider: string;
      model: string;
      promptTokens?: number | null;
      latencyMs?: number | null;
      createdAt: string;
    }>
  >([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  useEffect(() => {
    void api<{ usage: typeof rows }>("/api/v1/ai-usage?limit=50")
      .then((value) => {
        setRows(value.usage);
        setHasMore(value.usage.length === 50);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);
  if (loading) {
    return <p>Loading AI usage…</p>;
  }
  if (error) {
    return <EmptyState title="Unable to load AI usage" body={error} />;
  }
  if (rows.length === 0) {
    return (
      <EmptyState title="No AI usage yet" body="Usage is recorded only after a real LLM call." />
    );
  }
  return (
    <>
      <PageHeader
        title="AI usage"
        description="Recorded only after a real LLM call. A finite daily token budget, when exhausted, leaves events needing analysis."
      />
      {rows.map((row) => (
        <p key={`${row.provider}-${row.model}-${row.createdAt}`}>
          {row.provider} {row.model} · {row.promptTokens ?? 0} tokens · {row.latencyMs ?? 0} ms
        </p>
      ))}
      {hasMore && rows.length < CLIENT_LIST_CAP ? (
        <Button
          onClick={async () => {
            const last = rows.at(-1);
            if (!last) {
              return;
            }
            const body = await api<{ usage: typeof rows }>(
              `/api/v1/ai-usage?limit=50&before=${encodeURIComponent(last.createdAt)}`,
            );
            setRows((current) => takeBoundedClient(current, body.usage));
            setHasMore(body.usage.length === 50);
          }}
        >
          Load older
        </Button>
      ) : null}
    </>
  );
}
export { UsagePage };
