import { describe, expect, it } from "vitest";
import { assertDiscordWebhookTargetUrl } from "../../src/modules/notification-api.js";

const TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd";
const WEBHOOK_URL = `https://discord.com/api/webhooks/123456789012345678/${TOKEN}`;

describe("Discord webhook target URLs", () => {
  it("rejects a non-webhook URL without resolving it", async () => {
    await expect(
      assertDiscordWebhookTargetUrl("http://127.0.0.1/api/webhooks/1/token"),
    ).rejects.toMatchObject({ code: "invalid_webhook_url" });
  });

  it("rejects a Discord-shaped URL that resolves to a link-local address", async () => {
    await expect(
      assertDiscordWebhookTargetUrl(WEBHOOK_URL, async () => [{ address: "127.0.0.1", family: 4 }]),
    ).rejects.toMatchObject({ code: "unsafe_url" });
  });
});
