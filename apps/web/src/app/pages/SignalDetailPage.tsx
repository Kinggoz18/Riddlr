import { Card, EmptyState, PageHeader, StatusBadge } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api.js";
import { ExternalLink } from "../Brand.js";
import { catalystKindLabel, typedSignalLabel } from "../format.js";

function SignalDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState<{
    signal: {
      headline: string;
      whyItMatters: string;
      proof: { summary: string; evidenceIds: string[]; claimIds?: string[] };
      action: string;
      risk: string;
      confidence: string;
      marketContext?: string;
      contradictoryEvidence?: string;
      invalidationConditions?: string;
      epistemicStatus?: string;
      outputKind?: string;
      notifyKind?: string;
      catalystKind?: string | null;
      typedSignal?: string | null;
      anticipated?: boolean;
    };
    evidence: Array<{ id: string; title?: string; canonicalUrl?: string; bodyText?: string }>;
    proofLinks?: Array<{
      claimId: string;
      evidenceId: string;
      excerpt?: string | null;
      stance?: string;
      title?: string;
    }>;
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
        description={
          s.typedSignal === "perp_stress"
            ? "Market observation with proof. Perp stress is not a fundamental signal and not a trade."
            : "Typed output with proof evidence IDs on the event. A signal is not a candidate and not a trade."
        }
      />
      <p className="record-meta">
        <StatusBadge label={s.risk} tone="risk" />
        <span>Confidence {s.confidence}</span>
        {s.typedSignal ? <span>{typedSignalLabel(s.typedSignal, s.anticipated)}</span> : null}
        {s.catalystKind && !s.typedSignal ? <span>{catalystKindLabel(s.catalystKind)}</span> : null}
        <span>
          {s.outputKind === "unverified_early_warning" || s.notifyKind === "early_warning"
            ? "Unverified early warning"
            : s.epistemicStatus === "signal" || !s.epistemicStatus
              ? "Signal"
              : s.epistemicStatus}
        </span>
      </p>
      {s.outputKind === "unverified_early_warning" ? (
        <p className="field-note">
          Unverified early warning. Independent corroboration is absent. This is not confirmed.
        </p>
      ) : null}
      {s.typedSignal === "perp_stress" ? (
        <p className="field-note">
          Perp stress is a market observation. It is never a fundamental signal.
        </p>
      ) : null}
      {s.anticipated ? (
        <p className="field-note">Anticipated. Scheduled; not an early warning.</p>
      ) : null}
      <div className="proof-stack">
        <Card>
          <h2>Why it matters</h2>
          <p>{s.whyItMatters}</p>
        </Card>
        <Card>
          <h2>Proof</h2>
          <p>{s.proof.summary}</p>
          {s.proof.claimIds && s.proof.claimIds.length > 0 ? (
            <p className="field-note">Claim proof: {s.proof.claimIds.join(", ")}</p>
          ) : null}
          {data.proofLinks && data.proofLinks.length > 0 ? (
            <ul className="data-list">
              {data.proofLinks.map((item) => (
                <li key={`${item.claimId}-${item.evidenceId}`}>
                  <span>{item.title ?? item.claimId}</span>
                  <small>
                    {item.stance ?? "supports"}
                    {item.excerpt ? ` · “${item.excerpt}”` : ""}
                  </small>
                </li>
              ))}
            </ul>
          ) : null}
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
