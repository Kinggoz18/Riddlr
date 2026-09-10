import { Button, Card, EmptyState, Field } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { api } from "../api.js";

function SourcesPage() {
  const [rows, setRows] = useState<
    Array<{
      id: string;
      name: string;
      adapterId: string;
      lastHealthMessage?: string | null;
      lastHealthOk?: boolean | null;
      tokenConfigured?: boolean;
    }>
  >([]);
  const [lookbackNotes, setLookbackNotes] = useState<string>();
  const [xLookbackNotes, setXLookbackNotes] = useState<string>();
  const [inviteUrl, setInviteUrl] = useState<string>();
  const [botPermissions, setBotPermissions] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [name, setName] = useState("Discord");
  const [botToken, setBotToken] = useState("");
  const [guildId, setGuildId] = useState("");
  const [channelIds, setChannelIds] = useState("");
  const [excludeChannelIds, setExcludeChannelIds] = useState("");
  const [keywords, setKeywords] = useState("");
  const [lookbackHours, setLookbackHours] = useState("6");
  const [xName, setXName] = useState("X");
  const [bearerToken, setBearerToken] = useState("");
  const [xAuthors, setXAuthors] = useState("");
  const [xMentions, setXMentions] = useState("");
  const [xKeywords, setXKeywords] = useState("");
  const [xLookbackHours, setXLookbackHours] = useState("24");

  async function reload() {
    const value = await api<{
      sources: typeof rows;
      adapters: Array<{
        id: string;
        capabilities?: { lookbackNotes?: string };
        inviteUrl?: string;
        botPermissions?: number;
      }>;
    }>("/api/v1/sources");
    setRows(value.sources);
    const discord = value.adapters.find((item) => item.id === "discord");
    const x = value.adapters.find((item) => item.id === "x");
    setLookbackNotes(discord?.capabilities?.lookbackNotes);
    setXLookbackNotes(x?.capabilities?.lookbackNotes);
    setInviteUrl(discord?.inviteUrl);
    setBotPermissions(discord?.botPermissions);
  }

  useEffect(() => {
    void reload()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);
  if (loading) {
    return <p>Loading sources…</p>;
  }
  if (error) {
    return <EmptyState title="Unable to load sources" body={error} />;
  }
  function parseIds(value: string) {
    return value
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return (
    <>
      <h1>Sources</h1>
      {message ? <p>{message}</p> : null}
      {rows.length === 0 ? (
        <EmptyState title="No sources" body="SearXNG is created during setup." />
      ) : (
        rows.map((row) => (
          <Card key={row.id}>
            <h2>{row.name}</h2>
            <p>Adapter: {row.adapterId}</p>
            <p>
              {row.lastHealthOk === false
                ? row.lastHealthMessage
                : (row.lastHealthMessage ?? "Not tested yet")}
            </p>
            {row.adapterId === "discord" || row.adapterId === "x" ? (
              <Button
                onClick={async () => {
                  try {
                    await api(`/api/v1/sources/${row.id}`, { method: "DELETE" });
                    setMessage(`${row.adapterId === "x" ? "X" : "Discord"} source removed.`);
                    await reload();
                  } catch (err: unknown) {
                    setMessage(err instanceof Error ? err.message : "Remove failed");
                  }
                }}
              >
                Remove {row.adapterId === "x" ? "X" : "Discord"} source
              </Button>
            ) : null}
          </Card>
        ))
      )}
      <Card>
        <h2>Add Discord source</h2>
        <p style={{ color: "var(--muted)" }}>
          Create an application in the Discord Developer Portal, add a bot, enable the
          MESSAGE_CONTENT privileged intent, and invite the bot with VIEW_CHANNEL and
          READ_MESSAGE_HISTORY only. Do not grant Administrator.
        </p>
        {inviteUrl ? (
          <p>
            Invite URL template: {inviteUrl} — add your application client id in the Developer
            Portal.
          </p>
        ) : null}
        {botPermissions ? <p>Permission integer: {botPermissions}</p> : null}
        {lookbackNotes ? <p>{lookbackNotes}</p> : null}
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/sources/discord", {
                method: "POST",
                body: JSON.stringify({
                  name,
                  botToken,
                  guildId: guildId || undefined,
                  channelIds: parseIds(channelIds),
                  excludeChannelIds: parseIds(excludeChannelIds),
                  keywords: parseIds(keywords),
                  lookbackHours: Number(lookbackHours),
                }),
              });
              setBotToken("");
              setMessage("Discord source saved. The bot token is not shown again.");
              await reload();
            } catch (err: unknown) {
              setMessage(err instanceof Error ? err.message : "Save failed");
            }
          }}
        >
          <Field label="Source name">
            <input
              id="source-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field label="Bot token" hint="Stored encrypted. Never shown again.">
            <input
              id="bot-token"
              type="password"
              autoComplete="off"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Server id"
            hint="Discord snowflake for the guild. Optional if channel ids are enough."
          >
            <input id="server-id" value={guildId} onChange={(e) => setGuildId(e.target.value)} />
          </Field>
          <Field label="Channel ids" hint="One snowflake per line. Required.">
            <textarea
              id="channel-ids"
              rows={3}
              value={channelIds}
              onChange={(e) => setChannelIds(e.target.value)}
              required
            />
          </Field>
          <Field label="Excluded channel ids">
            <textarea
              id="excluded-channel-ids"
              rows={2}
              value={excludeChannelIds}
              onChange={(e) => setExcludeChannelIds(e.target.value)}
            />
          </Field>
          <Field
            label="Monitoring keywords"
            hint="Optional. Empty means every recent message in the lookback window."
          >
            <input
              id="monitoring-keywords"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
            />
          </Field>
          <Field
            label="Lookback hours"
            hint="1–24. Discord does not provide message-search archive access here."
          >
            <input
              id="lookback-hours"
              type="number"
              min={1}
              max={24}
              value={lookbackHours}
              onChange={(e) => setLookbackHours(e.target.value)}
            />
          </Field>
          <p>
            <Button type="submit">Save Discord source</Button>
          </p>
        </form>
      </Card>
      <Card>
        <h2>Add X source</h2>
        <p style={{ color: "var(--muted)" }}>
          Create a project in the X Developer Portal and use a bearer token for official recent
          search. Riddlr does not scrape X and does not call archive search. Access depends on the
          token plan; 403 means recent search is not available on that plan.
        </p>
        {xLookbackNotes ? <p>{xLookbackNotes}</p> : null}
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/sources/x", {
                method: "POST",
                body: JSON.stringify({
                  name: xName,
                  bearerToken,
                  authors: parseIds(xAuthors),
                  mentions: parseIds(xMentions),
                  keywords: parseIds(xKeywords),
                  lookbackHours: Number(xLookbackHours),
                }),
              });
              setBearerToken("");
              setMessage("X source saved. The bearer token is not shown again.");
              await reload();
            } catch (err: unknown) {
              setMessage(err instanceof Error ? err.message : "Save failed");
            }
          }}
        >
          <Field label="X source name">
            <input
              id="x-source-name"
              value={xName}
              onChange={(e) => setXName(e.target.value)}
              required
            />
          </Field>
          <Field label="Bearer token" hint="Stored encrypted. Never shown again.">
            <input
              id="bearer-token"
              type="password"
              autoComplete="off"
              value={bearerToken}
              onChange={(e) => setBearerToken(e.target.value)}
              required
            />
          </Field>
          <Field label="Authors" hint="X usernames, one per line. Optional if keywords are set.">
            <textarea
              id="authors"
              rows={2}
              value={xAuthors}
              onChange={(e) => setXAuthors(e.target.value)}
            />
          </Field>
          <Field label="Mentions" hint="Usernames to match as @mentions.">
            <textarea
              id="mentions"
              rows={2}
              value={xMentions}
              onChange={(e) => setXMentions(e.target.value)}
            />
          </Field>
          <Field label="X search keywords">
            <input
              id="x-search-keywords"
              value={xKeywords}
              onChange={(e) => setXKeywords(e.target.value)}
            />
          </Field>
          <Field
            label="X lookback hours"
            hint="1–168. Recent search only; archive search is not used."
          >
            <input
              id="x-lookback-hours"
              type="number"
              min={1}
              max={168}
              value={xLookbackHours}
              onChange={(e) => setXLookbackHours(e.target.value)}
            />
          </Field>
          <p>
            <Button type="submit">Save X source</Button>
          </p>
        </form>
      </Card>
    </>
  );
}
export { SourcesPage };
