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

type IdentityRow = {
  id: string;
  platform: string;
  externalId: string;
  displayName?: string | null;
  hostname?: string | null;
  parentExternalId?: string | null;
  policy?: { trustTier: string; allowedUses: string[] };
  trackRecord?: { claims: number; laterCorroborated: number; medianLeadHours: number | null };
};

type HostPolicyRow = {
  id: string;
  hostname: string;
  trustTier: string;
  blocked: boolean;
  notes?: string | null;
};

type Adapter = {
  id: string;
  capabilities?: { lookbackNotes?: string };
  botPermissions?: number;
  comingSoon?: boolean;
  suggestedFeeds?: Array<{ name: string; url: string; trustTier: string }>;
};

const DISCORD_SNOWFLAKE = /^\d{17,20}$/;

function applicationIdFromBotToken(token: string): string | undefined {
  const first = token.trim().split(".")[0];
  if (!first) {
    return undefined;
  }
  try {
    const padded =
      first.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (first.length % 4)) % 4);
    const decoded = atob(padded);
    return DISCORD_SNOWFLAKE.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function discordBotInviteUrl(clientId: string, permissions: number) {
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("permissions", String(permissions));
  url.searchParams.set("scope", "bot");
  return url.toString();
}

const ADAPTERS = [
  {
    id: "feeds",
    name: "RSS/Atom",
    body: "Exchange announcements, protocol blogs, central-bank feeds, Substack, and YouTube channel feeds. You can add more than one.",
  },
  {
    id: "defillama",
    name: "DefiLlama",
    body: "Protocol TVL, stablecoin supply, and hacks. Opt-in. Personal, non-commercial; results stay in this operator database.",
  },
  {
    id: "hyperliquid",
    name: "Hyperliquid",
    body: "Perp funding, open interest, and mark price. Opt-in. Free info endpoint, no API key. One poll returns the whole universe; only watchlist assets are stored.",
  },
  {
    id: "binance-futures",
    name: "Binance USD-M Futures",
    body: "Perp funding, open interest, and liquidations. Opt-in. Public REST, no key. Funding is per 8h; compare venues on annualised APR only.",
  },
  {
    id: "polymarket",
    name: "Polymarket",
    body: "Prediction-market YES odds. Opt-in. Free Gamma and CLOB reads, no key. Pin market slugs. Odds jumps are early warnings until an official document corroborates.",
  },
  {
    id: "kalshi",
    name: "Kalshi",
    body: "US-regulated prediction-market odds. Opt-in. Public Trade API, no key. Pin series tickers such as KXCPI. Same odds-jump detector as Polymarket.",
  },
  {
    id: "snapshot",
    name: "Snapshot",
    body: "Governance proposals from Snapshot GraphQL. Opt-in. No API key. Pin space ids. Official trust for the space itself. Tally is not shipped.",
  },
  {
    id: "edgar",
    name: "SEC EDGAR",
    body: "SEC filings. Opt-in. Operator contact email required for User-Agent Riddlr/<version> <email>. Equities agents filter by watchlist CIKs. Crypto agents use EFTS keywords only.",
  },
  {
    id: "alchemy",
    name: "Alchemy",
    body: "EVM address-activity webhooks. Opt-in. Notify token required. Signing key stored encrypted. Never paste a seed phrase or private key.",
  },
  {
    id: "helius",
    name: "Helius",
    body: "Solana transfer webhooks. Opt-in. API key required. Auth header stored encrypted. Never paste a seed phrase or private key.",
  },
  {
    id: "discord",
    name: "Discord",
    body: "Recent channel messages, embeds, and archived public threads. You can add more than one Discord source.",
  },
  {
    id: "x",
    name: "X",
    body: "Named-principal recent search only. Authors required. Spend-capped.",
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
        description="Connectors that produce untrusted evidence. RSS/Atom and Discord can be added more than once. Only one market-data source is enabled at a time. DefiLlama, Hyperliquid, Binance USD-M Futures, Polymarket, Kalshi, Snapshot, Alchemy, and Helius are opt-in."
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
      <IdentityPolicies />
      <LabeledAddresses />
    </>
  );
}

function LabeledAddresses() {
  const toast = useToast();
  const [rows, setRows] = useState<
    { id: string; chain: string; address: string; role: string; label: string }[]
  >([]);
  const [chain, setChain] = useState("ethereum");
  const [address, setAddress] = useState("");
  const [role, setRole] = useState("exchange");
  const [label, setLabel] = useState("");
  async function refresh() {
    const body = await api<{
      addresses: { id: string; chain: string; address: string; role: string; label: string }[];
    }>("/api/v1/labeled-addresses");
    setRows(body.addresses);
  }
  useEffect(() => {
    void refresh().catch(() => undefined);
  }, []);
  return (
    <Card>
      <h2>Labeled addresses</h2>
      <p className="field-note">
        Exchange, bridge, and treasury labels used for on-chain reason codes. Shipped Binance 14,
        Coinbase 10, and Wormhole Token Bridge. Never enter a seed phrase or private key.
      </p>
      {rows.length === 0 ? (
        <p className="field-note">No labels yet.</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.id}>
              {row.chain} {row.address} {row.role} {row.label}
            </li>
          ))}
        </ul>
      )}
      <form
        className="stack-form"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await api("/api/v1/labeled-addresses", {
              method: "POST",
              body: JSON.stringify({
                chain,
                address,
                role,
                label: label.trim(),
              }),
            });
            setAddress("");
            setLabel("");
            toast("Labeled address saved");
            await refresh();
          } catch (err: unknown) {
            toast(toastFail(err, "Couldn’t save labeled address"), "danger");
          }
        }}
      >
        <Field label="Chain">
          <select id="labeled-chain" value={chain} onChange={(e) => setChain(e.target.value)}>
            <option value="ethereum">ethereum</option>
            <option value="solana">solana</option>
          </select>
        </Field>
        <Field label="Address">
          <input
            id="labeled-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
          />
        </Field>
        <Field label="Kind">
          <select id="labeled-kind" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="exchange">exchange</option>
            <option value="bridge">bridge</option>
            <option value="treasury">treasury</option>
            <option value="other">other</option>
          </select>
        </Field>
        <Field label="Label">
          <input
            id="labeled-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
          />
        </Field>
        <p className="ui-actions">
          <Button type="submit">Save labeled address</Button>
        </p>
      </form>
    </Card>
  );
}

function IdentityPolicies() {
  const toast = useToast();
  const [identities, setIdentities] = useState<IdentityRow[]>([]);
  const [hosts, setHosts] = useState<HostPolicyRow[]>([]);
  const [hostname, setHostname] = useState("");
  const [hostTrust, setHostTrust] = useState("unknown");
  const [hostBlocked, setHostBlocked] = useState(false);
  async function refresh() {
    const [identityBody, hostBody] = await Promise.all([
      api<{ identities: IdentityRow[] }>("/api/v1/source-identities"),
      api<{ hosts: HostPolicyRow[] }>("/api/v1/publisher-hosts"),
    ]);
    setIdentities(identityBody.identities);
    setHosts(hostBody.hosts);
  }
  useEffect(() => {
    void refresh().catch(() => undefined);
  }, []);
  return (
    <>
      <Card>
        <h2>Source identities</h2>
        <p className="field-note">
          Trust is assigned to a publisher, X actor, Discord author, or Discord channel—not to the
          platform. X, Discord, and feeds are claim sources only. Set channel trust on the channel
          identity; authors without their own policy inherit it. Track records show how often that
          identity’s claims were later corroborated by an official or known-analyst source.
        </p>
        {identities.length === 0 ? (
          <EmptyState
            title="No identities yet"
            body="Identities appear after a scan observes a publisher or actor."
          />
        ) : (
          <ul className="data-list">
            {identities.map((identity) => (
              <li key={identity.id}>
                <span>
                  {identity.displayName || identity.externalId}
                  <small>
                    {identity.platform}
                    {identity.hostname ? ` · ${identity.hostname}` : ""}
                    {identity.parentExternalId ? ` · channel ${identity.parentExternalId}` : ""} ·{" "}
                    {(identity.policy?.trustTier ?? "unknown").replaceAll("_", " ")}
                    {identity.trackRecord && identity.trackRecord.claims > 0
                      ? ` · ${identity.trackRecord.laterCorroborated} of ${identity.trackRecord.claims} later corroborated${
                          identity.trackRecord.medianLeadHours == null
                            ? ""
                            : ` · median lead ${identity.trackRecord.medianLeadHours}h`
                        }`
                      : ""}
                  </small>
                </span>
                <select
                  aria-label={`Trust for ${identity.displayName || identity.externalId}`}
                  value={identity.policy?.trustTier ?? "unknown"}
                  onChange={async (event) => {
                    try {
                      await api(`/api/v1/source-identities/${identity.id}/policy`, {
                        method: "POST",
                        body: JSON.stringify({
                          trustTier: event.target.value,
                          allowedUses:
                            event.target.value === "blocked"
                              ? ["discovery"]
                              : ["discovery", "analysis", "early_warning", "confirmation"],
                        }),
                      });
                      await refresh();
                      toast("Trust saved");
                    } catch (err: unknown) {
                      toast(toastFail(err, "Couldn’t save trust"), "danger");
                    }
                  }}
                >
                  <option value="unknown">unknown</option>
                  <option value="community">community</option>
                  <option value="known_analyst">known analyst</option>
                  <option value="official_firsthand">official firsthand</option>
                  <option value="blocked">blocked</option>
                </select>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <h2>Publisher hosts</h2>
        <p className="field-note">
          Blocked hosts skip SearXNG enrichment and cannot produce claims. Price-tracker hosts
          (CoinGecko, CoinMarketCap, TradingView, and the rest of the default list) start blocked.
          CoinGecko observations still poll.
        </p>
        {hosts.length > 0 ? (
          <ul className="data-list">
            {hosts.map((host) => (
              <li key={host.id}>
                <span>
                  {host.hostname}
                  <small>{host.blocked ? "blocked" : host.trustTier.replaceAll("_", " ")}</small>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/publisher-hosts", {
                method: "POST",
                body: JSON.stringify({
                  hostname,
                  trustTier: hostTrust,
                  blocked: hostBlocked,
                }),
              });
              setHostname("");
              setHostBlocked(false);
              await refresh();
              toast("Host policy saved");
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t save host policy"), "danger");
            }
          }}
        >
          <Field label="Hostname">
            <input
              id="publisher-hostname"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              required
            />
          </Field>
          <Field label="Trust">
            <select
              id="publisher-trust"
              value={hostTrust}
              onChange={(e) => setHostTrust(e.target.value)}
            >
              <option value="unknown">unknown</option>
              <option value="community">community</option>
              <option value="known_analyst">known analyst</option>
              <option value="official_firsthand">official firsthand</option>
              <option value="blocked">blocked</option>
            </select>
          </Field>
          <label className="check-row" htmlFor="publisher-blocked">
            <input
              id="publisher-blocked"
              type="checkbox"
              checked={hostBlocked}
              onChange={(e) => setHostBlocked(e.target.checked)}
            />
            Block enrichment
          </label>
          <p className="ui-actions">
            <Button type="submit">Save host policy</Button>
          </p>
        </form>
      </Card>
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
        description="Discord, X, and RSS/Atom can be added more than once. Market-data sources replace each other. DefiLlama, Hyperliquid, Binance USD-M Futures, Polymarket, Kalshi, Snapshot, SEC EDGAR, Alchemy, and Helius are single opt-in sources."
        actions={<SourcesSubnav />}
      />
      <section className="adapter-grid">
        {ADAPTERS.map((adapter) => {
          const existing = rows.find((row) => row.adapterId === adapter.id);
          const unique = adapter.id !== "discord" && adapter.id !== "x" && adapter.id !== "feeds";
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

function FeedForm() {
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState("RSS/Atom feed");
  const [feedUrl, setFeedUrl] = useState("");
  const [trustTier, setTrustTier] = useState("community");
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState("300");
  const [notes, setNotes] = useState<string>();
  const [suggested, setSuggested] = useState<
    Array<{ name: string; url: string; trustTier: string }>
  >([]);
  useEffect(() => {
    void api<{ adapters: Adapter[] }>("/api/v1/sources").then((body) => {
      const feeds = body.adapters.find((item) => item.id === "feeds");
      setNotes(feeds?.capabilities?.lookbackNotes);
      setSuggested(feeds?.suggestedFeeds ?? []);
    });
  }, []);
  return (
    <>
      <PageHeader
        title="Add RSS/Atom source"
        description="Operator-supplied http(s) URLs. Official feeds can be marked official firsthand at add time."
        actions={<SourcesSubnav />}
      />
      <Card>
        {notes ? <p className="field-note">{notes}</p> : null}
        {suggested.length > 0 ? (
          <p className="field-note">
            Suggested official feeds:{" "}
            {suggested.map((item) => (
              <button
                key={item.url}
                type="button"
                className="ui-button ui-button-ghost"
                onClick={() => {
                  setFeedUrl(item.url);
                  setName(item.name);
                  setTrustTier(item.trustTier);
                }}
              >
                {item.name}
              </button>
            ))}
          </p>
        ) : null}
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/sources/feeds", {
                method: "POST",
                body: JSON.stringify({
                  name,
                  feedUrl,
                  trustTier,
                  pollIntervalSeconds: Number(pollIntervalSeconds),
                }),
              });
              toast("Feed saved");
              navigate("/sources");
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t save feed"), "danger");
            }
          }}
        >
          <Field label="Source name">
            <input
              id="feed-source-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Feed URL"
            hint="RSS 2.0 or Atom 1.0. Substack /feed and YouTube feeds/videos.xml?channel_id= are accepted."
          >
            <input
              id="feed-url"
              type="url"
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              required
              placeholder="https://www.federalreserve.gov/feeds/press_all.xml"
            />
          </Field>
          <Field
            label="Trust"
            hint="Official firsthand can confirm listing, regulatory, macro, and incident events. Community is the default."
          >
            <select
              id="feed-trust"
              value={trustTier}
              onChange={(e) => setTrustTier(e.target.value)}
            >
              <option value="community">community</option>
              <option value="known_analyst">known analyst</option>
              <option value="official_firsthand">official firsthand</option>
              <option value="unknown">unknown</option>
              <option value="blocked">blocked</option>
            </select>
          </Field>
          <Field
            label="Poll interval seconds"
            hint="60–3600. Default 300. Unchanged ETags back off up to one hour."
          >
            <input
              id="feed-poll-interval"
              type="number"
              min={60}
              max={3600}
              value={pollIntervalSeconds}
              onChange={(e) => setPollIntervalSeconds(e.target.value)}
            />
          </Field>
          <p className="ui-actions">
            <Button type="submit">Save RSS/Atom source</Button>
          </p>
        </form>
      </Card>
    </>
  );
}

function DefiLlamaForm() {
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState("DefiLlama");
  const [chainSlugs, setChainSlugs] = useState<string[]>([]);
  const [protocolSlugs, setProtocolSlugs] = useState<string[]>([]);
  const [notes, setNotes] = useState<string>();
  useEffect(() => {
    void api<{ adapters: Adapter[] }>("/api/v1/sources").then((body) => {
      const adapter = body.adapters.find((item) => item.id === "defillama");
      setNotes(adapter?.capabilities?.lookbackNotes);
    });
  }, []);
  return (
    <>
      <PageHeader
        title="Add DefiLlama source"
        description="Opt-in TVL, stablecoin supply, and hacks. Personal, non-commercial terms: results stay in this operator database and are not re-exposed."
        actions={<SourcesSubnav />}
      />
      <Card>
        {notes ? <p className="field-note">{notes}</p> : null}
        <form
          className="stack-form"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/sources/defillama", {
                method: "POST",
                body: JSON.stringify({
                  name,
                  chainSlugs,
                  protocolSlugs,
                }),
              });
              toast("DefiLlama saved");
              navigate("/sources");
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t save DefiLlama"), "danger");
            }
          }}
        >
          <Field label="Source name">
            <input
              id="defillama-source-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Pinned chains"
            hint="Chain TVL for names DefiLlama uses, such as Ethereum. Leave empty to skip chain TVL."
          >
            <ChipInput
              id="defillama-chains"
              values={chainSlugs}
              onChange={setChainSlugs}
              placeholder="Ethereum"
            />
          </Field>
          <Field
            label="Extra protocol slugs"
            hint="Optional DefiLlama slugs to poll in addition to watchlist gecko_id mapping. Cap 16."
          >
            <ChipInput
              id="defillama-protocols"
              values={protocolSlugs}
              onChange={setProtocolSlugs}
              placeholder="aave"
            />
          </Field>
          <p className="ui-actions">
            <Button type="submit">Save DefiLlama source</Button>
          </p>
        </form>
      </Card>
    </>
  );
}

function HyperliquidForm() {
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState("Hyperliquid");
  const [notes, setNotes] = useState<string>();
  useEffect(() => {
    void api<{ adapters: Adapter[] }>("/api/v1/sources").then((body) => {
      const adapter = body.adapters.find((item) => item.id === "hyperliquid");
      setNotes(adapter?.capabilities?.lookbackNotes);
    });
  }, []);
  return (
    <>
      <PageHeader
        title="Add Hyperliquid source"
        description="Opt-in perpetual funding, open interest, and mark price. No API key. One call returns every perp; only watchlist and pinned subjects are stored."
        actions={<SourcesSubnav />}
      />
      <Card>
        {notes ? <p className="field-note">{notes}</p> : null}
        <form
          className="stack-form"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/sources/hyperliquid", {
                method: "POST",
                body: JSON.stringify({ name }),
              });
              toast("Hyperliquid saved");
              navigate("/sources");
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t save Hyperliquid"), "danger");
            }
          }}
        >
          <Field label="Source name">
            <input
              id="hyperliquid-source-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <p className="ui-actions">
            <Button type="submit">Save Hyperliquid source</Button>
          </p>
        </form>
      </Card>
    </>
  );
}

function BinanceFuturesForm() {
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState("Binance USD-M Futures");
  const [quoteAssets, setQuoteAssets] = useState<string[]>([]);
  const [notes, setNotes] = useState<string>();
  useEffect(() => {
    void api<{ adapters: Adapter[] }>("/api/v1/sources").then((body) => {
      const adapter = body.adapters.find((item) => item.id === "binance-futures");
      setNotes(adapter?.capabilities?.lookbackNotes);
    });
  }, []);
  return (
    <>
      <PageHeader
        title="Add Binance USD-M Futures source"
        description="Opt-in funding, open interest, and liquidations. No API key. Funding is per 8h; compare Hyperliquid on annualised APR only. HTTP 451 means this region cannot reach the venue."
        actions={<SourcesSubnav />}
      />
      <Card>
        {notes ? <p className="field-note">{notes}</p> : null}
        <form
          className="stack-form"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/sources/binance-futures", {
                method: "POST",
                body: JSON.stringify({
                  name,
                  quoteAssets,
                }),
              });
              toast("Binance USD-M Futures saved");
              navigate("/sources");
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t save Binance USD-M Futures"), "danger");
            }
          }}
        >
          <Field label="Source name">
            <input
              id="binance-futures-source-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Quote assets"
            hint="Stripped from symbols such as BTCUSDT. Default USDT, USDC, BUSD."
          >
            <ChipInput
              id="binance-futures-quotes"
              values={quoteAssets}
              onChange={setQuoteAssets}
              placeholder="USDT"
            />
          </Field>
          <p className="ui-actions">
            <Button type="submit">Save Binance USD-M Futures source</Button>
          </p>
        </form>
      </Card>
    </>
  );
}

function PolymarketForm() {
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState("Polymarket");
  const [marketSlugs, setMarketSlugs] = useState<string[]>([]);
  const [notes, setNotes] = useState<string>();
  useEffect(() => {
    void api<{ adapters: Adapter[] }>("/api/v1/sources").then((body) => {
      const adapter = body.adapters.find((item) => item.id === "polymarket");
      setNotes(adapter?.capabilities?.lookbackNotes);
    });
  }, []);
  return (
    <>
      <PageHeader
        title="Add Polymarket source"
        description="Opt-in YES odds from Gamma and CLOB. No API key. Pin market slugs. One events/keyset page suggests watched-asset and macro markets. Odds jumps are early warnings."
        actions={<SourcesSubnav />}
      />
      <Card>
        {notes ? <p className="field-note">{notes}</p> : null}
        <form
          className="stack-form"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/sources/polymarket", {
                method: "POST",
                body: JSON.stringify({
                  name,
                  marketSlugs,
                }),
              });
              toast("Polymarket saved");
              navigate("/sources");
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t save Polymarket"), "danger");
            }
          }}
        >
          <Field label="Source name">
            <input
              id="polymarket-source-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Market slugs"
            hint="Gamma slugs such as fed-rate-hike-in-2026. Cap 50. Also pin polymarket:slug on Health."
          >
            <ChipInput
              id="polymarket-slugs"
              values={marketSlugs}
              onChange={setMarketSlugs}
              placeholder="fed-rate-hike-in-2026"
            />
          </Field>
          <p className="ui-actions">
            <Button type="submit">Save Polymarket source</Button>
          </p>
        </form>
      </Card>
    </>
  );
}

function KalshiForm() {
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState("Kalshi");
  const [seriesTickers, setSeriesTickers] = useState<string[]>([]);
  const [marketTickers, setMarketTickers] = useState<string[]>([]);
  const [notes, setNotes] = useState<string>();
  useEffect(() => {
    void api<{ adapters: Adapter[] }>("/api/v1/sources").then((body) => {
      const adapter = body.adapters.find((item) => item.id === "kalshi");
      setNotes(adapter?.capabilities?.lookbackNotes);
    });
  }, []);
  return (
    <>
      <PageHeader
        title="Add Kalshi source"
        description="Opt-in US-regulated prediction-market odds. No API key. Pin series tickers such as KXCPI. Preferred for CPI, FOMC, and unemployment. Odds jumps are early warnings."
        actions={<SourcesSubnav />}
      />
      <Card>
        {notes ? <p className="field-note">{notes}</p> : null}
        <form
          className="stack-form"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/sources/kalshi", {
                method: "POST",
                body: JSON.stringify({
                  name,
                  seriesTickers,
                  marketTickers,
                }),
              });
              toast("Kalshi saved");
              navigate("/sources");
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t save Kalshi"), "danger");
            }
          }}
        >
          <Field label="Source name">
            <input
              id="kalshi-source-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Series tickers"
            hint="Series such as KXCPI. Do not fetch the unfiltered series list. Cap 50."
          >
            <ChipInput
              id="kalshi-series"
              values={seriesTickers}
              onChange={setSeriesTickers}
              placeholder="KXCPI"
            />
          </Field>
          <Field
            label="Market tickers"
            hint="Optional individual markets such as KXCPI-26SEP-T0.6. Leave empty to poll every open market in the pinned series."
          >
            <ChipInput
              id="kalshi-markets"
              values={marketTickers}
              onChange={setMarketTickers}
              placeholder="KXCPI-26SEP-T0.6"
            />
          </Field>
          <p className="ui-actions">
            <Button type="submit">Save Kalshi source</Button>
          </p>
        </form>
      </Card>
    </>
  );
}

function SnapshotForm() {
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState("Snapshot");
  const [spaces, setSpaces] = useState<string[]>([]);
  const [notes, setNotes] = useState<string>();
  useEffect(() => {
    void api<{ adapters: Adapter[] }>("/api/v1/sources").then((body) => {
      const adapter = body.adapters.find((item) => item.id === "snapshot");
      setNotes(adapter?.capabilities?.lookbackNotes);
    });
  }, []);
  return (
    <>
      <PageHeader
        title="Add Snapshot source"
        description="Opt-in governance proposals from Snapshot GraphQL. No API key. Pin space ids such as grovefinance.eth. Watched assets also map through a maintained space list. Tally is not shipped."
        actions={<SourcesSubnav />}
      />
      <Card>
        {notes ? <p className="field-note">{notes}</p> : null}
        <form
          className="stack-form"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/sources/snapshot", {
                method: "POST",
                body: JSON.stringify({
                  name,
                  spaces,
                }),
              });
              toast("Snapshot saved");
              navigate("/sources");
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t save Snapshot"), "danger");
            }
          }}
        >
          <Field label="Source name">
            <input
              id="snapshot-source-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Spaces"
            hint="Snapshot space ids such as grovefinance.eth. Cap 16. Aave, Uniswap, Compound, and ENS map from the watchlist automatically."
          >
            <ChipInput
              id="snapshot-spaces"
              values={spaces}
              onChange={setSpaces}
              placeholder="grovefinance.eth"
            />
          </Field>
          <p className="ui-actions">
            <Button type="submit">Save Snapshot source</Button>
          </p>
        </form>
      </Card>
    </>
  );
}

function AlchemyForm() {
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState("Alchemy");
  const [notifyToken, setNotifyToken] = useState("");
  const [network, setNetwork] = useState("ETH_MAINNET");
  const [notes, setNotes] = useState<string>();
  useEffect(() => {
    void api<{ adapters: Adapter[] }>("/api/v1/sources").then((body) => {
      const adapter = body.adapters.find((item) => item.id === "alchemy");
      setNotes(adapter?.capabilities?.lookbackNotes);
    });
  }, []);
  return (
    <>
      <PageHeader
        title="Add Alchemy source"
        description="Opt-in EVM address-activity webhooks. Paste the Notify auth token. Never paste a seed phrase or private key. Caddy must proxy /hooks/* to the API."
        actions={<SourcesSubnav />}
      />
      <Card>
        {notes ? <p className="field-note">{notes}</p> : null}
        <form
          className="stack-form"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/sources/alchemy", {
                method: "POST",
                body: JSON.stringify({ name, notifyToken, network }),
              });
              toast("Alchemy saved");
              navigate("/sources");
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t save Alchemy"), "danger");
            }
          }}
        >
          <Field label="Source name">
            <input
              id="alchemy-source-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field label="Notify token" hint="X-Alchemy-Token. Stored encrypted. Never shown again.">
            <input
              id="alchemy-notify-token"
              type="password"
              autoComplete="off"
              value={notifyToken}
              onChange={(e) => setNotifyToken(e.target.value)}
              required
            />
          </Field>
          <Field label="Network">
            <input
              id="alchemy-network"
              value={network}
              onChange={(e) => setNetwork(e.target.value)}
              required
            />
          </Field>
          <p className="ui-actions">
            <Button type="submit">Save Alchemy source</Button>
          </p>
        </form>
      </Card>
    </>
  );
}

function HeliusForm() {
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState("Helius");
  const [apiKey, setApiKey] = useState("");
  const [notes, setNotes] = useState<string>();
  useEffect(() => {
    void api<{ adapters: Adapter[] }>("/api/v1/sources").then((body) => {
      const adapter = body.adapters.find((item) => item.id === "helius");
      setNotes(adapter?.capabilities?.lookbackNotes);
    });
  }, []);
  return (
    <>
      <PageHeader
        title="Add Helius source"
        description="Opt-in Solana transfer webhooks. Paste the Helius API key. Never paste a seed phrase or private key."
        actions={<SourcesSubnav />}
      />
      <Card>
        {notes ? <p className="field-note">{notes}</p> : null}
        <form
          className="stack-form"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/sources/helius", {
                method: "POST",
                body: JSON.stringify({ name, apiKey }),
              });
              toast("Helius saved");
              navigate("/sources");
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t save Helius"), "danger");
            }
          }}
        >
          <Field label="Source name">
            <input
              id="helius-source-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field label="API key" hint="Stored encrypted. Never shown again.">
            <input
              id="helius-api-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
            />
          </Field>
          <p className="ui-actions">
            <Button type="submit">Save Helius source</Button>
          </p>
        </form>
      </Card>
    </>
  );
}

function DiscordForm() {
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState("Discord");
  const [botToken, setBotToken] = useState("");
  const [guildId, setGuildId] = useState("");
  const [applicationId, setApplicationId] = useState("");
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [excludeChannelIds, setExcludeChannelIds] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [lookbackHours, setLookbackHours] = useState("6");
  const [notes, setNotes] = useState<string>();
  const [botPermissions, setBotPermissions] = useState<number>();
  useEffect(() => {
    void api<{ adapters: Adapter[] }>("/api/v1/sources").then((body) => {
      const discord = body.adapters.find((item) => item.id === "discord");
      setNotes(discord?.capabilities?.lookbackNotes);
      setBotPermissions(discord?.botPermissions);
    });
  }, []);
  const clientId = DISCORD_SNOWFLAKE.test(applicationId)
    ? applicationId
    : applicationIdFromBotToken(botToken);
  const inviteUrl =
    clientId && botPermissions ? discordBotInviteUrl(clientId, botPermissions) : undefined;
  return (
    <>
      <PageHeader
        title="Add Discord source"
        description="Requires MESSAGE_CONTENT, VIEW_CHANNEL and READ_MESSAGE_HISTORY. Embeds, archived public threads, and reaction counts are ingested. Add another Discord source for a second server."
        actions={<SourcesSubnav />}
      />
      <Card>
        {inviteUrl ? (
          <ExternalLink href={inviteUrl}>Invite bot with required permissions</ExternalLink>
        ) : (
          <p className="field-note">
            Discord’s invite URL needs an Application ID (`client_id`). Without it Discord returns
            “Invalid Form Body”. Paste the Application ID from Developer Portal → General
            Information, or paste the bot token first.
          </p>
        )}
        {botPermissions ? <code>Permissions: {botPermissions}</code> : null}
        {notes ? <p className="field-note">{notes}</p> : null}
        <form
          autoComplete="off"
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
              id="discord-source-name"
              name="discord-source-name"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Application id"
            hint="Developer Portal → General Information. Builds the invite link. Not required to save the source."
          >
            <input
              id="discord-application-id"
              name="discord-application-id"
              inputMode="numeric"
              autoComplete="off"
              value={applicationId}
              onChange={(e) => setApplicationId(e.target.value)}
            />
          </Field>
          <Field
            label="Server id"
            hint="Optional if channel IDs are enough. Enable Developer Mode in Discord to copy IDs."
          >
            <input
              id="discord-server-id"
              name="discord-server-id"
              inputMode="numeric"
              autoComplete="off"
              value={guildId}
              onChange={(e) => setGuildId(e.target.value)}
            />
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
            hint="1–72. Word-boundary keywords only. Discord does not provide message-search archive access here."
          >
            <input
              id="discord-lookback-hours"
              name="discord-lookback-hours"
              type="number"
              min={1}
              max={72}
              autoComplete="off"
              value={lookbackHours}
              onChange={(e) => setLookbackHours(e.target.value)}
            />
          </Field>
          <Field label="Bot token" hint="Stored encrypted. Never shown again.">
            <input
              id="discord-bot-token"
              name="discord-bot-token"
              type="password"
              autoComplete="new-password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              required
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
  const [keywords, setKeywords] = useState<string[]>([]);
  const [xLookbackHours, setXLookbackHours] = useState("24");
  const [monthlyReadBudget, setMonthlyReadBudget] = useState("5000");
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
        description="Named-principal recent search only. Authors are required. Availability depends on your X API plan and remaining credits."
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
                  keywords,
                  lookbackHours: Number(xLookbackHours),
                  monthlyReadBudget: Number(monthlyReadBudget),
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
          <Field
            label="Authors"
            hint="Named principals, max 30. Mentions-only sources are rejected. Type a handle and press Enter."
          >
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
          <Field label="Keywords" hint="Optional. ANDed with the author watchlist, not ORed.">
            <ChipInput
              id="x-search-keywords"
              values={keywords}
              onChange={setKeywords}
              placeholder="ETF"
            />
          </Field>
          <Field
            label="Lookback hours"
            hint="Used until the first successful fetch. After that, start_time is the last success, never earlier than 7 days. Archive search is not used."
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
          <Field
            label="Monthly read budget"
            hint="Default 5,000. Ceiling 40,000. Polling stops when this many posts have been returned this UTC month."
          >
            <input
              id="x-monthly-read-budget"
              type="number"
              min={10}
              max={40000}
              value={monthlyReadBudget}
              onChange={(e) => setMonthlyReadBudget(e.target.value)}
              required
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

function EdgarForm() {
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState("SEC EDGAR");
  const [contactEmail, setContactEmail] = useState("");
  const [notes, setNotes] = useState<string>();
  useEffect(() => {
    void api<{ adapters: Adapter[] }>("/api/v1/sources").then((body) => {
      const adapter = body.adapters.find((item) => item.id === "edgar");
      setNotes(adapter?.capabilities?.lookbackNotes);
    });
  }, []);
  return (
    <>
      <PageHeader
        title="Add SEC EDGAR source"
        description="Opt-in SEC filings. The SEC requires User-Agent Riddlr/<version> plus an operator contact email. Equities agents keep watched issuers. Crypto agents search EFTS keywords only."
        actions={<SourcesSubnav />}
      />
      <Card>
        {notes ? <p className="field-note">{notes}</p> : null}
        <form
          className="stack-form"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/sources/edgar", {
                method: "POST",
                body: JSON.stringify({
                  name,
                  contactEmail,
                }),
              });
              toast("EDGAR saved");
              navigate("/sources");
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t save EDGAR"), "danger");
            }
          }}
        >
          <Field label="Source name">
            <input
              id="edgar-source-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Contact email"
            hint="SEC User-Agent is Riddlr/0.1 plus this address. Do not use a Mozilla string or a GitHub URL."
          >
            <input
              id="edgar-contact-email"
              type="email"
              autoComplete="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              required
            />
          </Field>
          <p className="ui-actions">
            <Button type="submit">Save EDGAR source</Button>
          </p>
        </form>
      </Card>
    </>
  );
}

function SourceCreate() {
  const { adapter } = useParams();
  if (adapter === "feeds") {
    return <FeedForm />;
  }
  if (adapter === "defillama") {
    return <DefiLlamaForm />;
  }
  if (adapter === "hyperliquid") {
    return <HyperliquidForm />;
  }
  if (adapter === "binance-futures") {
    return <BinanceFuturesForm />;
  }
  if (adapter === "polymarket") {
    return <PolymarketForm />;
  }
  if (adapter === "kalshi") {
    return <KalshiForm />;
  }
  if (adapter === "snapshot") {
    return <SnapshotForm />;
  }
  if (adapter === "edgar") {
    return <EdgarForm />;
  }
  if (adapter === "alchemy") {
    return <AlchemyForm />;
  }
  if (adapter === "helius") {
    return <HeliusForm />;
  }
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
            <NavLink to={`/sources/${row.id}/edit`} className="ui-button ui-button-primary">
              Edit source
            </NavLink>
          </>
        }
      />
      <p className="record-meta">
        <StatusBadge label={row.enabled ? "Enabled" : "Paused"} />
        <span>{adapterLabel(row.adapterId)}</span>
      </p>
      {row.adapterId === "searxng" ? (
        <Card>
          <h2>News queries</h2>
          <p className="field-note">
            Each scan runs one <code>categories=news</code> query per watched asset, capped at 12,
            plus one domain-general query. Results are deduped by canonical URL. Search hits stay
            mentions until enrichment. Price-tracker hosts cannot produce claims.
          </p>
          <p className="field-note">
            Engine allowlist:{" "}
            {Array.isArray(config.engines) && config.engines.length > 0
              ? config.engines.map(String).join(", ")
              : "all JSON engines on the bundled instance"}
          </p>
        </Card>
      ) : null}
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
          <h2>Keywords</h2>
          <ChipList values={keywords} empty="None" />
          <p className="field-note">
            Monthly read budget{" "}
            {typeof config.monthlyReadBudget === "number" ? config.monthlyReadBudget : 5000}. Last
            successful fetch{" "}
            {typeof config.lastSuccessAt === "string" ? config.lastSuccessAt : "none yet"}.
          </p>
        </Card>
      ) : null}
      {row.adapterId === "feeds" ? (
        <Card>
          <h2>Feed</h2>
          <p className="field-note">
            {typeof config.feedUrl === "string" ? config.feedUrl : "No URL"}
          </p>
          <p className="record-meta">
            <span>
              Trust{" "}
              {(typeof config.trustTier === "string" ? config.trustTier : "community").replaceAll(
                "_",
                " ",
              )}
            </span>
            <span>
              Poll{" "}
              {typeof config.pollIntervalSeconds === "number" ? config.pollIntervalSeconds : 300}s
            </span>
          </p>
        </Card>
      ) : null}
      {row.adapterId === "defillama" ? (
        <Card>
          <h2>DefiLlama</h2>
          <p className="field-note">
            Personal, non-commercial terms. Operator-local cache only. Poll every 15 minutes for TVL
            and stablecoins; hacks hourly. Watchlist gecko_id maps to protocol slugs.
          </p>
          <h2>Pinned chains</h2>
          <ChipList
            values={Array.isArray(config.chainSlugs) ? config.chainSlugs.map(String) : []}
            empty="No chain TVL"
          />
          <h2>Extra protocol slugs</h2>
          <ChipList
            values={Array.isArray(config.protocolSlugs) ? config.protocolSlugs.map(String) : []}
            empty="Watchlist mapping only"
          />
        </Card>
      ) : null}
      {row.adapterId === "hyperliquid" ? (
        <Card>
          <h2>Hyperliquid</h2>
          <p className="field-note">
            Free info endpoint, no key. Polls once per minute. Watchlist symbols map through the
            registry; pin hyperliquid:COIN for an unmapped perp.
          </p>
        </Card>
      ) : null}
      {row.adapterId === "binance-futures" ? (
        <Card>
          <h2>Binance USD-M Futures</h2>
          <p className="field-note">
            Public REST, no key. premiumIndex every minute; open interest every 5 minutes.
            Liquidations use the bounded !forceOrder@arr stream. Compare funding to Hyperliquid on
            funding_rate_apr only. HTTP 451 means disable this source for this region.
          </p>
          <h2>Quote assets</h2>
          <ChipList
            values={Array.isArray(config.quoteAssets) ? config.quoteAssets.map(String) : []}
            empty="USDT, USDC, BUSD"
          />
        </Card>
      ) : null}
      {row.adapterId === "polymarket" ? (
        <Card>
          <h2>Polymarket</h2>
          <p className="field-note">
            Free Gamma and CLOB reads, no key. Polls every 15 minutes. Pin slugs here or
            polymarket:slug on Health. Closed markets are unsubscribed. Odds jumps are early
            warnings until an official document corroborates.
          </p>
          <h2>Market slugs</h2>
          <ChipList
            values={Array.isArray(config.marketSlugs) ? config.marketSlugs.map(String) : []}
            empty="Watchlist and macro suggestions only"
          />
        </Card>
      ) : null}
      {row.adapterId === "kalshi" ? (
        <Card>
          <h2>Kalshi</h2>
          <p className="field-note">
            Public Trade API v2, no key. Polls every 15 minutes. Pin series such as KXCPI. Markets
            listed as status=active still count as open. Never fetch the unfiltered series list.
          </p>
          <h2>Series tickers</h2>
          <ChipList
            values={Array.isArray(config.seriesTickers) ? config.seriesTickers.map(String) : []}
            empty="No series pinned"
          />
          <h2>Market tickers</h2>
          <ChipList
            values={Array.isArray(config.marketTickers) ? config.marketTickers.map(String) : []}
            empty="Every open market in the pinned series"
          />
        </Card>
      ) : null}
      {row.adapterId === "snapshot" ? (
        <Card>
          <h2>Snapshot</h2>
          <p className="field-note">
            Free GraphQL at hub.snapshot.org, no key. Hub rate limit 100/min. Spaces on this form
            plus watchlist mapping (Aave, Uniswap, Compound, ENS). Native-complete proposals. Tally
            is not shipped.
          </p>
          <h2>Spaces</h2>
          <ChipList
            values={Array.isArray(config.spaces) ? config.spaces.map(String) : []}
            empty="Watchlist mapping only"
          />
        </Card>
      ) : null}
      {row.adapterId === "edgar" ? (
        <Card>
          <h2>SEC EDGAR</h2>
          <p className="field-note">
            User-Agent Riddlr/0.1 plus the contact email on this source. Fair-use cap 10 requests/s.
            Equities agents filter Atom by watchlist CIKs. Crypto agents use EFTS keyword search,
            one query per watched keyword per hour.
          </p>
          <p className="record-meta">
            Contact email: {typeof config.contactEmail === "string" ? config.contactEmail : "unset"}
          </p>
        </Card>
      ) : null}
      {row.adapterId === "alchemy" ? (
        <Card>
          <h2>Alchemy</h2>
          <p className="field-note">
            ADDRESS_ACTIVITY inbound webhooks. Notify token encrypted. Signing key encrypted.
            Webhook URL is {window.location.origin}/hooks/alchemy/{row.id}. Caddy must proxy
            /hooks/* to the API. Balances are not shipped.
          </p>
        </Card>
      ) : null}
      {row.adapterId === "helius" ? (
        <Card>
          <h2>Helius</h2>
          <p className="field-note">
            Enhanced TRANSFER inbound webhooks. API key encrypted. Auth header encrypted. Webhook
            URL is {window.location.origin}/hooks/helius/{row.id}. Balances are not shipped.
          </p>
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
  const [engines, setEngines] = useState("");
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
        const current = body.source.config?.engines;
        setEngines(Array.isArray(current) ? current.map(String).join(", ") : "");
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
                body: JSON.stringify({
                  name,
                  enabled,
                  ...(row.adapterId === "searxng" ? { config: { engines } } : {}),
                }),
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
          {row.adapterId === "searxng" ? (
            <Field label="Engine allowlist">
              <input
                id="searxng-engines"
                value={engines}
                onChange={(e) => setEngines(e.target.value)}
                placeholder="Leave empty for every JSON engine"
              />
              <p className="field-note">
                Comma-separated SearXNG engine names, for example <code>bing news, reuters</code>.
                Empty means every engine enabled on the bundled instance. The search endpoint is not
                editable here.
              </p>
            </Field>
          ) : null}
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
