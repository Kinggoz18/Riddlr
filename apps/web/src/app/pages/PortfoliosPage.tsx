import { Button, Card, EmptyState, Field } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { api } from "../api.js";

function PortfoliosPage() {
  const [rows, setRows] = useState<
    Array<{
      id: string;
      name: string;
      wallets: Array<{ id: string; chain: string; address: string }>;
      holdings: Array<{ id: string; canonicalId: string; quantity?: string | null }>;
    }>
  >([]);
  const [onchain, setOnchain] = useState<string>();
  const [name, setName] = useState("");
  const [chain, setChain] = useState("ethereum");
  const [address, setAddress] = useState("");
  const [canonicalId, setCanonicalId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [selected, setSelected] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  async function reload() {
    const body = await api<{
      portfolios: typeof rows;
      onchain?: { message?: string };
    }>("/api/v1/portfolios");
    setRows(body.portfolios);
    setOnchain(body.onchain?.message);
  }

  useEffect(() => {
    void reload()
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
      <h1>Portfolios</h1>
      <p style={{ color: "var(--muted)" }}>
        Read-only. Holdings are operator-declared. Addresses are public identifiers. Never paste a
        seed phrase or private key.
      </p>
      {onchain ? <p>{onchain}</p> : null}
      {message ? <p>{message}</p> : null}
      {rows.length === 0 ? (
        <EmptyState
          title="No portfolios"
          body="Create a named book of public addresses and declared holdings."
        />
      ) : (
        rows.map((row) => (
          <Card key={row.id}>
            <h2>{row.name}</h2>
            <p>
              {row.wallets.length} wallets · {row.holdings.length} holdings
            </p>
            <ul>
              {row.wallets.map((wallet) => (
                <li key={wallet.id}>
                  {wallet.chain}: {wallet.address}
                </li>
              ))}
              {row.holdings.map((holding) => (
                <li key={holding.id}>
                  {holding.canonicalId}
                  {holding.quantity ? ` · ${holding.quantity}` : ""}
                </li>
              ))}
            </ul>
            <Button onClick={() => setSelected(row.id)}>Add to this portfolio</Button>
          </Card>
        ))
      )}
      <Card>
        <h2>Create portfolio</h2>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/portfolios", {
                method: "POST",
                body: JSON.stringify({ name }),
              });
              setName("");
              setMessage("Portfolio created.");
              await reload();
            } catch (err: unknown) {
              setMessage(err instanceof Error ? err.message : "Save failed");
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
      {selected ? (
        <Card>
          <h2>Add wallet or holding</h2>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await api(`/api/v1/portfolios/${selected}/wallets`, {
                  method: "POST",
                  body: JSON.stringify({ chain, address }),
                });
                setAddress("");
                setMessage("Wallet saved.");
                await reload();
              } catch (err: unknown) {
                setMessage(err instanceof Error ? err.message : "Save failed");
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
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await api(`/api/v1/portfolios/${selected}/holdings`, {
                  method: "POST",
                  body: JSON.stringify({
                    canonicalId,
                    quantity: quantity || undefined,
                  }),
                });
                setCanonicalId("");
                setQuantity("");
                setMessage("Holding saved.");
                await reload();
              } catch (err: unknown) {
                setMessage(err instanceof Error ? err.message : "Save failed");
              }
            }}
          >
            <Field label="Canonical id" hint="Example: coingecko:bitcoin">
              <input
                id="canonical-id"
                value={canonicalId}
                onChange={(e) => setCanonicalId(e.target.value)}
                required
              />
            </Field>
            <Field label="Quantity" hint="Operator-declared. Not fetched from chain.">
              <input id="quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </Field>
            <Button type="submit">Add holding</Button>
          </form>
        </Card>
      ) : null}
    </>
  );
}
export { PortfoliosPage };
