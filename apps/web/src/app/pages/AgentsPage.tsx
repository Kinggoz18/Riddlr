import { Button, Card, EmptyState, Field, PageHeader, StatusBadge } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { AssetPicker } from "../AssetPicker.js";
import { api } from "../api.js";
import { ChipList } from "../ChipInput.js";
import {
  assetLabel,
  DEFAULT_DAILY_TOKEN_BUDGET,
  MAX_DAILY_TOKEN_BUDGET,
  MIN_DAILY_TOKEN_BUDGET,
  OBJECTIVE_OPTIONS,
  objectiveLabel,
  scheduleLabel,
  tokenBudgetLabel,
} from "../format.js";
import { PageSubnav } from "../PageSubnav.js";
import { toastFail, useToast } from "../Toast.js";
import { WatchlistAssets } from "../WatchlistAssets.js";
import { summarizeWatchlistLabels, WATCHLIST_PREVIEW_LIMIT } from "../watchlist-view.js";

const SCHEDULES = ["30m", "1h", "2h", "4h", "6h", "12h", "daily"] as const;

export type Skill = {
  id: string;
  slug: string;
  origin: string;
  markdownBody?: string;
  displayName?: string;
  description?: string;
};
export type Source = { id: string; name: string; adapterId?: string };
export type Agent = {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  description?: string;
  schedule: string;
  tokenBudget: number | null;
  default: boolean;
  objectives?: string[];
  domains: string[];
  skills: Array<{
    id: string;
    slug: string;
    origin: string;
    displayName?: string;
    description?: string;
  }>;
  sourceIds?: string[];
  sources?: Source[];
  watchlist: {
    id: string;
    name: string;
    items: Array<{
      id: string;
      canonicalId: string;
      assetClass: string;
      symbol?: string | null;
      name?: string | null;
    }>;
  } | null;
};

function toggle(list: string[], id: string, checked: boolean) {
  return checked ? [...list, id] : list.filter((item) => item !== id);
}

function AgentSubnav() {
  return (
    <PageSubnav
      label="Agents"
      items={[
        { to: "/agents", label: "View agents", end: true },
        { to: "/agents/new", label: "Create agent" },
      ]}
    />
  );
}

function AgentsList() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const toast = useToast();

  useEffect(() => {
    void api<{ agents: Agent[] }>("/api/v1/agents")
      .then((body) => setAgents(body.agents))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p>Loading agents…</p>;
  }
  if (error) {
    return <EmptyState title="Unable to load agents" body={error} />;
  }
  return (
    <>
      <PageHeader
        title="Agents"
        description="Watchers with a schedule, token budget, markdown skills, and a watchlist. Skills are policy text. They cannot grant tools or filesystem access."
        actions={<AgentSubnav />}
      />
      {agents.length === 0 ? (
        <EmptyState
          title="No agents"
          body="Finish first-run setup to create the default Crypto agent, then add more here."
          action={
            <NavLink to="/agents/new" className="ui-button ui-button-primary">
              Create agent
            </NavLink>
          }
        />
      ) : (
        <section className="record-list">
          {agents.map((agent) => (
            <Card key={agent.id} className="record-row">
              <NavLink to={`/agents/${agent.id}`}>{agent.name}</NavLink>
              <StatusBadge label={agent.enabled ? "Enabled" : "Paused"} />
              {agent.default ? <StatusBadge label="Default" /> : null}
              {agent.description ? <p className="record-copy">{agent.description}</p> : null}
              <p className="record-meta">
                <span>Domains: {agent.domains.join(", ") || "none"}</span>
                <span>{scheduleLabel(agent.schedule)}</span>
                <span>
                  {summarizeWatchlistLabels(
                    (agent.watchlist?.items ?? []).map((item) => assetLabel(item.canonicalId)),
                  )}
                </span>
              </p>
              <p className="agent-toolbar">
                <Button
                  onClick={async () => {
                    const result = await api<{ duplicate?: boolean }>(
                      `/api/v1/agents/${agent.id}/scan`,
                      { method: "POST" },
                    );
                    toast(result.duplicate ? "Scan already running" : "Scan queued");
                  }}
                >
                  Run scan
                </Button>
                <NavLink to={`/agents/${agent.id}`} className="ui-button ui-button-ghost">
                  View
                </NavLink>
              </p>
            </Card>
          ))}
        </section>
      )}
    </>
  );
}

function AgentForm(props: {
  title: string;
  submitLabel: string;
  agent?: Agent;
  catalog: Skill[];
  sourceCatalog: Source[];
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState(props.agent?.name ?? "");
  const [description, setDescription] = useState(props.agent?.description ?? "");
  const [schedule, setSchedule] = useState(props.agent?.schedule ?? "1h");
  const [tokenBudgetUnlimited, setTokenBudgetUnlimited] = useState(
    props.agent ? props.agent.tokenBudget === null : false,
  );
  const [tokenBudget, setTokenBudget] = useState(
    String(props.agent?.tokenBudget ?? DEFAULT_DAILY_TOKEN_BUDGET),
  );
  const [canonicalIds, setCanonicalIds] = useState(
    (props.agent?.watchlist?.items ?? []).map((item) => item.canonicalId),
  );
  const [selectedSkills, setSelectedSkills] = useState(
    props.agent?.skills.map((item) => item.id) ?? [],
  );
  const [selectedSources, setSelectedSources] = useState(
    props.agent?.sourceIds ?? props.agent?.sources?.map((item) => item.id) ?? [],
  );
  const [selectedObjectives, setSelectedObjectives] = useState(
    props.agent?.objectives ?? ["general_crypto_intelligence"],
  );
  const [enabled, setEnabled] = useState(props.agent?.enabled ?? true);

  useEffect(() => {
    if (!props.agent && selectedSources.length === 0 && props.sourceCatalog.length > 0) {
      setSelectedSources(props.sourceCatalog.map((item) => item.id));
    }
  }, [props.agent, props.sourceCatalog, selectedSources.length]);

  return (
    <>
      <PageHeader
        title={props.title}
        description="A watcher is read-only. Watchlist items are named assets, stored as canonical IDs."
        actions={<AgentSubnav />}
      />
      <Card>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              const payload = {
                name,
                description,
                marketDomainIds: ["crypto"],
                schedule,
                tokenBudget: tokenBudgetUnlimited ? null : Number(tokenBudget),
                skillIds: selectedSkills,
                sourceIds: selectedSources,
                objectives: selectedObjectives,
                enabled,
                watchlistItems: canonicalIds.map((canonicalId) => ({ canonicalId })),
              };
              if (props.agent) {
                await api(`/api/v1/agents/${props.agent.id}`, {
                  method: "PATCH",
                  body: JSON.stringify(payload),
                });
                toast("Agent saved");
                navigate(`/agents/${props.agent.id}`);
              } else {
                await api("/api/v1/agents", {
                  method: "POST",
                  body: JSON.stringify(payload),
                });
                toast("Agent created");
                navigate("/agents");
              }
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t save agent"), "danger");
            }
          }}
        >
          {props.agent?.default ? null : (
            <Field label="Agent name">
              <input
                id="agent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={3}
                required
              />
            </Field>
          )}
          <Field
            label="Description"
            hint="Shown to you on the agent list and view. Not sent to the model."
          >
            <textarea
              id="agent-description"
              rows={3}
              maxLength={280}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </Field>
          {props.agent ? (
            <label className="check-row" htmlFor="agent-enabled">
              <input
                id="agent-enabled"
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Agent enabled
            </label>
          ) : null}
          <Field label="Schedule">
            <select id="schedule" value={schedule} onChange={(e) => setSchedule(e.target.value)}>
              {SCHEDULES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>
          <label className="check-row" htmlFor="token-budget-unlimited">
            <input
              id="token-budget-unlimited"
              type="checkbox"
              checked={tokenBudgetUnlimited}
              onChange={(e) => {
                const unlimited = e.target.checked;
                setTokenBudgetUnlimited(unlimited);
                if (!unlimited && (!tokenBudget || Number(tokenBudget) < MIN_DAILY_TOKEN_BUDGET)) {
                  setTokenBudget(String(DEFAULT_DAILY_TOKEN_BUDGET));
                }
              }}
            />
            Unlimited daily token usage
          </label>
          <Field
            label="Daily token budget"
            hint={
              tokenBudgetUnlimited
                ? "No daily cap. Usage is still recorded. Prompt context stays bounded."
                : "Daily prompt plus completion tokens before analysis is skipped."
            }
          >
            <input
              id="token-budget"
              type="number"
              min={MIN_DAILY_TOKEN_BUDGET}
              max={MAX_DAILY_TOKEN_BUDGET}
              value={tokenBudget}
              onChange={(e) => setTokenBudget(e.target.value)}
              disabled={tokenBudgetUnlimited}
              required={!tokenBudgetUnlimited}
            />
          </Field>
          <Field
            label="Watchlist"
            hint="Pick named assets. Canonical IDs such as coingecko:bitcoin are stored underneath."
          >
            <AssetPicker
              id="canonical-asset-ids"
              values={canonicalIds}
              onChange={setCanonicalIds}
            />
          </Field>
          <fieldset className="check-list">
            <legend>Objectives</legend>
            {OBJECTIVE_OPTIONS.map(([id, label]) => (
              <label key={id} className="check-row" htmlFor={`objective-${id}`}>
                <input
                  id={`objective-${id}`}
                  type="checkbox"
                  checked={selectedObjectives.includes(id)}
                  onChange={(e) =>
                    setSelectedObjectives((current) => toggle(current, id, e.target.checked))
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <fieldset className="check-list">
            <legend>Sources</legend>
            {props.sourceCatalog.map((source) => (
              <label key={source.id} className="check-row" htmlFor={`source-${source.id}`}>
                <input
                  id={`source-${source.id}`}
                  type="checkbox"
                  checked={selectedSources.includes(source.id)}
                  onChange={(e) =>
                    setSelectedSources((current) => toggle(current, source.id, e.target.checked))
                  }
                />
                {source.name}
              </label>
            ))}
          </fieldset>
          <fieldset className="check-list">
            <legend>Skills</legend>
            {props.catalog.map((skill) => (
              <label key={skill.id} className="check-row" htmlFor={`skill-${skill.slug}`}>
                <input
                  id={`skill-${skill.slug}`}
                  type="checkbox"
                  checked={selectedSkills.includes(skill.id)}
                  onChange={(e) =>
                    setSelectedSkills((current) => toggle(current, skill.id, e.target.checked))
                  }
                />
                <span className="check-copy">
                  <span>
                    {skill.displayName ?? skill.slug}
                    {skill.origin === "shipped" ? " (shipped)" : ""}
                  </span>
                  {skill.description ? <small>{skill.description}</small> : null}
                </span>
              </label>
            ))}
          </fieldset>
          <p className="ui-actions">
            <Button type="submit">{props.submitLabel}</Button>
            <NavLink
              to={props.agent ? `/agents/${props.agent.id}` : "/agents"}
              className="ui-button ui-button-ghost"
            >
              Cancel
            </NavLink>
          </p>
        </form>
      </Card>
    </>
  );
}

function AgentCreate() {
  const [catalog, setCatalog] = useState<Skill[]>([]);
  const [sourceCatalog, setSourceCatalog] = useState<Source[]>([]);
  const [error, setError] = useState<string>();
  useEffect(() => {
    void Promise.all([
      api<{ skills: Skill[] }>("/api/v1/skills"),
      api<{ sources: Source[] }>("/api/v1/sources"),
    ])
      .then(([skills, sources]) => {
        setCatalog(skills.skills);
        setSourceCatalog(sources.sources);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"));
  }, []);
  if (error) {
    return <EmptyState title="Unable to load catalogs" body={error} />;
  }
  return (
    <AgentForm
      title="Create agent"
      submitLabel="Create agent"
      catalog={catalog}
      sourceCatalog={sourceCatalog}
    />
  );
}

function AgentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [agent, setAgent] = useState<Agent>();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!id) {
      return;
    }
    void api<{ agent: Agent }>(`/api/v1/agents/${id}`)
      .then((body) => setAgent(body.agent))
      .catch(() => setMissing(true));
  }, [id]);

  if (missing) {
    return <EmptyState title="Agent not found" body="This agent does not exist." />;
  }
  if (!agent) {
    return <p>Loading agent…</p>;
  }

  const agentId = agent.id;

  async function runScan() {
    const result = await api<{ duplicate?: boolean }>(`/api/v1/agents/${agentId}/scan`, {
      method: "POST",
    });
    toast(result.duplicate ? "Scan already running" : "Scan queued");
  }

  return (
    <>
      <PageHeader
        title={agent.name}
        description={
          agent.description ||
          "Read-only watcher. Edit schedule, sources, skills, and watchlist on a dedicated screen."
        }
        actions={
          <>
            <AgentSubnav />
            <Button onClick={() => void runScan()}>Run scan</Button>
            <NavLink to={`/agents/${agent.id}/edit`} className="ui-button ui-button-primary">
              Edit agent
            </NavLink>
          </>
        }
      />
      <p className="record-meta">
        {agent.default ? <StatusBadge label="Default" /> : null}
        <StatusBadge label={agent.enabled ? "Enabled" : "Paused"} />
      </p>
      <dl className="agent-facts">
        <div>
          <dt>Domain</dt>
          <dd>{agent.domains.join(", ") || "none"}</dd>
        </div>
        <div>
          <dt>Schedule</dt>
          <dd>{scheduleLabel(agent.schedule)}</dd>
        </div>
        <div>
          <dt>Daily token budget</dt>
          <dd>{tokenBudgetLabel(agent.tokenBudget)}</dd>
        </div>
        <div>
          <dt>Watchlist</dt>
          <dd>{agent.watchlist?.items.length ?? 0} assets</dd>
        </div>
      </dl>
      <section className="agent-board">
        <Card>
          <h2>Objectives</h2>
          <ChipList
            values={agent.objectives ?? []}
            format={objectiveLabel}
            empty="No objectives selected"
          />
        </Card>
        <Card>
          <div className="panel-heading">
            <h2>Watchlist</h2>
            {agent.watchlist ? (
              <NavLink to={`/watchlists/${agent.watchlist.id}`}>View all</NavLink>
            ) : (
              <NavLink to={`/agents/${agent.id}/edit`}>Edit</NavLink>
            )}
          </div>
          <WatchlistAssets
            items={agent.watchlist?.items ?? []}
            limit={WATCHLIST_PREVIEW_LIMIT}
            moreHref={agent.watchlist ? `/watchlists/${agent.watchlist.id}` : undefined}
            empty="No assets on this watcher"
          />
        </Card>
        <Card>
          <h2>Sources</h2>
          {agent.sources && agent.sources.length > 0 ? (
            <ul className="attached-list">
              {agent.sources.map((source) => (
                <li key={source.id}>
                  <NavLink to={`/sources/${source.id}`}>{source.name}</NavLink>
                </li>
              ))}
            </ul>
          ) : (
            <p className="quiet-state">No sources attached</p>
          )}
        </Card>
        <Card className="agent-board-wide">
          <h2>Skills</h2>
          {agent.skills.length > 0 ? (
            <ul className="attached-list">
              {agent.skills.map((skill) => (
                <li key={skill.id}>
                  <NavLink to={`/skills/${skill.id}`}>{skill.displayName ?? skill.slug}</NavLink>
                  {skill.description ? <small>{skill.description}</small> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="quiet-state">No skills attached</p>
          )}
        </Card>
      </section>
      <p className="agent-toolbar">
        <Button
          variant="ghost"
          onClick={async () => {
            try {
              await api(`/api/v1/agents/${agent.id}/duplicate`, { method: "POST" });
              toast("Agent duplicated");
              navigate("/agents");
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t duplicate agent"), "danger");
            }
          }}
        >
          Duplicate
        </Button>
        {agent.default ? null : (
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await api(`/api/v1/agents/${agent.id}`, { method: "DELETE" });
                toast("Agent deleted");
                navigate("/agents");
              } catch (err: unknown) {
                toast(toastFail(err, "Couldn’t delete agent"), "danger");
              }
            }}
          >
            Delete agent
          </Button>
        )}
      </p>
    </>
  );
}

function AgentEdit() {
  const { id } = useParams();
  const [agent, setAgent] = useState<Agent>();
  const [catalog, setCatalog] = useState<Skill[]>([]);
  const [sourceCatalog, setSourceCatalog] = useState<Source[]>([]);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!id) {
      return;
    }
    void Promise.all([
      api<{ agent: Agent }>(`/api/v1/agents/${id}`),
      api<{ skills: Skill[] }>("/api/v1/skills"),
      api<{ sources: Source[] }>("/api/v1/sources"),
    ])
      .then(([agentBody, skills, sources]) => {
        setAgent(agentBody.agent);
        setCatalog(skills.skills);
        setSourceCatalog(sources.sources);
      })
      .catch(() => setMissing(true));
  }, [id]);
  if (missing) {
    return <EmptyState title="Agent not found" body="This agent does not exist." />;
  }
  if (!agent) {
    return <p>Loading agent…</p>;
  }
  return (
    <AgentForm
      title={`Edit ${agent.name}`}
      submitLabel="Save agent"
      agent={agent}
      catalog={catalog}
      sourceCatalog={sourceCatalog}
    />
  );
}

function AgentsPage() {
  return (
    <Routes>
      <Route index element={<AgentsList />} />
      <Route path="new" element={<AgentCreate />} />
      <Route path=":id" element={<AgentDetail />} />
      <Route path=":id/edit" element={<AgentEdit />} />
    </Routes>
  );
}

export { AgentsPage };
