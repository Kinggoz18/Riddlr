import { Button, Card, EmptyState, Field, PageHeader, StatusBadge } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { PageSubnav } from "../PageSubnav.js";
import { toastFail, useToast } from "../Toast.js";

type Skill = { id: string; slug: string; origin: string; version?: string; markdownBody?: string };

function SkillsSubnav() {
  return (
    <PageSubnav
      label="Skills"
      items={[
        { to: "/skills", label: "View skills", end: true },
        { to: "/skills/new", label: "Create skill" },
      ]}
    />
  );
}

function SkillsList() {
  const [catalog, setCatalog] = useState<Skill[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void api<{ skills: Skill[] }>("/api/v1/skills")
      .then((body) => setCatalog(body.skills))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);
  if (loading) {
    return <p>Loading skills…</p>;
  }
  if (error) {
    return <EmptyState title="Unable to load skills" body={error} />;
  }
  return (
    <>
      <PageHeader
        title="Skills"
        description="Markdown policy attached to agents. Skills cannot grant tools, filesystem, or secrets."
        actions={
          <NavLink to="/skills/new" className="ui-button ui-button-primary">
            Create skill
          </NavLink>
        }
      />
      <SkillsSubnav />
      <section className="record-list">
        {catalog.map((skill) => (
          <Card key={skill.id} className="record-row">
            <NavLink to={`/skills/${skill.id}`}>{skill.slug}</NavLink>
            <StatusBadge label={skill.origin === "shipped" ? "Shipped" : "User"} />
          </Card>
        ))}
      </section>
    </>
  );
}

function SkillCreate() {
  const toast = useToast();
  const navigate = useNavigate();
  const [skillSlug, setSkillSlug] = useState("");
  const [skillMarkdown, setSkillMarkdown] = useState("");
  return (
    <>
      <PageHeader
        title="Create skill"
        description="User skills are stored in PostgreSQL. Shipped slugs cannot be overwritten."
      />
      <SkillsSubnav />
      <Card>
        <form
          className="skill-compose"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              const result = await api<{ skill: Skill }>("/api/v1/skills", {
                method: "POST",
                body: JSON.stringify({ slug: skillSlug, markdownBody: skillMarkdown }),
              });
              toast("Skill saved");
              navigate(result.skill?.id ? `/skills/${result.skill.id}` : "/skills");
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t save skill"), "danger");
            }
          }}
        >
          <div className="skill-compose-fields">
            <Field label="Skill slug" hint="Lowercase, hyphenated. Cannot match a shipped skill.">
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
                rows={18}
                value={skillMarkdown}
                onChange={(e) => setSkillMarkdown(e.target.value)}
                required
              />
            </Field>
          </div>
          <aside className="skill-compose-meta">
            <p className="field-note">
              Policy text only. Instruction hierarchy stays system over agent over skill over
              source. Skills cannot grant tools, filesystem, or secrets.
            </p>
            <p className="ui-actions">
              <Button type="submit">Save skill</Button>
              <NavLink to="/skills" className="ui-button ui-button-ghost">
                Cancel
              </NavLink>
            </p>
          </aside>
        </form>
      </Card>
    </>
  );
}

function SkillDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [skill, setSkill] = useState<Skill>();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!id) {
      return;
    }
    void api<{ skill: Skill }>(`/api/v1/skills/${id}`)
      .then((body) => setSkill(body.skill))
      .catch(() => setMissing(true));
  }, [id]);
  if (missing) {
    return <EmptyState title="Skill not found" body="This skill does not exist." />;
  }
  if (!skill) {
    return <p>Loading skill…</p>;
  }
  return (
    <>
      <PageHeader
        title={skill.slug}
        description="Markdown policy. Shipped skills cannot be edited or deleted."
        actions={
          skill.origin === "user" ? (
            <NavLink to={`/skills/${skill.id}/edit`} className="ui-button ui-button-primary">
              Edit skill
            </NavLink>
          ) : null
        }
      />
      <SkillsSubnav />
      <StatusBadge label={skill.origin === "shipped" ? "Shipped" : "User"} />
      <pre className="skill-body">{skill.markdownBody}</pre>
      {skill.origin === "user" ? (
        <p>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await api(`/api/v1/skills/${skill.id}`, { method: "DELETE" });
                toast("Skill deleted");
                navigate("/skills");
              } catch (err: unknown) {
                toast(toastFail(err, "Couldn’t delete skill"), "danger");
              }
            }}
          >
            Delete skill
          </Button>
        </p>
      ) : null}
    </>
  );
}

function SkillEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [skill, setSkill] = useState<Skill>();
  const [markdown, setSkillMarkdown] = useState("");
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!id) {
      return;
    }
    void api<{ skill: Skill }>(`/api/v1/skills/${id}`)
      .then((body) => {
        setSkill(body.skill);
        setSkillMarkdown(body.skill.markdownBody ?? "");
      })
      .catch(() => setMissing(true));
  }, [id]);
  if (missing) {
    return <EmptyState title="Skill not found" body="This skill does not exist." />;
  }
  if (!skill) {
    return <p>Loading skill…</p>;
  }
  if (skill.origin === "shipped") {
    return <EmptyState title="Shipped skill" body="Shipped skills cannot be overwritten." />;
  }
  return (
    <>
      <PageHeader
        title={`Edit ${skill.slug}`}
        description="Update the markdown body only. The slug stays."
      />
      <SkillsSubnav />
      <Card>
        <form
          className="skill-compose"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api(`/api/v1/skills/${skill.id}`, {
                method: "PATCH",
                body: JSON.stringify({ markdownBody: markdown }),
              });
              toast("Skill saved");
              navigate(`/skills/${skill.id}`);
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t save skill"), "danger");
            }
          }}
        >
          <div className="skill-compose-fields">
            <Field label="Skill markdown">
              <textarea
                id="skill-markdown"
                rows={18}
                value={markdown}
                onChange={(e) => setSkillMarkdown(e.target.value)}
                required
              />
            </Field>
          </div>
          <aside className="skill-compose-meta">
            <p className="field-note">Slug {skill.slug} is immutable.</p>
            <p className="ui-actions">
              <Button type="submit">Save skill</Button>
              <NavLink to={`/skills/${skill.id}`} className="ui-button ui-button-ghost">
                Cancel
              </NavLink>
            </p>
          </aside>
        </form>
      </Card>
    </>
  );
}

function SkillsPage() {
  return (
    <Routes>
      <Route index element={<SkillsList />} />
      <Route path="new" element={<SkillCreate />} />
      <Route path=":id" element={<SkillDetail />} />
      <Route path=":id/edit" element={<SkillEdit />} />
    </Routes>
  );
}

export { SkillsPage };
