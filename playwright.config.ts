import { defineConfig, devices } from "@playwright/test";

const chromium = { ...devices["Desktop Chrome"] };

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:8080",
    trace: "on-first-retry",
  },
  projects: [
    { name: "onboarding", use: chromium, testMatch: "**/onboarding.spec.ts" },
    {
      name: "morning",
      dependencies: ["onboarding"],
      use: chromium,
      testMatch: "**/morning.spec.ts",
    },
    {
      name: "discord",
      dependencies: ["onboarding"],
      use: chromium,
      testMatch: "**/discord-delivery.spec.ts",
    },
  ],
});
