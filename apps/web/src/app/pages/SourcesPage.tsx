import { Button, Card, EmptyState, Field, PageHeader, StatusBadge } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { AssetPicker } from "../AssetPicker.js";
import { api } from "../api.js";
import { ExternalLink } from "../Brand.js";
import { ChipInput, ChipList } from "../ChipInput.js";
import { ASSET_CATALOG, adapterLabel, assetLabel, channelLabel, handleLabel } from "../format.js";
import { PageSubnav } from "../PageSubnav.js";
import { toastFail, useToast } from "../Toast.js";

type SourceRow = {
  id: string;
  name: string;
  adapterId: string;
  enabled: boolean;
  lastHealthMessage?: string | null;
  lastHealthOk?: boolean | null;
  tokenConfigured?: boolean;
  config?: Record<string, unknown>;
};

type Adapter = {
  id: string;
  capabilities?: { lookbackNotes?: string };
  inviteUrl?: string;
  botPermissions?: number;
  comingSoon?: boolean;
};

const ADAPTERS = [
  {
    id: "discord",
    name: "Discord",
    body: "Recent channel messages. You can add more than one Discord source.",
  },
  {
    id: "x",
    name: "X",
    body: "Recent search only. Authors, mentions, and keywords.",
  },
  {
    id: "coingecko",
    name: "CoinGecko",
    body: "Market snapshots. Optional demo key. Only one market source is active at a time.",
  },
  {
    id: "coinmarketcap",
    name: "CoinMarketCap",
    body: "Pro API quotes/latest. Requires X-CMC_PRO_API_KEY. Replaces the active market source.",
  },
  {
    id: "cryptocom",
    name: "Crypto.com Exchange",
    body: "Public get-tickers only. No trading or private keys. Replaces the active market source.",
  },
] as const;

function SourcesSubnav() {
  return (
    <PageSubnav
      label="Sources"
      items={[
        { to: "/sources", label: "View sources", end: true },
        { to: "/sources/new", label: "Add source" },
      ]}
    />
  );
}

function SourcesList() {
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  useEffect(() => {
    void api<{ sources: SourceRow[] }>("/api/v1/sources")
      .then((body) => setRows(body.sources))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);
  if (loading) {
    return <p>Loading sources…</p>;
  }
  if (error) {
    return <EmptyState title="Unable to load sources" body={error} />;
  }
  return (
    <>
      <PageHeader
        title="Sources"
        description="Connectors that produce untrusted evidence. Only one market-data source is enabled at a time."
        actions={<SourcesSubnav />}
      />
      {rows.length === 0 ? (
        <EmptyState title="No sources" body="SearXNG is created during setup." />
      ) : (
        <section className="record-list">
          {rows.map((row) => (
            <Card key={row.id} className="record-row">
              <NavLink to={`/sources/${row.id}`}>{row.name}</NavLink>
              <StatusBadge label={row.enabled ? "Enabled" : "Paused"} />
              <p className="record-meta">
                <span>{adapterLabel(row.adapterId)}</span>
                <span>
                  {row.lastHealthOk === false
                    ? row.lastHealthMessage
                    : (row.lastHealthMessage ?? "Not tested yet")}
                </span>
              </p>
              <p className="source-toolbar">
                <Button
                  variant="ghost"
                  onClick={async () => {
                    try {
                      const result = await api<{ ok: boolean; message: string }>(
                        `/api/v1/sources/${row.id}/test`,
                        { method: "POST" },
                      );
                      toast(result.message, result.ok ? "ok" : "danger");
                    } catch (err: unknown) {
                      toast(toastFail(err, "Couldn’t test source"), "danger");
                    }
                  }}
                >
                  Test source
                </Button>
              </p>
            </Card>
          ))}
        </section>
      )}
    </>
  );
}

function SourcePicker() {
  const [rows, setRows] = useState<SourceRow[]>([]);
  useEffect(() => {
    void api<{ sources: SourceRow[] }>("/api/v1/sources").then((body) => setRows(body.sources));
  }, []);
  return (
    <>
      <PageHeader
        title="Add source"
        description="Discord can be added more than once. Market-data sources replace each other: only one is active."
        actions={<SourcesSubnav />}
      />
      <section className="adapter-grid">
        {ADAPTERS.map((adapter) => {
          const existing = rows.find((row) => row.adapterId === adapter.id);
          const unique = adapter.id !== "discord" && adapter.id !== "x";
          return (
            <Card key={adapter.id}>
              <h2>{adapter.name}</h2>
              <p className="field-note">{adapter.body}</p>
              {unique && existing ? (
                <NavLink to={`/sources/${existing.id}`} className="ui-button ui-button-primary">
                  View {adapter.name}
                </NavLink>
              ) : (
                <NavLink to={`/sources/new/${adapter.id}`} className="ui-button ui-button-primary">
                  Configure {adapter.name}
                </NavLink>
              )}
            </Card>
          );
        })}
      </section>
    </>
  );
}

function DiscordForm() {
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState("Discord");
  const [botToken, setBotToken] = useState("");
  const [guildId, setGuildId] = useState("");
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [excludeChannelIds, setExcludeChannelIds] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [lookbackHours, setLookbackHours] = useState("6");
  const [notes, setNotes] = useState<string>();
  const [inviteUrl, setInviteUrl] = useState<string>();
  const [botPermissions, setBotPermissions] = useState<number>();
  useEffect(() => {
    void api<{ adapters: Adapter[] }>("/api/v1/sources").then((body) => {
      const discord = body.adapters.find((item) => item.id === "discord");
      setNotes(discord?.capabilities?.lookbackNotes);
      setInviteUrl(discord?.inviteUrl);
      setBotPermissions(discord?.botPermissions);
    });
  }, []);
  return (
    <>
      <PageHeader
        title="Add Discord source"
        description="Requires MESSAGE_CONTENT, VIEW_CHANNEL and READ_MESSAGE_HISTORY. Add another Discord source for a second server."
        actions={<SourcesSubnav />}
      />
      <Card>
        {inviteUrl ? <ExternalLink href={inviteUrl}>Open invite template</ExternalLink> : null}
        {botPermissions ? <code>Permissions: {botPermissions}</code> : null}
        {notes ? <p className="field-note">{notes}</p> : null}
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
                  channelIds,
                  excludeChannelIds,
                  keywords,
                  lookbackHours: Number(lookbackHours),
                }),
              });
              toast("Discord saved");
              navigate("/sources");
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t save Discord"), "danger");
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
            hint="Optional if channel IDs are enough. Enable Developer Mode in Discord to copy IDs."
          >
            <input id="server-id" value={guildId} onChange={(e) => setGuildId(e.target.value)} />
          </Field>
          <Field
            label="Channels"
            hint="Paste each channel ID and press Enter. Developer Mode → right-click channel → Copy Channel ID."
          >
            <ChipInput
              id="channel-ids"
              values={channelIds}
              onChange={setChannelIds}
              placeholder="Channel ID"
              normalize={(raw) => (/^\d{17,20}$/.test(raw.trim()) ? raw.trim() : undefined)}
            />
          </Field>
          <Field label="Excluded channels">
            <ChipInput
              id="excluded-channel-ids"
              values={excludeChannelIds}
              onChange={setExcludeChannelIds}
              placeholder="Channel ID to skip"
              normalize={(raw) => (/^\d{17,20}$/.test(raw.trim()) ? raw.trim() : undefined)}
            />
          </Field>
          <Field
            label="Keywords"
            hint="Optional. Empty means every recent message in the lookback window."
          >
            <ChipInput
              id="monitoring-keywords"
              values={keywords}
              onChange={setKeywords}
              placeholder="bitcoin"
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
          <p className="ui-actions">
            <Button type="submit">Save Discord source</Button>
          </p>
        </form>
      </Card>
    </>
  );
}

function XForm() {
  const toast = useToast();
  const navigate = useNavigate();
  const [xName, setXName] = useState("X");
  const [bearerToken, setBearerToken] = useState("");
  const [authors, setAuthors] = useState<string[]>([]);
  const [mentions, setMentions] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [xLookbackHours, setXLookbackHours] = useState("24");
  const [notes, setNotes] = useState<string>();
  useEffect(() => {
    void api<{ adapters: Adapter[] }>("/api/v1/sources").then((body) => {
      setNotes(body.adapters.find((item) => item.id === "x")?.capabilities?.lookbackNotes);
    });
  }, []);
  return (
    <>
      <PageHeader
        title="Add X source"
        description="Recent search only. Availability depends on your X API plan."
        actions={<SourcesSubnav />}
      />
      <Card>
        <p className="field-note">Recent search only</p>
        {notes ? <p className="field-note">{notes}</p> : null}
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/sources/x", {
                method: "POST",
                body: JSON.stringify({
                  name: xName,
                  bearerToken,
                  authors,
                  mentions,
                  keywords,
                  lookbackHours: Number(xLookbackHours),
                }),
              });
              toast("X saved");
              navigate("/sources");
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t save X"), "danger");
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
          <Field label="Authors" hint="Accounts to follow. Type a handle and press Enter.">
            <ChipInput
              id="authors"
              values={authors}
              onChange={setAuthors}
              placeholder="@username"
              normalize={(raw) => {
                const handle = raw.trim().replace(/^@/, "");
                return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : undefined;
              }}
              format={(value) => `@${value.replace(/^@/, "")}`}
            />
          </Field>
          <Field label="Mentions" hint="Posts that mention these accounts.">
            <ChipInput
              id="mentions"
              values={mentions}
              onChange={setMentions}
              placeholder="@username"
              normalize={(raw) => {
                const handle = raw.trim().replace(/^@/, "");
                return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : undefined;
              }}
              format={(value) => `@${value.replace(/^@/, "")}`}
            />
          </Field>
          <Field label="Keywords">
            <ChipInput
              id="x-search-keywords"
              values={keywords}
              onChange={setKeywords}
              placeholder="ETF"
            />
          </Field>
          <Field
            label="Lookback hours"
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
          <p className="ui-actions">
            <Button type="submit">Save X source</Button>
          </p>
        </form>
      </Card>
    </>
  );
}

function geckoIdsFromCanonical(ids: string[]) {
  return ids.map((item) => item.replace(/^coingecko:/, ""));
}

function MarketForm(props: {
  adapter: "coingecko" | "coinmarketcap" | "cryptocom";
  title: string;
  path: string;
  requiresKey?: boolean;
  note: string;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState(props.title.replace(/^Add /, ""));
  const [apiKey, setApiKey] = useState("");
  const [assets, setAssets] = useState(ASSET_CATALOG.slice(0, 3).map((item) => item.canonicalId));
  const [notes, setNotes] = useState<string>();
  useEffect(() => {
    void api<{ adapters: Adapter[] }>("/api/v1/sources").then((body) => {
      setNotes(
        body.adapters.find((item) => item.id === props.adapter)?.capabilities?.lookbackNotes,
      );
    });
  }, [props.adapter]);
  return (
    <>
      <PageHeader title={props.title} description={props.note} actions={<SourcesSubnav />} />
      <Card>
        {notes ? <p className="field-note">{notes}</p> : null}
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api(props.path, {
                method: "POST",
                body: JSON.stringify({
                  name,
                  apiKey: apiKey || undefined,
                  assetIds: geckoIdsFromCanonical(assets),
                }),
              });
              toast(`${props.title.replace(/^Add /, "")} saved`);
              navigate("/sources");
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t save market source"), "danger");
            }
          }}
        >
          <Field label="Source name">
            <input
              id={`${props.adapter}-source-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field label="Assets" hint="Named assets. Watchlist canonical IDs still drive scans.">
            <AssetPicker id={`${props.adapter}-asset-ids`} values={assets} onChange={setAssets} />
          </Field>
          {props.adapter === "cryptocom" ? null : (
            <Field
              label="API key"
              hint={
                props.requiresKey
                  ? "Required. Stored encrypted. Never shown again."
                  : "Optional. Stored encrypted if provided."
              }
            >
              <input
                id={`${props.adapter}-api-key`}
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                required={props.requiresKey}
              />
            </Field>
          )}
          <p className="ui-actions">
            <Button type="submit">Save {name}</Button>
          </p>
        </form>
      </Card>
    </>
  );
}

function SourceCreate() {
  const { adapter } = useParams();
  if (adapter === "discord") {
    return <DiscordForm />;
  }
  if (adapter === "x") {
    return <XForm />;
  }
  if (adapter === "coingecko") {
    return (
      <MarketForm
        adapter="coingecko"
        title="Add CoinGecko source"
        path="/api/v1/sources/coingecko"
        requiresKey={false}
        note="Official CoinGecko markets API. Optional demo key. This is market data, not news."
      />
    );
  }
  if (adapter === "coinmarketcap") {
    return (
      <MarketForm
        adapter="coinmarketcap"
        title="Add CoinMarketCap source"
        path="/api/v1/sources/coinmarketcap"
        requiresKey
        note="Official Pro API GET /v3/cryptocurrency/quotes/latest with X-CMC_PRO_API_KEY. Enabling this pauses other market sources."
      />
    );
  }
  if (adapter === "cryptocom") {
    return (
      <MarketForm
        adapter="cryptocom"
        title="Add Crypto.com Exchange source"
        path="/api/v1/sources/cryptocom"
        requiresKey={false}
        note="Public Exchange v1 get-tickers only. No trading endpoints and no API secret."
      />
    );
  }
  return <EmptyState title="Unknown adapter" body="Pick a source type from Add source." />;
}

function SourceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [row, setRow] = useState<SourceRow>();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!id) {
      return;
    }
    void api<{ source: SourceRow }>(`/api/v1/sources/${id}`)
      .then((body) => setRow(body.source))
      .catch(() => setMissing(true));
  }, [id]);
  if (missing) {
    return <EmptyState title="Source not found" body="This source does not exist." />;
  }
  if (!row) {
    return <p>Loading source…</p>;
  }
  const removable = row.adapterId !== "searxng";
  const config = row.config ?? {};
  const channelIds = Array.isArray(config.channelIds) ? config.channelIds.map(String) : [];
  const excludeChannelIds = Array.isArray(config.excludeChannelIds)
    ? config.excludeChannelIds.map(String)
    : [];
  const keywords = Array.isArray(config.keywords) ? config.keywords.map(String) : [];
  const authors = Array.isArray(config.authors) ? config.authors.map(String) : [];
  const mentions = Array.isArray(config.mentions) ? config.mentions.map(String) : [];
  const assetIds = Array.isArray(config.assetIds)
    ? config.assetIds.map((item) => `coingecko:${String(item).replace(/^coingecko:/, "")}`)
    : [];
  return (
    <>
      <PageHeader
        title={row.name}
        description="Untrusted evidence connector. Market-data sources are exclusive."
        actions={
          <>
            <SourcesSubnav />
            {removable ? (
              <NavLink to={`/sources/${row.id}/edit`} className="ui-button ui-button-primary">
                Edit source
              </NavLink>
            ) : null}
          </>
        }
      />
      <p className="record-meta">
        <StatusBadge label={row.enabled ? "Enabled" : "Paused"} />
        <span>{adapterLabel(row.adapterId)}</span>
      </p>
      {row.adapterId === "discord" ? (
        <Card>
          <h2>Channels</h2>
          <ChipList values={channelIds} format={channelLabel} empty="No channels" />
          <h2>Excluded</h2>
          <ChipList values={excludeChannelIds} format={channelLabel} empty="None" />
          <h2>Keywords</h2>
          <ChipList values={keywords} empty="Every recent message in the lookback window" />
        </Card>
      ) : null}
      {row.adapterId === "x" ? (
        <Card>
          <h2>Authors</h2>
          <ChipList values={authors} format={handleLabel} empty="None" />
          <h2>Mentions</h2>
          <ChipList values={mentions} format={handleLabel} empty="None" />
          <h2>Keywords</h2>
          <ChipList values={keywords} empty="None" />
        </Card>
      ) : null}
      {["coingecko", "coinmarketcap", "cryptocom"].includes(row.adapterId) ? (
        <Card>
          <h2>Assets</h2>
          <ChipList values={assetIds} format={assetLabel} empty="Watchlist drives quotes" />
        </Card>
      ) : null}
      <Card>
        <h2>Health</h2>
        <p>
          {row.lastHealthOk === false
            ? row.lastHealthMessage
            : (row.lastHealthMessage ?? "Not tested yet")}
        </p>
        <Button
          onClick={async () => {
            try {
              const result = await api<{ ok: boolean; message: string }>(
                `/api/v1/sources/${row.id}/test`,
                { method: "POST" },
              );
              toast(result.message, result.ok ? "ok" : "danger");
              const next = await api<{ source: SourceRow }>(`/api/v1/sources/${row.id}`);
              setRow(next.source);
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t test source"), "danger");
            }
          }}
        >
          Test source
        </Button>
      </Card>
      {removable ? (
        <p>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await api(`/api/v1/sources/${row.id}`, { method: "DELETE" });
                toast("Source removed");
                navigate("/sources");
              } catch (err: unknown) {
                toast(toastFail(err, "Couldn’t remove source"), "danger");
              }
            }}
          >
            Remove {row.name}
          </Button>
        </p>
      ) : (
        <p className="field-note">SearXNG cannot be removed from this page.</p>
      )}
    </>
  );
}

function SourceEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [row, setRow] = useState<SourceRow>();
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!id) {
      return;
    }
    void api<{ source: SourceRow }>(`/api/v1/sources/${id}`)
      .then((body) => {
        setRow(body.source);
        setName(body.source.name);
        setEnabled(body.source.enabled);
      })
      .catch(() => setMissing(true));
  }, [id]);
  if (missing) {
    return <EmptyState title="Source not found" body="This source does not exist." />;
  }
  if (!row) {
    return <p>Loading source…</p>;
  }
  return (
    <>
      <PageHeader
        title={`Edit ${row.name}`}
        description="Rename or pause. Enabling a market source pauses the others."
        actions={<SourcesSubnav />}
      />
      <Card>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api(`/api/v1/sources/${row.id}`, {
                method: "PATCH",
                body: JSON.stringify({ name, enabled }),
              });
              toast("Source saved");
              navigate(`/sources/${row.id}`);
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t save source"), "danger");
            }
          }}
        >
          <Field label="Source name">
            <input
              id="edit-source-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <label className="check-row" htmlFor="source-enabled">
            <input
              id="source-enabled"
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Source enabled
          </label>
          <p className="ui-actions">
            <Button type="submit">Save source</Button>
          </p>
        </form>
      </Card>
    </>
  );
}

function SourcesPage() {
  return (
    <Routes>
      <Route index element={<SourcesList />} />
      <Route path="new" element={<SourcePicker />} />
      <Route path="new/:adapter" element={<SourceCreate />} />
      <Route path=":id" element={<SourceDetail />} />
      <Route path=":id/edit" element={<SourceEdit />} />
    </Routes>
  );
}

export { SourcesPage };
