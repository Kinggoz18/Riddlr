import { Card, EmptyState, PageHeader, StatusBadge } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api.js";
import { ExternalLink } from "../Brand.js";

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
      epistemicStatus?: string;
    };
    evidence: Array<{ id: string; title?: string; canonicalUrl?: string; bodyText?: string }>;
    skillTrace?: {
      selected?: Array<{ slug: string; displayName: string; reason: string }>;
      skipped?: Array<{ slug: string; displayName: string; reason: string; notice?: string }>;
    };
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
      <PageHeader
        title={s.headline}
        description="Validated output with proof evidence IDs on the event. A signal is not a candidate and not a trade."
      />
      <p className="record-meta">
        <StatusBadge label={s.risk} tone="risk" />
        <span>Confidence {s.confidence}</span>
        <span>
          {s.epistemicStatus === "signal" || !s.epistemicStatus ? "Signal" : s.epistemicStatus}
        </span>
      </p>
      <div className="proof-stack">
        <Card>
          <h2>Why it matters</h2>
          <p>{s.whyItMatters}</p>
        </Card>
        <Card>
          <h2>Proof</h2>
          <p>{s.proof.summary}</p>
          <ul className="data-list">
            {data.evidence.map((item) => (
              <li key={item.id}>
                <span>
                  {item.canonicalUrl ? (
                    <ExternalLink href={item.canonicalUrl}>{item.title ?? item.id}</ExternalLink>
                  ) : (
                    (item.title ?? item.id)
                  )}
                  {item.bodyText ? <small>{item.bodyText}</small> : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2>Market context</h2>
          <p>{s.marketContext || "None supplied."}</p>
        </Card>
        <Card>
          <h2>Contradictory evidence</h2>
          <p>{s.contradictoryEvidence || "None supplied."}</p>
        </Card>
        <Card>
          <h2>Action</h2>
          <p>{s.action}</p>
        </Card>
        <Card>
          <h2>Invalidation</h2>
          <p>{s.invalidationConditions || "None supplied."}</p>
        </Card>
        {data.skillTrace ? (
          <Card>
            <h2>Analysis dimensions</h2>
            <ul className="analysis-dimensions">
              {(data.skillTrace.selected ?? []).map((item) => (
                <li key={item.slug} className="analysis-dimension-on">
                  <span>{item.displayName}</span>
                  <small>Applied</small>
                </li>
              ))}
              {(data.skillTrace.skipped ?? []).map((item) => (
                <li key={item.slug} className="analysis-dimension-off">
                  <span>{item.displayName}</span>
                  <small>{item.notice ?? item.reason.replaceAll("_", " ")}</small>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
export { SignalDetailPage };
