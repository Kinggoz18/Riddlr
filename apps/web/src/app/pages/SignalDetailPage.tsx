import { Card, EmptyState } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api.js";

function SignalDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState<{
    signal: {
      headline: string;
      whyItMatters: string;
      proof: { summary: string; evidenceIds: string[] };
      action: string;
      risk: string;
      confidence: string;
      marketContext?: string;
      contradictoryEvidence?: string;
      invalidationConditions?: string;
    };
    evidence: Array<{ id: string; title?: string; canonicalUrl?: string; bodyText?: string }>;
  }>();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!id) {
      return;
    }
    void api<NonNullable<typeof data>>(`/api/v1/signals/${id}`)
      .then(setData)
      .catch(() => setMissing(true));
  }, [id]);
  if (missing) {
    return <EmptyState title="Signal not found" body="This signal does not exist." />;
  }
  if (!data) {
    return <p>Loading signal…</p>;
  }
  const s = data.signal;
  return (
    <>
      <h1>{s.headline}</h1>
      <Card>
        <h2>Why it matters</h2>
        <p>{s.whyItMatters}</p>
        <h2>Proof</h2>
        <p>{s.proof.summary}</p>
        <ul>
          {data.evidence.map((item) => (
            <li key={item.id}>
              <a href={item.canonicalUrl}>{item.title ?? item.id}</a>
              <p>{item.bodyText}</p>
            </li>
          ))}
        </ul>
        <h2>Market context</h2>
        <p>{s.marketContext}</p>
        <h2>Contradictory evidence</h2>
        <p>{s.contradictoryEvidence}</p>
        <h2>Action</h2>
        <p>{s.action}</p>
        <h2>Risk / confidence</h2>
        <p>
          {s.risk} · {s.confidence}
        </p>
        <h2>Invalidation</h2>
        <p>{s.invalidationConditions}</p>
      </Card>
    </>
  );
}
export { SignalDetailPage };
