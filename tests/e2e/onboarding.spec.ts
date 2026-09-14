import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { totpFromOtpauth } from "./totp.js";

test.describe.configure({ mode: "serial" });

const password = process.env.RIDDLR_E2E_PASSWORD ?? "correct horse battery";
const email = process.env.RIDDLR_E2E_EMAIL ?? "ops@example.com";
const otpauth = process.env.RIDDLR_E2E_OTPAUTH ?? "";

async function signIn(page: Page) {
  await page.goto("/");
  const overview = page.getByRole("heading", { name: "Overview" });
  const signin = page.getByRole("heading", { name: "Welcome back" });
  await expect(overview.or(signin)).toBeVisible({ timeout: 15_000 });
  if (await overview.isVisible()) {
    return;
  }
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  const totp = page.getByLabel("Authenticator or recovery code");
  if (await totp.isVisible()) {
    if (!otpauth) {
      throw new Error("Authenticator is enabled; set RIDDLR_E2E_OTPAUTH.");
    }
    await totp.fill(totpFromOtpauth(otpauth));
    await page.getByRole("button", { name: "Verify" }).click();
  }
  await expect(overview).toBeVisible();
}

async function expectNoSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((item) => item.impact === "serious" || item.impact === "critical"),
  ).toEqual([]);
}

test("first-run onboarding is four steps with crypto supported and other domains coming soon @a11y", async ({
  page,
}) => {
  await page.goto("/");
  const setupHeading = page.getByRole("heading", { name: "Set up Riddlr" });
  const alreadySetUp = page
    .getByRole("heading", { name: "Welcome back" })
    .or(page.getByRole("heading", { name: "Overview" }));
  await expect(setupHeading.or(alreadySetUp)).toBeVisible({ timeout: 15_000 });
  if (!(await setupHeading.isVisible())) {
    test.skip(true, "Compose stack is already set up");
  }
  await expect(page.getByRole("list", { name: "Setup steps" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Security" })).toBeVisible();
  await expect(page.getByText("Model")).toBeVisible();
  await expect(page.getByText("Sources")).toBeVisible();

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await expectNoSeriousAxe(page);
  await page.getByRole("button", { name: "Create administrator" }).click();

  await expect(page.getByRole("heading", { name: "Save your password" })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByRole("img", { name: "Google Authenticator QR code" })).toBeVisible();
  await expect(page.getByText(/Setup key/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip for now" })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByLabel("API key")).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip for now" })).toBeVisible();
  await page.getByLabel("API key").fill("sk-e2e-not-a-real-key");
  await page.getByRole("button", { name: "Save provider" }).click();
  await expect(page.getByRole("heading", { name: "Choose markets" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Crypto/ })).toBeChecked();
  for (const name of ["Equities", "Forex", "Commodities", "Macro"]) {
    await expect(page.getByRole("checkbox", { name: new RegExp(name) })).toBeDisabled();
  }
  await expect(page.getByText("Coming soon").first()).toBeVisible();
  await expectNoSeriousAxe(page);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible({ timeout: 20_000 });

  await signIn(page);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Riddlr Intelligence Agent")).toBeVisible();
});

test("dashboard surfaces, settings, health, and responsive layout @a11y", async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page);
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Appearance" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("link", { name: "Agents" }).click();
  await expect(page.getByText("Domains: crypto").first()).toBeVisible();
  await page.getByRole("link", { name: "Riddlr Intelligence Agent" }).click();
  await expect(page.getByRole("heading", { name: "Objectives" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notification routing" })).toBeVisible();
  await expect(page.getByText(/default Crypto watcher/i)).toBeVisible();
  await expect(page.getByText("General crypto intelligence")).toBeVisible();
  await page.getByRole("link", { name: "Agents", exact: true }).click();
  const watchlistAgent = page.getByRole("heading", { name: "Watchlist agent" });
  const watchlistLink = page.getByRole("link", { name: "Watchlist agent" });
  if ((await watchlistAgent.count()) === 0 && (await watchlistLink.count()) === 0) {
    await page.getByRole("link", { name: "Create agent" }).click();
    await page.getByLabel("Agent name").fill("Watchlist agent");
    await page.getByLabel("Description").fill("Watches Bitcoin for material events.");
    await page.getByLabel("Watchlist").fill("Bitcoin");
    await page.getByRole("option", { name: "Bitcoin · BTC", exact: true }).click();
    await page.getByRole("button", { name: "Create agent" }).click();
  }
  await expect(
    page.getByRole("link", { name: "Watchlist agent" }).or(watchlistAgent).first(),
  ).toBeVisible();
  await page.getByRole("link", { name: "Sources" }).click();
  await expect(page.getByRole("heading", { name: "Source identities" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Publisher hosts" })).toBeVisible();
  await page.getByRole("link", { name: "Add source" }).click();
  await expect(page.getByRole("heading", { name: "Discord" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "RSS/Atom" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "CoinGecko" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "CoinMarketCap" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Crypto.com Exchange" })).toBeVisible();
  await page.getByRole("link", { name: "Configure Discord" }).click();
  await expect(page.getByRole("heading", { name: "Add Discord source" })).toBeVisible();
  await expect(page.getByText(/MESSAGE_CONTENT/)).toBeVisible();
  await expect(page.getByText(/not guild message-search archive/i)).toBeVisible();
  await page.getByRole("link", { name: "Add source" }).click();
  await page.getByRole("link", { name: "Configure RSS/Atom" }).click();
  await expect(page.getByRole("heading", { name: "Add RSS/Atom source" })).toBeVisible();
  await expect(page.getByText(/If-None-Match/)).toBeVisible();
  await page.getByRole("link", { name: "Add source" }).click();
  await page.getByRole("link", { name: "Configure DefiLlama" }).click();
  await expect(page.getByRole("heading", { name: "Add DefiLlama source" })).toBeVisible();
  await expect(page.getByText(/Personal, non-commercial/i)).toBeVisible();
  await page.getByRole("link", { name: "Add source" }).click();
  await page.getByRole("link", { name: "Configure Hyperliquid" }).click();
  await expect(page.getByRole("heading", { name: "Add Hyperliquid source" })).toBeVisible();
  await expect(page.getByText(/No API key/i)).toBeVisible();
  await page.getByRole("link", { name: "Add source" }).click();
  await page.getByRole("link", { name: "Configure Binance USD-M Futures" }).click();
  await expect(
    page.getByRole("heading", { name: "Add Binance USD-M Futures source" }),
  ).toBeVisible();
  await expect(page.getByText(/annualised APR/i)).toBeVisible();
  await page.getByRole("link", { name: "Add source" }).click();
  await page.getByRole("link", { name: "Configure Polymarket" }).click();
  await expect(page.getByRole("heading", { name: "Add Polymarket source" })).toBeVisible();
  await expect(page.getByText(/No API key/i)).toBeVisible();
  await page.getByRole("link", { name: "Add source" }).click();
  await page.getByRole("link", { name: "Configure Kalshi" }).click();
  await expect(page.getByRole("heading", { name: "Add Kalshi source" })).toBeVisible();
  await expect(page.getByText(/KXCPI/i)).toBeVisible();
  await page.getByRole("link", { name: "Add source" }).click();
  await page.getByRole("link", { name: "Configure Snapshot" }).click();
  await expect(page.getByRole("heading", { name: "Add Snapshot source" })).toBeVisible();
  await expect(page.getByText(/No API key/i)).toBeVisible();
  await page.getByRole("link", { name: "Add source" }).click();
  await page.getByRole("link", { name: "Configure Alchemy" }).click();
  await expect(page.getByRole("heading", { name: "Add Alchemy source" })).toBeVisible();
  await expect(page.getByText(/Never paste a seed phrase or private key/i)).toBeVisible();
  await expect(page.getByText(/\/hooks\/\*/i)).toBeVisible();
  await page.getByRole("link", { name: "Add source" }).click();
  await page.getByRole("link", { name: "Configure Helius" }).click();
  await expect(page.getByRole("heading", { name: "Add Helius source" })).toBeVisible();
  await expect(page.getByText(/Never paste a seed phrase or private key/i)).toBeVisible();
  await page.getByRole("link", { name: "View sources" }).click();
  await expect(page.getByRole("heading", { name: "Labeled addresses" })).toBeVisible();
  await expect(page.getByText("coingecko.com")).toBeVisible();
  await page.getByRole("link", { name: "SearXNG", exact: true }).click();
  await expect(page.getByRole("heading", { name: "News queries" })).toBeVisible();
  await expect(page.getByText(/one query per watched asset/i)).toBeVisible();
  await page.getByRole("link", { name: "Edit source" }).click();
  await expect(page.getByLabel("Engine allowlist")).toBeVisible();
  await page.getByRole("link", { name: "Add source" }).click();
  await page.getByRole("link", { name: "Configure X" }).click();
  await expect(page.getByRole("heading", { name: "Add X source" })).toBeVisible();
  await expect(page.getByText("Recent search only", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Monthly read budget")).toBeVisible();
  await expect(page.getByText(/Named principals/i)).toBeVisible();
  await page.getByRole("link", { name: "Portfolios" }).click();
  await expect(page.getByText(/Never enter a seed phrase/i)).toBeVisible();
  await page.getByRole("link", { name: "Signals" }).click();
  await expect(page.getByText(/No signals|Signals/)).toBeVisible();
  await expect(page.getByText(/typed signals|Eight typed policies/i)).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByText("Connected").first()).toBeVisible();
  await expect(page.locator(".config-strip").getByText(/Key \d+/)).toBeVisible();
  await page.locator(".page-subnav").getByRole("link", { name: "Notifications" }).click();
  await expect(page.getByRole("heading", { name: "Telegram" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Discord webhook" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Observation alerts" })).toBeVisible();
  await expect(page.getByLabel("Unverified early warnings")).toBeVisible();
  await expect(page.getByLabel("Shadow assessments")).toBeVisible();
  await expect(page.getByRole("heading", { name: "WhatsApp Cloud API" })).toBeVisible();
  await page.locator(".page-subnav").getByRole("link", { name: "Security" }).click();
  await expect(page.getByRole("heading", { name: "Recovery codes" })).toBeVisible();
  await expect(page.getByText(/remaining/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Encryption" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Change password" })).toBeVisible();
  await page.locator(".page-subnav").getByRole("link", { name: "Sessions" }).click();
  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
  await expect(page.getByText("Current session")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear audit log" })).toBeVisible();
  await page.getByRole("link", { name: "Health" }).click();
  await expect(page.getByRole("heading", { name: "PostgreSQL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Observations" })).toBeVisible();
  await expect(page.getByText("Price data by CoinGecko")).toBeVisible();
  await expect(page.getByText("Concurrency")).toBeVisible();
  await expect(page.getByText("Enrichment backlog")).toBeVisible();
  await expect(page.getByText("Stale assessments")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) {
    await menu.click();
  }
  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Morning" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Spot price/ }).first()).toBeVisible();
  await expectNoSeriousAxe(page);
});

test("watchlists, notifications, 404, and tablet layout @a11y", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Events" }).click();
  await expect(page.getByRole("heading", { name: /Events/ })).toBeVisible();
  await page.getByRole("link", { name: "Scorecard" }).click();
  await expect(page.getByRole("heading", { name: "Scorecard" })).toBeVisible();
  await expect(page.getByText(/Signals emitted/i)).toBeVisible();
  await page.getByRole("link", { name: "Events" }).click();
  await expect(page.getByText(/Clusters of related evidence/i)).toBeVisible();
  const eventsResponse = await page.request.get("/api/v1/events?limit=50");
  expect(eventsResponse.ok()).toBeTruthy();
  const eventsBody = (await eventsResponse.json()) as {
    events: Array<{ id: string; title: string; reliabilityStatus?: string | null }>;
  };
  const observed = eventsBody.events.find((row) => row.reliabilityStatus === "observed");
  if (observed) {
    await page.getByRole("link", { name: observed.title }).click();
    await expect(page.getByRole("heading", { name: observed.title })).toBeVisible();
    await expect(page.getByText("Observed", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Open", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Observed anomaly").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sourced observations" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Claims" })).toBeVisible();
    await expect(page.getByText(/https?:\/\//i)).toHaveCount(0);
  } else {
    throw new Error("Expected an observed quantitative event on Events.");
  }
  await page.getByRole("link", { name: "Watchlists" }).click();
  await expect(page.getByRole("heading", { name: /Watchlists/i })).toBeVisible();
  await page.getByRole("link", { name: /Default watchlist/i }).click();
  await expect(page.getByRole("heading", { name: "Assets" })).toBeVisible();
  await expect(page.locator(".asset-list strong").filter({ hasText: /^Bitcoin$/ })).toBeVisible();
  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { name: "Morning" })).toBeVisible();
  await page
    .getByRole("article")
    .filter({ hasText: "Bitcoin" })
    .getByRole("link", { name: "Bitcoin" })
    .click();
  await expect(page.getByRole("heading", { name: "Bitcoin" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Spot price/ }).first()).toBeVisible();
  await page.getByRole("link", { name: "Notifications" }).click();
  await expect(page.getByRole("heading", { name: /Notifications/i })).toBeVisible();
  await page.goto("/signals/does-not-exist");
  await expect(page.getByRole("heading", { name: "Signal not found" })).toBeVisible();
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expectNoSeriousAxe(page);
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
});

test("login after sign out returns to overview", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Appearance" })).toHaveCount(0);
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
});
