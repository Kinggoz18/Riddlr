import { Button, Card, EmptyState, Field } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { api } from "../api.js";

function AgentsPage() {
  type Skill = { id: string; slug: string; origin: string; markdownBody?: string };
  type Agent = {
    id: string;
    name: string;
    kind: string;
    enabled: boolean;
    schedule: string;
    tokenBudget: number;
    default: boolean;
    domains: string[];
    skills: Array<{ id: string; slug: string; origin: string }>;
    watchlist: {
      id: string;
      name: string;
      items: Array<{ id: string; canonicalId: string; assetClass: string }>;
    } | null;
  };
  const [agents, setAgents] = useState<Agent[]>([]);
  const [catalog, setCatalog] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("1h");
  const [tokenBudget, setTokenBudget] = useState("8000");
  const [canonicalIds, setCanonicalIds] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [skillSlug, setSkillSlug] = useState("");
  const [skillMarkdown, setSkillMarkdown] = useState("");
  const [drafts, setDrafts] = useState<
    Record<
      string,
      { schedule: string; tokenBudget: string; canonicalIds: string; skillIds: string[] }
    >
  >({});

  async function reload() {
    const [agentBody, skillBody] = await Promise.all([
      api<{ agents: Agent[] }>("/api/v1/agents"),
      api<{ skills: Skill[] }>("/api/v1/skills"),
    ]);
    setAgents(agentBody.agents);
    setCatalog(skillBody.skills);
    setDrafts((current) => {
      const next = { ...current };
      for (const agent of agentBody.agents) {
        if (!next[agent.id]) {
          next[agent.id] = {
            schedule: agent.schedule,
            tokenBudget: String(agent.tokenBudget),
            canonicalIds: (agent.watchlist?.items ?? []).map((item) => item.canonicalId).join("\n"),
            skillIds: agent.skills.map((skill) => skill.id),
          };
        }
      }
      return next;
    });
  }

  useEffect(() => {
    void reload()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);

  function parseCanonicalIds(value: string) {
    return value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((canonicalId) => ({ canonicalId }));
  }

  if (loading) {
    return <p>Loading agents…</p>;
  }
  if (error) {
    return <EmptyState title="Unable to load agents" body={error} />;
  }
  return (
    <>
      <h1>Agents</h1>
      <p style={{ color: "var(--muted)" }}>
        Crypto is the only executable domain. Equities, Forex, Commodities, and Macro cannot start
        scans.
      </p>
      {message ? <p>{message}</p> : null}
      <Card>
        <h2>Create agent</h2>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              const result = await api<{ agents: Agent[] }>("/api/v1/agents", {
                method: "POST",
                body: JSON.stringify({
                  name,
                  marketDomainIds: ["crypto"],
                  schedule,
                  tokenBudget: Number(tokenBudget),
                  skillIds: selectedSkills,
                  watchlistItems: parseCanonicalIds(canonicalIds),
                }),
              });
              setAgents(result.agents);
              setName("");
              setCanonicalIds("");
              setSelectedSkills([]);
              setMessage("Agent created.");
            } catch (err: unknown) {
              setMessage(err instanceof Error ? err.message : "Create failed");
            }
          }}
        >
          <Field label="Agent name">
            <input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={3}
              required
            />
          </Field>
          <Field label="Schedule">
            <select id="schedule" value={schedule} onChange={(e) => setSchedule(e.target.value)}>
              {["30m", "1h", "2h", "4h", "6h", "12h", "daily"].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Token budget"
            hint="Daily prompt plus completion tokens before analysis is skipped."
          >
            <input
              id="token-budget"
              type="number"
              min={500}
              max={200000}
              value={tokenBudget}
              onChange={(e) => setTokenBudget(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Canonical asset ids"
            hint="One per line, such as coingecko:bitcoin. Bare tickers are rejected."
          >
            <textarea
              id="canonical-asset-ids"
              rows={3}
              value={canonicalIds}
              onChange={(e) => setCanonicalIds(e.target.value)}
            />
          </Field>
          <fieldset>
            <legend>Skills</legend>
            {catalog.map((skill) => (
              <label key={skill.id} htmlFor={`create-skill-${skill.slug}`}>
                <input
                  id={`create-skill-${skill.slug}`}
                  type="checkbox"
                  checked={selectedSkills.includes(skill.id)}
                  onChange={(e) =>
                    setSelectedSkills((current) =>
                      e.target.checked
                        ? [...current, skill.id]
                        : current.filter((item) => item !== skill.id),
                    )
                  }
                />{" "}
                {skill.slug} {skill.origin === "shipped" ? "(shipped)" : ""}
              </label>
            ))}
          </fieldset>
          <p>
            <Button type="submit">Create agent</Button>
          </p>
        </form>
      </Card>
      <Card>
        <h2>New skill</h2>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/skills", {
                method: "POST",
                body: JSON.stringify({ slug: skillSlug, markdownBody: skillMarkdown }),
              });
              setSkillSlug("");
              setSkillMarkdown("");
              setMessage("Skill saved.");
              await reload();
            } catch (err: unknown) {
              setMessage(err instanceof Error ? err.message : "Skill failed");
            }
          }}
        >
          <Field label="Skill slug">
            <input
              id="skill-slug"
              value={skillSlug}
              onChange={(e) => setSkillSlug(e.target.value)}
              required
            />
          </Field>
          <Field label="Skill markdown" hint="Cannot grant tools, filesystem, or secrets.">
            <textarea
              id="skill-markdown"
              rows={4}
              value={skillMarkdown}
              onChange={(e) => setSkillMarkdown(e.target.value)}
              required
            />
          </Field>
          <p>
            <Button type="submit">Save skill</Button>
          </p>
        </form>
      </Card>
      {agents.map((agent) => {
        const draft = drafts[agent.id] ?? {
          schedule: agent.schedule,
          tokenBudget: String(agent.tokenBudget),
          canonicalIds: (agent.watchlist?.items ?? []).map((item) => item.canonicalId).join("\n"),
          skillIds: agent.skills.map((skill) => skill.id),
        };
        return (
          <Card key={agent.id}>
            <h2>{agent.name}</h2>
            {agent.default ? <p className="badge">Default</p> : null}
            <p>Domains: {agent.domains.join(", ")}</p>
            <p>
              Schedule {agent.schedule} · Budget {agent.tokenBudget}
            </p>
            <p>Skills: {agent.skills.map((skill) => skill.slug).join(", ") || "none"}</p>
            <p>
              Watchlist:{" "}
              {agent.watchlist?.items.map((item) => item.canonicalId).join(", ") || "none"}
            </p>
            <Button
              onClick={async () => {
                const result = await api<{ duplicate?: boolean }>(
                  `/api/v1/agents/${agent.id}/scan`,
                  {
                    method: "POST",
                  },
                );
                setMessage(
                  result.duplicate ? "Scan already running for this window." : "Scan queued.",
                );
              }}
            >
              Run scan
            </Button>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                try {
                  const result = await api<{ agents: Agent[] }>(`/api/v1/agents/${agent.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      schedule: draft.schedule,
                      tokenBudget: Number(draft.tokenBudget),
                      skillIds: draft.skillIds,
                      watchlistItems: parseCanonicalIds(draft.canonicalIds),
                    }),
                  });
                  setAgents(result.agents);
                  setMessage("Agent saved.");
                } catch (err: unknown) {
                  setMessage(err instanceof Error ? err.message : "Save failed");
                }
              }}
            >
              <Field label={`Schedule for ${agent.name}`}>
                <select
                  id={`schedule-for-${agent.name.toLowerCase().replace(/\s+/g, "-")}`}
                  value={draft.schedule}
                  onChange={(e) =>
                    setDrafts((current) => ({
                      ...current,
                      [agent.id]: { ...draft, schedule: e.target.value },
                    }))
                  }
                >
                  {["30m", "1h", "2h", "4h", "6h", "12h", "daily"].map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={`Token budget for ${agent.name}`}>
                <input
                  id={`token-budget-for-${agent.name.toLowerCase().replace(/\s+/g, "-")}`}
                  type="number"
                  min={500}
                  max={200000}
                  value={draft.tokenBudget}
                  onChange={(e) =>
                    setDrafts((current) => ({
                      ...current,
                      [agent.id]: { ...draft, tokenBudget: e.target.value },
                    }))
                  }
                />
              </Field>
              <Field label={`Canonical asset ids for ${agent.name}`}>
                <textarea
                  id={`canonical-asset-ids-for-${agent.name.toLowerCase().replace(/\s+/g, "-")}`}
                  rows={3}
                  value={draft.canonicalIds}
                  onChange={(e) =>
                    setDrafts((current) => ({
                      ...current,
                      [agent.id]: { ...draft, canonicalIds: e.target.value },
                    }))
                  }
                />
              </Field>
              <fieldset>
                <legend>Attached skills</legend>
                {catalog.map((skill) => (
                  <label key={skill.id} htmlFor={`${agent.id}-${skill.slug}`}>
                    <input
                      id={`${agent.id}-${skill.slug}`}
                      type="checkbox"
                      checked={draft.skillIds.includes(skill.id)}
                      onChange={(e) =>
                        setDrafts((current) => ({
                          ...current,
                          [agent.id]: {
                            ...draft,
                            skillIds: e.target.checked
                              ? [...draft.skillIds, skill.id]
                              : draft.skillIds.filter((item) => item !== skill.id),
                          },
                        }))
                      }
                    />{" "}
                    {skill.slug}
                  </label>
                ))}
              </fieldset>
              <p>
                <Button type="submit">Save agent</Button>
              </p>
            </form>
            {agent.default ? null : (
              <Button
                onClick={async () => {
                  try {
                    const result = await api<{ agents: Agent[] }>(`/api/v1/agents/${agent.id}`, {
                      method: "DELETE",
                    });
                    setAgents(result.agents);
                    setMessage("Agent deleted.");
                  } catch (err: unknown) {
                    setMessage(err instanceof Error ? err.message : "Delete failed");
                  }
                }}
              >
                Delete agent
              </Button>
            )}
          </Card>
        );
      })}
      {agents.length === 0 ? (
        <EmptyState
          title="No agents"
          body="Finish first-run setup to create the default Crypto agent, then add more here."
        />
      ) : null}
    </>
  );
}
export { AgentsPage };
