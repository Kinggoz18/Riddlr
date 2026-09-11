import { Button, Card, EmptyState, Field, PageHeader, StatusBadge } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { AssetPicker } from "../AssetPicker.js";
import { api } from "../api.js";
import { assetLabel, compactMoney, marketProviderLabel, money } from "../format.js";
import { PageSubnav } from "../PageSubnav.js";
import { toastFail, useToast } from "../Toast.js";

type Holding = {
  id: string;
  canonicalId: string;
  quantity?: string | null;
  symbol?: string | null;
  name?: string | null;
};
type Wallet = { id: string; chain: string; address: string };
type Quote = {
  canonicalId: string;
  symbol?: string;
  name?: string;
  priceUsd: number;
  change24h?: number;
};
type Market = { provider: string | null; quotes: Quote[] };
type Portfolio = {
  id: string;
  name: string;
  wallets: Wallet[];
  holdings: Holding[];
};

function PortfoliosSubnav() {
  return (
    <PageSubnav
      label="Portfolios"
      items={[
        { to: "/portfolios", label: "View portfolios", end: true },
        { to: "/portfolios/new", label: "Create portfolio" },
      ]}
    />
  );
}

function quoteFor(market: Market | undefined, canonicalId: string) {
  return market?.quotes.find((item) => item.canonicalId === canonicalId);
}

function holdingValue(holding: Holding, quote?: Quote) {
  if (!quote || !holding.quantity) {
    return undefined;
  }
  return Number(holding.quantity) * quote.priceUsd;
}

function holdingPnl(holding: Holding, quote?: Quote) {
  const value = holdingValue(holding, quote);
  if (value === undefined || quote?.change24h === undefined) {
    return undefined;
  }
  const previous = value / (1 + quote.change24h / 100);
  return value - previous;
}

function markedTotal(holdings: Holding[], market: Market | undefined) {
  return holdings.reduce((sum, holding) => {
    return sum + (holdingValue(holding, quoteFor(market, holding.canonicalId)) ?? 0);
  }, 0);
}

function PortfolioList() {
  const [rows, setRows] = useState<Portfolio[]>([]);
  const [market, setMarket] = useState<Market>();
  const [onchain, setOnchain] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void api<{ portfolios: Portfolio[]; market?: Market; onchain?: { message?: string } }>(
      "/api/v1/portfolios",
    )
      .then((body) => {
        setRows(body.portfolios);
        setMarket(body.market);
        setOnchain(body.onchain?.message);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);
  if (loading) {
    return <p>Loading portfolios…</p>;
  }
  if (error) {
    return <EmptyState title="Unable to load portfolios" body={error} />;
  }
  return (
    <>
      <PageHeader
        title="Portfolios"
        description="Read-only public addresses and declared holdings. On-chain scanning is not implemented."
        actions={<PortfoliosSubnav />}
      />
      <p className="safety-note">
        Public addresses only. Never enter a seed phrase or private key.
      </p>
      {onchain ? <p className="field-note">{onchain}</p> : null}
      {market?.provider ? (
        <p className="field-note">Live marks from {marketProviderLabel(market.provider)}.</p>
      ) : (
        <p className="field-note">
          Enable CoinGecko, CoinMarketCap, or Crypto.com Exchange under Sources to show USD marks.
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState
          title="No portfolios"
          body="Create a named book of public addresses and declared holdings."
          action={
            <NavLink to="/portfolios/new" className="ui-button ui-button-primary">
              Create portfolio
            </NavLink>
          }
        />
      ) : (
        <section className="portfolio-grid">
          {rows.map((row) => {
            const total = markedTotal(row.holdings, market);
            const pnl = row.holdings.reduce((sum, holding) => {
              return sum + (holdingPnl(holding, quoteFor(market, holding.canonicalId)) ?? 0);
            }, 0);
            return (
              <NavLink key={row.id} to={`/portfolios/${row.id}`} className="portfolio-tile">
                <p className="record-meta">
                  <span>{row.holdings.length} holdings</span>
                  <span>{row.wallets.length} wallets</span>
                </p>
                <h2>{row.name}</h2>
                <p className="portfolio-total">
                  {market?.provider && total > 0 ? money.format(total) : "No live marks"}
                </p>
                {market?.provider && total > 0 ? (
                  <p className={pnl >= 0 ? "pnl-up" : "pnl-down"}>
                    {pnl >= 0 ? "+" : ""}
                    {compactMoney.format(pnl)} 24h
                  </p>
                ) : (
                  <p className="record-meta">Add holdings to mark against the live source</p>
                )}
              </NavLink>
            );
          })}
        </section>
      )}
    </>
  );
}

function PortfolioCreate() {
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  return (
    <>
      <PageHeader
        title="Create portfolio"
        description="A named book. Holdings are operator-declared."
        actions={<PortfoliosSubnav />}
      />
      <Card>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              const result = await api<{ portfolio: { id: string } }>("/api/v1/portfolios", {
                method: "POST",
                body: JSON.stringify({ name }),
              });
              toast("Portfolio created");
              navigate(result.portfolio?.id ? `/portfolios/${result.portfolio.id}` : "/portfolios");
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t create portfolio"), "danger");
            }
          }}
        >
          <Field label="Portfolio name">
            <input
              id="portfolio-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Button type="submit">Create portfolio</Button>
        </form>
      </Card>
    </>
  );
}

function usePortfolio(id: string | undefined) {
  const [name, setName] = useState("");
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [market, setMarket] = useState<Market>();
  const [missing, setMissing] = useState(false);

  async function reload() {
    if (!id) {
      return;
    }
    const body = await api<{
      portfolio: { name: string };
      wallets: Wallet[];
      holdings: Holding[];
      market?: Market;
    }>(`/api/v1/portfolios/${id}`);
    setName(body.portfolio.name);
    setWallets(body.wallets);
    setHoldings(body.holdings);
    setMarket(body.market);
  }

  useEffect(() => {
    void reload().catch(() => setMissing(true));
  }, [id]);

  return { name, wallets, holdings, market, missing, reload };
}

function PortfolioDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { name, wallets, holdings, market, missing } = usePortfolio(id);

  if (missing) {
    return <EmptyState title="Portfolio not found" body="This portfolio does not exist." />;
  }
  if (!name) {
    return <p>Loading portfolio…</p>;
  }
  const total = markedTotal(holdings, market);
  const pnl = holdings.reduce((sum, holding) => {
    return sum + (holdingPnl(holding, quoteFor(market, holding.canonicalId)) ?? 0);
  }, 0);
  const live = Boolean(market?.provider && total > 0);

  return (
    <>
      <PageHeader
        title={name}
        description="Declared holdings with live marks when a market-data source is enabled."
        actions={
          <>
            <PortfoliosSubnav />
            <NavLink to={`/portfolios/${id}/edit`} className="ui-button ui-button-primary">
              Edit portfolio
            </NavLink>
          </>
        }
      />
      <p className="safety-note">
        Public addresses only. Never enter a seed phrase or private key.
      </p>
      <section className="portfolio-hero">
        <div>
          <span>Marked value</span>
          <strong>{live ? money.format(total) : "—"}</strong>
          {live ? (
            <small className={pnl >= 0 ? "pnl-up" : "pnl-down"}>
              {pnl >= 0 ? "+" : ""}
              {compactMoney.format(pnl)} 24h
            </small>
          ) : (
            <small>Enable a market source under Sources for USD marks.</small>
          )}
        </div>
        <div>
          <span>Market source</span>
          <strong>{marketProviderLabel(market?.provider)}</strong>
        </div>
        <div>
          <span>Holdings</span>
          <strong>{holdings.length}</strong>
        </div>
      </section>
      {live ? (
        <div className="allocation-bar" aria-hidden="true">
          {holdings.map((holding) => {
            const value = holdingValue(holding, quoteFor(market, holding.canonicalId)) ?? 0;
            const share = total > 0 ? (value / total) * 100 : 0;
            return <span key={holding.id} style={{ width: `${share}%` }} />;
          })}
        </div>
      ) : null}
      <Card>
        <h2>Holdings</h2>
        {holdings.length === 0 ? (
          <p className="quiet-state">No holdings yet</p>
        ) : (
          <table className="holdings-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Quantity</th>
                <th>Mark</th>
                <th>Value</th>
                <th>Weight</th>
                <th>24h</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((holding) => {
                const quote = quoteFor(market, holding.canonicalId);
                const value = holdingValue(holding, quote);
                const weight = live && value !== undefined ? (value / total) * 100 : undefined;
                return (
                  <tr key={holding.id}>
                    <td>
                      {holding.name || assetLabel(holding.canonicalId)}
                      <small>{holding.symbol || holding.canonicalId.split(":")[1]}</small>
                    </td>
                    <td>{holding.quantity ?? "—"}</td>
                    <td>{quote ? money.format(quote.priceUsd) : "—"}</td>
                    <td>{value !== undefined ? compactMoney.format(value) : "—"}</td>
                    <td>{weight !== undefined ? `${weight.toFixed(1)}%` : "—"}</td>
                    <td>
                      {quote?.change24h !== undefined ? (
                        <StatusBadge
                          label={`${quote.change24h >= 0 ? "+" : ""}${quote.change24h.toFixed(2)}%`}
                          tone={quote.change24h < 0 ? "danger" : "ok"}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      <Card>
        <h2>Wallets</h2>
        {wallets.length === 0 ? (
          <p className="quiet-state">No wallets</p>
        ) : (
          <ul className="data-list">
            {wallets.map((wallet) => (
              <li key={wallet.id}>
                <span>
                  {wallet.chain}
                  <small>{wallet.address}</small>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p>
        <Button
          variant="danger"
          onClick={async () => {
            try {
              await api(`/api/v1/portfolios/${id}`, { method: "DELETE" });
              toast("Portfolio deleted");
              navigate("/portfolios");
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t delete portfolio"), "danger");
            }
          }}
        >
          Delete portfolio
        </Button>
      </p>
    </>
  );
}

function PortfolioEdit() {
  const { id } = useParams();
  const toast = useToast();
  const { name, wallets, holdings, market, missing, reload } = usePortfolio(id);
  const [chain, setChain] = useState("ethereum");
  const [address, setAddress] = useState("");
  const [canonicalIds, setCanonicalIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState("");

  if (missing) {
    return <EmptyState title="Portfolio not found" body="This portfolio does not exist." />;
  }
  if (!name) {
    return <p>Loading portfolio…</p>;
  }

  return (
    <>
      <PageHeader
        title={`Edit ${name}`}
        description="Add or remove declared holdings and public addresses."
        actions={<PortfoliosSubnav />}
      />
      <p className="safety-note">
        Public addresses only. Never enter a seed phrase or private key.
      </p>
      <Card>
        <h2>Holdings</h2>
        {holdings.length === 0 ? (
          <p className="quiet-state">No holdings yet</p>
        ) : (
          <ul className="data-list">
            {holdings.map((holding) => {
              const quote = quoteFor(market, holding.canonicalId);
              const value = holdingValue(holding, quote);
              return (
                <li key={holding.id}>
                  <span>
                    {holding.name || assetLabel(holding.canonicalId)}
                    <small>
                      {holding.quantity ?? "—"}
                      {value !== undefined ? ` · ${compactMoney.format(value)}` : ""}
                    </small>
                  </span>
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await api(`/api/v1/portfolios/${id}/holdings/${holding.id}`, {
                          method: "DELETE",
                        });
                        toast("Holding removed");
                        await reload();
                      } catch (err: unknown) {
                        toast(toastFail(err, "Couldn’t remove holding"), "danger");
                      }
                    }}
                  >
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const canonicalId = canonicalIds[0];
            if (!canonicalId || !id) {
              return;
            }
            try {
              await api(`/api/v1/portfolios/${id}/holdings`, {
                method: "POST",
                body: JSON.stringify({ canonicalId, quantity: quantity || undefined }),
              });
              setCanonicalIds([]);
              setQuantity("");
              toast("Holding added");
              await reload();
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t add holding"), "danger");
            }
          }}
        >
          <Field label="Holding" hint="Pick one named asset.">
            <AssetPicker
              id="canonical-id"
              values={canonicalIds}
              onChange={setCanonicalIds}
              single
            />
          </Field>
          <Field label="Quantity" hint="Operator-declared. Not fetched from chain.">
            <input id="quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Button type="submit">Add holding</Button>
        </form>
      </Card>
      <Card>
        <h2>Wallets</h2>
        {wallets.length === 0 ? (
          <p className="quiet-state">No wallets</p>
        ) : (
          <ul className="data-list">
            {wallets.map((wallet) => (
              <li key={wallet.id}>
                <span>
                  {wallet.chain}
                  <small>{wallet.address}</small>
                </span>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await api(`/api/v1/portfolios/${id}/wallets/${wallet.id}`, {
                        method: "DELETE",
                      });
                      toast("Wallet removed");
                      await reload();
                    } catch (err: unknown) {
                      toast(toastFail(err, "Couldn’t remove wallet"), "danger");
                    }
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api(`/api/v1/portfolios/${id}/wallets`, {
                method: "POST",
                body: JSON.stringify({ chain, address }),
              });
              setAddress("");
              toast("Wallet added");
              await reload();
            } catch (err: unknown) {
              toast(toastFail(err, "Couldn’t add wallet"), "danger");
            }
          }}
        >
          <Field label="Chain">
            <select id="chain" value={chain} onChange={(e) => setChain(e.target.value)}>
              <option value="ethereum">ethereum</option>
              <option value="bitcoin">bitcoin</option>
              <option value="solana">solana</option>
              <option value="other">other</option>
            </select>
          </Field>
          <Field label="Wallet address" hint="Public identifier only.">
            <input
              id="wallet-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
            />
          </Field>
          <Button type="submit">Add wallet</Button>
        </form>
      </Card>
      <p className="ui-actions">
        <NavLink to={`/portfolios/${id}`} className="ui-button ui-button-ghost">
          Back to portfolio
        </NavLink>
      </p>
    </>
  );
}

function PortfoliosPage() {
  return (
    <Routes>
      <Route index element={<PortfolioList />} />
      <Route path="new" element={<PortfolioCreate />} />
      <Route path=":id" element={<PortfolioDetail />} />
      <Route path=":id/edit" element={<PortfolioEdit />} />
    </Routes>
  );
}

export { PortfoliosPage };
