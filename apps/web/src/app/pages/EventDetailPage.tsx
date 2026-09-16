import { aggregateIndependenceByOrigin, aggregateTrustByOrigin } from "@riddlr/domain/web";
import { Card, EmptyState, PageHeader, StatusBadge } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { api } from "../api.js";
import { ExternalLink } from "../Brand.js";
import {
  candidateKindLabel,
  catalystKindLabel,
  dateTime,
  epistemicStatusLabel,
  eventStatusLabel,
  independenceCopy,
  leadTimeLabel,
  lifecycleStatusLabel,
  materialityReasonLabel,
  reliabilityStatusLabel,
} from "../format.js";
import { assetPagePath } from "../morning.js";

function observationValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return String(value);
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "observation";
    }
  }
  return "—";
}

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
      catalystKind?: string | null;
      discoveryReason?: string | null;
      reliabilityStatus?: string | null;
      impactLevel?: string | null;
      contentCompleteness?: string | null;
      lifecycleState?: string | null;
      firstObservedAt?: string | null;
      firstPrimaryAt?: string | null;
      firstNotifiedAt?: string | null;
      leadTimeHours?: number | null;
      scheduledAt?: string | null;
    };
    evidence: Array<{
      id: string;
      title?: string;
      canonicalUrl?: string;
      bodyText?: string;
      contentCompleteness?: string;
    }>;
    roles: Array<{ evidenceId: string; role: string }>;
    observations?: Array<{
      kind: string;
      value: unknown;
      sourceId: string;
      unit?: string | null;
      assetCanonicalId?: string | null;
      observedAt?: string;
    }>;
    assets?: Array<{ canonicalId: string; symbol?: string | null; name?: string | null }>;
    independence?: { nodes: Array<{ evidenceId: string; hostname: string; role: string }> };
    claims?: Array<{
      claimId: string;
      title: string;
      kind: string;
      catalystKind?: string | null;
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
    lifecycle?: Array<{
      id: string;
      fromState?: string | null;
      toState: string;
      reason?: string | null;
      at: string;
    }>;
    outcomes?: Array<{
      horizon: string;
      metric: string;
      baselineValue: number;
      observedValue: number;
      deltaAbs: number;
      deltaPct?: number | null;
      observedAt: string;
    }>;
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
        {data.event.catalystKind ? <span>{catalystKindLabel(data.event.catalystKind)}</span> : null}
        {data.event.epistemicStatus ? (
          <span>{epistemicStatusLabel(data.event.epistemicStatus)}</span>
        ) : null}
        {data.event.reliabilityStatus ? (
          <span>{reliabilityStatusLabel(data.event.reliabilityStatus)}</span>
        ) : null}
        {data.event.lifecycleState ? (
          <span>{lifecycleStatusLabel(data.event.lifecycleState)}</span>
        ) : null}
        {leadTimeLabel(data.event.leadTimeHours) ? (
          <span>{leadTimeLabel(data.event.leadTimeHours)}</span>
        ) : null}
        {data.event.impactLevel ? <span>Impact {data.event.impactLevel}</span> : null}
        {data.event.contentCompleteness ? (
          <span>{data.event.contentCompleteness.replaceAll("_", " ")}</span>
        ) : null}
        {data.event.materialityReason ? (
          <span>{materialityReasonLabel(data.event.materialityReason)}</span>
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
      {data.lifecycle && data.lifecycle.length > 0 ? (
        <Card>
          <h2>Lifecycle</h2>
          <ol className="lifecycle-timeline">
            {[...data.lifecycle].reverse().map((item) => (
              <li key={item.id}>
                <span>
                  {item.fromState ? `${lifecycleStatusLabel(item.fromState)} → ` : ""}
                  {lifecycleStatusLabel(item.toState)}
                </span>
                <small>
                  {dateTime.format(new Date(item.at))}
                  {item.reason ? ` · ${item.reason.replaceAll("_", " ")}` : ""}
                </small>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
      {data.independence && data.independence.nodes.length > 0 ? (
        <Card>
          <h2>Independence</h2>
          <ul className="independence-graph">
            {aggregateIndependenceByOrigin(data.independence.nodes).map((node) => (
              <li key={node.hostname}>
                <span>{node.hostname}</span>
                <small>
                  {node.roles.join(", ")}
                  {node.count > 1 ? ` · ${node.count}` : ""}
                </small>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {data.event.firstObservedAt || data.event.firstPrimaryAt || data.event.firstNotifiedAt ? (
        <p className="field-note">
          First observed{" "}
          {data.event.firstObservedAt
            ? dateTime.format(new Date(data.event.firstObservedAt))
            : "unknown"}
          {data.event.firstPrimaryAt
            ? ` · first official ${dateTime.format(new Date(data.event.firstPrimaryAt))}`
            : ""}
          {data.event.firstNotifiedAt
            ? ` · first notified ${dateTime.format(new Date(data.event.firstNotifiedAt))}`
            : ""}
          {data.event.scheduledAt
            ? ` · scheduled ${dateTime.format(new Date(data.event.scheduledAt))}`
            : ""}
        </p>
      ) : null}
      {data.outcomes && data.outcomes.length > 0 ? (
        <Card>
          <h2>Outcomes</h2>
          <ul className="data-list">
            {data.outcomes.map((item) => (
              <li key={`${item.horizon}-${item.metric}`}>
                <span>
                  {item.horizon} {item.metric.replaceAll("_", " ")}
                </span>
                <small>
                  {item.deltaPct === null || item.deltaPct === undefined
                    ? `${item.deltaAbs} absolute`
                    : `${item.deltaPct.toFixed(2)}%`}{" "}
                  · {dateTime.format(new Date(item.observedAt))}
                </small>
              </li>
            ))}
          </ul>
        </Card>
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
            {aggregateTrustByOrigin(data.trustSnapshot).map((item) => (
              <li key={item.key}>
                <span>{item.label}</span>
                <small>
                  {item.trustTier.replaceAll("_", " ")}
                  {item.count > 1 ? ` · ${item.count}` : ""}
                </small>
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
                  {item.catalystKind
                    ? catalystKindLabel(item.catalystKind)
                    : item.kind.replaceAll("_", " ").replaceAll(":", " ")}{" "}
                  · {item.stance}
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
            {data.assets.map((item, index) => (
              <span key={item.canonicalId}>
                {index > 0 ? ", " : ""}
                <NavLink to={assetPagePath(item.canonicalId)}>
                  {item.name || item.symbol || item.canonicalId}
                </NavLink>
              </span>
            ))}
          </p>
        </Card>
      ) : null}
      {data.observations && data.observations.length > 0 ? (
        <Card>
          <h2>Sourced observations</h2>
          <ul className="data-list">
            {data.observations.map((item) => (
              <li key={`${item.kind}-${item.sourceId}-${item.observedAt ?? ""}`}>
                <span>
                  {item.kind.replaceAll("_", " ")}
                  {item.assetCanonicalId ? ` · ${item.assetCanonicalId}` : ""}:{" "}
                  {observationValue(item.value)}
                  {item.unit ? ` ${item.unit}` : ""}
                </span>
                <small>
                  {item.sourceId}
                  {item.observedAt ? ` · ${dateTime.format(new Date(item.observedAt))}` : ""}
                </small>
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
                {item.bodyText ? (
                  <small>{item.bodyText.replace(/\s+/g, " ").trim().slice(0, 220)}</small>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
export { EventDetailPage };
