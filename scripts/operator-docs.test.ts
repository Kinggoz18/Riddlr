import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const SHIPPED_INTEGRATION_PAGES = [
  "alchemy.md",
  "binance-futures.md",
  "coingecko.md",
  "coinmarketcap.md",
  "cryptocom.md",
  "defillama.md",
  "discord-webhooks.md",
  "discord.md",
  "edgar.md",
  "feeds.md",
  "helius.md",
  "hyperliquid.md",
  "kalshi.md",
  "llm.md",
  "openfigi.md",
  "polymarket.md",
  "searxng.md",
  "snapshot.md",
  "telegram.md",
  "whatsapp.md",
  "x.md",
] as const;

describe("operator integration docs", () => {
  it("ships an integrations page with failure classes and fixtures for every shipped API", () => {
    const dir = join(root, "docs/integrations");
    const present = new Set(readdirSync(dir).filter((name) => name.endsWith(".md")));
    for (const name of SHIPPED_INTEGRATION_PAGES) {
      expect(present.has(name), name).toBe(true);
      const text = readFileSync(join(dir, name), "utf8");
      expect(text, name).toMatch(/^## Failure classes$/m);
      expect(text, name).toMatch(/^## Fixtures$/m);
    }
  });

  it("keeps observations and catalysts operator pages", () => {
    const observations = readFileSync(join(root, "docs/observations.md"), "utf8");
    expect(observations).toMatch(/^## Not shipped$/m);
    expect(observations).toMatch(/FRED/);
    const catalysts = readFileSync(join(root, "docs/catalysts.md"), "utf8");
    expect(catalysts).toMatch(/^## Equities mapping$/m);
    expect(catalysts).toContain("equities:earnings");
    expect(existsSync(join(root, "docs/sources/edgar.md"))).toBe(true);
    expect(existsSync(join(root, "docs/sources/coinmarketcap.md"))).toBe(true);
  });

  it("keeps dated Crypto.com ticker fixtures and records the CoinMarketCap capture gap", () => {
    const fixtures = join(root, "packages/source-adapters/test/fixtures");
    expect(existsSync(join(fixtures, "cryptocom/get-tickers-btc-usd.json"))).toBe(true);
    const readme = readFileSync(join(fixtures, "README.md"), "utf8");
    expect(readme).toMatch(/cryptocom\/get-tickers-btc-usd\.json/);
    expect(readme).toMatch(/CoinMarketCap quotes are not in this directory/);
    const cmc = readFileSync(join(root, "docs/integrations/coinmarketcap.md"), "utf8");
    expect(cmc).toMatch(/Live capture needs a Pro key/);
  });
});
