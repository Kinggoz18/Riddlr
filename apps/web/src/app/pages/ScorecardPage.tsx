import { Card, EmptyState, PageHeader, Skeleton } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { catalystKindLabel } from "../format.js";

type ScorecardRow = {
  agentId: string;
  catalystKind: string;
  sourceIdentityId: string | null;
  signalsEmitted: number;
  laterConfirmed: number;
  laterRetracted: number;
  precision?: number;
  medianLeadTimeHours?: number;
  medianMove24hPct?: number;
};

function ScorecardPage() {
  const [rows, setRows] = useState<ScorecardRow[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    void api<{ scorecard: ScorecardRow[] }>("/api/v1/scorecard")
      .then((body) => setRows(body.scorecard))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"));
  }, []);
  if (error) {
    return <EmptyState title="Unable to load scorecard" body={error} />;
  }
  if (!rows) {
    return <Skeleton label="Loading scorecard…" />;
  }
  return (
    <>
      <PageHeader
        title="Scorecard"
        description="Signals emitted, later confirmed or retracted, median lead time, and median +24h spot move. Outcomes are measurements, not trading advice."
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No scored signals"
          body="A row appears after a signal is persisted. Precision is later confirmed divided by signals emitted."
        />
      ) : (
        <Card>
          <ul className="data-list">
            {rows.map((row) => (
              <li key={`${row.agentId}-${row.catalystKind}-${row.sourceIdentityId ?? "none"}`}>
                <span>
                  {catalystKindLabel(row.catalystKind)}
                  {row.sourceIdentityId ? ` · ${row.sourceIdentityId.slice(0, 8)}` : ""}
                </span>
                <small>
                  {row.signalsEmitted} emitted · {row.laterConfirmed} confirmed ·{" "}
                  {row.laterRetracted} retracted
                  {row.precision === undefined
                    ? ""
                    : ` · precision ${(row.precision * 100).toFixed(0)}%`}
                  {row.medianLeadTimeHours === undefined
                    ? ""
                    : ` · median lead ${row.medianLeadTimeHours}h`}
                  {row.medianMove24hPct === undefined
                    ? ""
                    : ` · median +24h ${row.medianMove24hPct.toFixed(2)}%`}
                </small>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

export { ScorecardPage };
