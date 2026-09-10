import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { totpFromOtpauth } from "./totp.js";

test.describe.configure({ mode: "serial" });

const password = "correct horse battery";
const email = "ops@example.com";
let otpauth = "";

async function signIn(page: Page) {
  await page.goto("/");
  const overview = page.getByRole("heading", { name: "Overview" });
  const signin = page.getByRole("heading", { name: "Sign in" });
  await expect(overview.or(signin)).toBeVisible({ timeout: 15_000 });
  if (await overview.isVisible()) {
    return;
  }
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Authenticator or recovery code").fill(totpFromOtpauth(otpauth));
  await page.getByRole("button", { name: "Verify" }).click();
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
  const setupHeading = page.getByRole("heading", { name: "First-run setup" });
  await expect(setupHeading).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("list", { name: "Setup steps" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Authenticator" })).toBeVisible();
  await expect(page.getByText("LLM provider")).toBeVisible();
  await expect(page.getByText("Domains and sources")).toBeVisible();

  if (await page.getByRole("button", { name: "Create administrator" }).isVisible()) {
    await page.getByLabel(/Email/).fill(email);
    await page.getByLabel("Password").fill(password);
    await expectNoSeriousAxe(page);
    await page.getByRole("button", { name: "Create administrator" }).click();
  } else {
    const login = await page.request.post("/api/v1/auth/login", {
      headers: { "content-type": "application/json" },
      data: JSON.stringify({ email, password }),
    });
    expect(login.ok()).toBeTruthy();
  }

  await expect(page.getByRole("button", { name: "Generate authenticator secret" })).toBeVisible();
  await page.getByRole("button", { name: "Generate authenticator secret" }).click();
  await expect(page.getByText(/otpauth:\/\//)).toBeVisible();
  const totpText = (await page.getByText(/otpauth:\/\//).textContent()) ?? "";
  otpauth = totpText.match(/otpauth:\/\/\S+/)?.[0] ?? "";
  await page.getByLabel("Authenticator code").fill(totpFromOtpauth(otpauth));
  await page.getByRole("button", { name: "Verify 2FA" }).click();
  await expect(page.getByRole("heading", { name: "Recovery codes" })).toBeVisible();
  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await expect(page.getByLabel("API key")).toBeVisible();
  await page.getByLabel("API key").fill("sk-e2e-not-a-real-key");
  await page.getByRole("button", { name: "Save provider" }).click();
  await expect(page.getByRole("heading", { name: "What should Riddlr monitor?" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Crypto/ })).toBeChecked();
  for (const name of ["Equities", "Forex", "Commodities", "Macro"]) {
    await expect(page.getByRole("checkbox", { name: new RegExp(name) })).toBeDisabled();
  }
  await expect(page.getByText("Coming soon").first()).toBeVisible();
  await expectNoSeriousAxe(page);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible({ timeout: 20_000 });
  expect(otpauth).toMatch(/^otpauth:\/\//);

  await signIn(page);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Riddlr Intelligence Agent")).toBeVisible();
  await expect(page.getByText("Coming soon").first()).toBeVisible();
});

test("dashboard surfaces, settings, health, and responsive layout @a11y", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Agents" }).click();
  await expect(page.getByText("Domains: crypto")).toBeVisible();
  await page.getByLabel("Agent name").fill("Watchlist agent");
  await page.getByLabel("Canonical asset ids", { exact: true }).fill("coingecko:bitcoin");
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByRole("heading", { name: "Watchlist agent" })).toBeVisible();
  await page.getByRole("link", { name: "Sources" }).click();
  await expect(page.getByRole("heading", { name: "Add Discord source" })).toBeVisible();
  await expect(page.getByText(/MESSAGE_CONTENT/)).toBeVisible();
  await expect(page.getByText(/not guild message-search archive/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add X source" })).toBeVisible();
  await expect(page.getByText(/does not call archive search/i)).toBeVisible();
  await page.getByRole("link", { name: "Portfolios" }).click();
  await expect(page.getByText(/Never paste a seed phrase/i)).toBeVisible();
  await page.getByRole("link", { name: "Signals" }).click();
  await expect(page.getByText(/No signals|Signals/)).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByText("aes-256-gcm")).toBeVisible();
  await expect(page.getByText(/LLM: configured/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "WhatsApp Cloud API" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
  await expect(page.getByText("Current session")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recovery codes" })).toBeVisible();
  await expect(page.getByText(/remaining/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  await expect(page.getByText(/Key version/)).toBeVisible();
  await page.getByRole("link", { name: "System Health" }).click();
  await expect(page.getByText("PostgreSQL: ok")).toBeVisible();
  await expect(page.getByText(/Worker concurrency:/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expectNoSeriousAxe(page);
});

test("watchlists, notifications, 404, and tablet layout @a11y", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Watchlists" }).click();
  await expect(page.getByRole("heading", { name: /Watchlists/i })).toBeVisible();
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

test("login requires 2FA after sign out", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Authenticator or recovery code").fill(totpFromOtpauth(otpauth));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
});
