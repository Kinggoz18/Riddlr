import { Card, EmptyState, PageHeader, StatusBadge } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api.js";
import { ExternalLink } from "../Brand.js";
import {
  candidateKindLabel,
  epistemicStatusLabel,
  eventStatusLabel,
  independenceCopy,
  reliabilityStatusLabel,
} from "../format.js";

function EventDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState<{
    event?: {
      title: string;
      status: string;
      independentCount: number;
      derivedCount: number;
      materialityReason?: string | null;
      epistemicStatus?: string | null;
      candidateKind?: string | null;
      discoveryReason?: string | null;
      reliabilityStatus?: string | null;
      impactLevel?: string | null;
      contentCompleteness?: string | null;
    };
    evidence: Array<{
      id: string;
      title?: string;
      canonicalUrl?: string;
      bodyText?: string;
      contentCompleteness?: string;
    }>;
    roles: Array<{ evidenceId: string; role: string }>;
    observations?: Array<{ kind: string; value: unknown; sourceId: string }>;
    assets?: Array<{ canonicalId: string; symbol?: string | null; name?: string | null }>;
    independence?: { nodes: Array<{ evidenceId: string; hostname: string; role: string }> };
    claims?: Array<{
      claimId: string;
      title: string;
      kind: string;
      stance: string;
      excerpt?: string | null;
      evidenceId?: string | null;
    }>;
    assessment?: { reliabilityStatus: string; impactLevel: string; independentOriginCount: number };
    assessments?: Array<{
      revision: number;
      reliabilityStatus: string;
      impactLevel: string;
      independentOriginCount: number;
      reasons?: Array<{ code: string; detail?: string | null }>;
    }>;
    trustSnapshot?: Array<{
      evidenceId: string;
      displayName?: string | null;
      hostname?: string | null;
      trustTier: string;
      originKey?: string | null;
    }>;
    documents?: Array<{ evidenceId: string; cleanedText?: string; status: string }>;
    skillTrace?: {
      selected?: Array<{ slug: string; displayName: string; reason: string }>;
      skipped?: Array<{ slug: string; displayName: string; reason: string; notice?: string }>;
      llmCalls?: number;
      estimatedPromptTokens?: number;
    };
  }>();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!id) {
      return;
    }
    void api<NonNullable<typeof data>>(`/api/v1/events/${id}`)
      .then(setData)
      .catch(() => setMissing(true));
  }, [id]);
  if (missing) {
    return <EmptyState title="Event not found" body="This event does not exist." />;
  }
  if (!data?.event) {
    return <p>Loading event…</p>;
  }
  return (
    <>
      <PageHeader
        title={data.event.title}
        description="Evidence clustered for one possible happening. Independent origins are not reprints. A candidate is not a recommendation to buy, sell, or trade."
      />
      <p className="record-meta">
        <StatusBadge label={eventStatusLabel(data.event.status)} />
        <span>{independenceCopy(data.event.independentCount, data.event.derivedCount)}</span>
        {data.event.candidateKind ? (
          <span>{candidateKindLabel(data.event.candidateKind)}</span>
        ) : null}
        {data.event.epistemicStatus ? (
          <span>{epistemicStatusLabel(data.event.epistemicStatus)}</span>
        ) : null}
        {data.event.reliabilityStatus ? (
          <span>{reliabilityStatusLabel(data.event.reliabilityStatus)}</span>
        ) : null}
        {data.event.impactLevel ? <span>Impact {data.event.impactLevel}</span> : null}
        {data.event.contentCompleteness ? (
          <span>{data.event.contentCompleteness.replaceAll("_", " ")}</span>
        ) : null}
      </p>
      {data.event.status === "candidate" ? (
        <p className="field-note">
          This cluster is a discovery candidate. It may warrant further investigation. It is not a
          recommendation to buy, sell, or trade. Analysis runs when the cluster is material.
        </p>
      ) : null}
      {data.event.discoveryReason ? (
        <p className="field-note">{data.event.discoveryReason}</p>
      ) : null}
      {data.assessment ? (
        <p className="field-note">
          Reliability {reliabilityStatusLabel(data.assessment.reliabilityStatus)} · Impact{" "}
          {data.assessment.impactLevel} · {data.assessment.independentOriginCount} independent
          origins
        </p>
      ) : null}
      {data.assessments && data.assessments.length > 0 ? (
        <Card>
          <h2>Assessment history</h2>
          <ul className="data-list">
            {data.assessments.map((item) => (
              <li key={item.revision}>
                <span>
                  Revision {item.revision}: {reliabilityStatusLabel(item.reliabilityStatus)} ·
                  Impact {item.impactLevel}
                </span>
                <small>
                  {item.independentOriginCount} independent origins
                  {item.reasons && item.reasons.length > 0
                    ? ` · ${item.reasons.map((reason) => reason.detail || reason.code).join("; ")}`
                    : ""}
                </small>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {data.trustSnapshot && data.trustSnapshot.length > 0 ? (
        <Card>
          <h2>Source trust</h2>
          <ul className="data-list">
            {data.trustSnapshot.map((item) => (
              <li key={item.evidenceId}>
                <span>
                  {item.displayName ||
                    item.originKey ||
                    item.hostname ||
                    data.independence?.nodes.find((node) => node.evidenceId === item.evidenceId)
                      ?.hostname ||
                    "Unknown source"}
                </span>
                <small>{item.trustTier.replaceAll("_", " ")}</small>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {data.claims && data.claims.length > 0 ? (
        <Card>
          <h2>Claims</h2>
          <ul className="data-list">
            {[...new Map(data.claims.map((item) => [item.claimId, item])).values()].map((item) => (
              <li key={item.claimId}>
                <span>{item.title}</span>
                <small>
                  {item.kind} · {item.stance}
                  {item.excerpt ? ` · “${item.excerpt}”` : ""}
                </small>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {data.documents && data.documents.length > 0 ? (
        <Card>
          <h2>Cleaned content</h2>
          <ul className="data-list">
            {data.documents.map((item) => (
              <li key={item.evidenceId}>
                <span>{item.cleanedText?.slice(0, 280) || item.status}</span>
                <small>{item.status}</small>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {data.assets && data.assets.length > 0 ? (
        <Card>
          <h2>Assets</h2>
          <p>
            {data.assets.map((item) => item.name || item.symbol || item.canonicalId).join(", ")}
          </p>
        </Card>
      ) : null}
      {data.observations && data.observations.length > 0 ? (
        <Card>
          <h2>Sourced observations</h2>
          <ul className="data-list">
            {data.observations.map((item) => (
              <li key={`${item.kind}-${item.sourceId}`}>
                <span>
                  {item.kind}: {String(item.value)}
                </span>
                <small>{item.sourceId}</small>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
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
          {typeof data.skillTrace.llmCalls === "number" ? (
            <p className="record-meta">
              <span>
                {data.skillTrace.llmCalls} LLM call
                {data.skillTrace.llmCalls === 1 ? "" : "s"}
              </span>
              {data.skillTrace.estimatedPromptTokens ? (
                <span>~{data.skillTrace.estimatedPromptTokens} prompt tokens</span>
              ) : null}
            </p>
          ) : null}
        </Card>
      ) : null}
      <Card>
        <h2>Evidence</h2>
        <ul className="data-list">
          {data.evidence.map((item) => (
            <li key={item.id}>
              <span>
                {item.canonicalUrl && /^https?:\/\//i.test(item.canonicalUrl) ? (
                  <ExternalLink href={item.canonicalUrl}>{item.title ?? item.id}</ExternalLink>
                ) : (
                  (item.title ?? item.id)
                )}
                <small>
                  {data.roles.find((role) => role.evidenceId === item.id)?.role ?? "primary"}
                  {data.independence?.nodes.find((node) => node.evidenceId === item.id)
                    ? ` · ${data.independence.nodes.find((node) => node.evidenceId === item.id)?.hostname}`
                    : ""}
                  {item.contentCompleteness
                    ? ` · ${item.contentCompleteness.replaceAll("_", " ")}`
                    : ""}
                </small>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
export { EventDetailPage };
