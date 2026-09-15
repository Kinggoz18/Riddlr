import { expect, type Page, test } from "@playwright/test";
import { totpFromOtpauth } from "./totp.js";

const password = process.env.RIDDLR_E2E_PASSWORD ?? "correct horse battery";
const email = process.env.RIDDLR_E2E_EMAIL ?? "ops@example.com";
const otpauth = process.env.RIDDLR_E2E_OTPAUTH ?? "";
const webhook = process.env.RIDDLR_E2E_DISCORD_WEBHOOK ?? "";

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

test("configures a Discord webhook and records a delivery", async ({ page }) => {
  if (!webhook) {
    throw new Error("Set RIDDLR_E2E_DISCORD_WEBHOOK to a type-1 incoming webhook URL.");
  }
  await signIn(page);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.locator(".page-subnav").getByRole("link", { name: "Notifications" }).click();
  await expect(page.getByRole("heading", { name: "Discord webhook" })).toBeVisible();
  await page.getByLabel("Webhook URL").fill(webhook);
  await page.getByRole("button", { name: "Save Discord webhook" }).click();
  await expect(page.getByText(/^Channel /)).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Threshold").fill("1");
  await page.getByRole("button", { name: "Save observation alert" }).click();
  await expect(page.getByText(/spot_price gte 1/)).toBeVisible();
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/v1/notifications?limit=50");
        if (!response.ok()) {
          return false;
        }
        const body = (await response.json()) as {
          deliveries: Array<{ channel: string; status: string }>;
        };
        return body.deliveries.some((row) => row.channel === "discord");
      },
      { timeout: 90_000 },
    )
    .toBe(true);
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(page.getByText("discord", { exact: false }).first()).toBeVisible();
});
