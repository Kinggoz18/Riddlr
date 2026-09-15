import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { totpFromOtpauth } from "./totp.js";

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

test("adds a watchlist asset by search and shows it on the morning view with a chart @a11y", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("link", { name: "Agents", exact: true }).click();
  const existing = page.getByRole("heading", { name: "Morning agent" });
  const existingLink = page.getByRole("link", { name: "Morning agent" });
  if ((await existing.count()) === 0 && (await existingLink.count()) === 0) {
    await page.getByRole("link", { name: "Create agent" }).click();
    await page.getByLabel("Agent name").fill("Morning agent");
    await page.getByLabel("Description").fill("Watches Bitcoin for the morning view.");
    await page.getByLabel("Watchlist").fill("Bitcoin");
    await page.getByRole("option", { name: "Bitcoin · BTC", exact: true }).click();
    await page.getByRole("button", { name: "Create agent" }).click();
  }
  await expect(page.getByRole("heading", { name: "Morning agent" }).or(existingLink)).toBeVisible();
  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { name: "Morning" })).toBeVisible();
  await page
    .getByRole("article")
    .filter({ hasText: "Bitcoin" })
    .getByRole("link", { name: "Bitcoin" })
    .click();
  await expect(page.getByRole("heading", { name: "Bitcoin" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Spot price/ }).first()).toBeVisible();
  await expectNoSeriousAxe(page);
});

test("opens an observed quantitative event", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Events" }).click();
  await expect(page.getByRole("heading", { name: /Events/ })).toBeVisible();
  const eventsResponse = await page.request.get("/api/v1/events?limit=50");
  expect(eventsResponse.ok()).toBeTruthy();
  const eventsBody = (await eventsResponse.json()) as {
    events: Array<{ id: string; title: string; reliabilityStatus?: string | null }>;
  };
  const observed = eventsBody.events.find((row) => row.reliabilityStatus === "observed");
  if (!observed) {
    throw new Error("Expected an observed quantitative event on Events.");
  }
  await page.getByRole("link", { name: observed.title }).click();
  await expect(page.getByRole("heading", { name: observed.title })).toBeVisible();
  await expect(page.getByText("Observed", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sourced observations" })).toBeVisible();
});
