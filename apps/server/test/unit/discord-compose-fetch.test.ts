import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.js";
import { composeDiscordWebhookFetch } from "../../src/modules/discord-compose-fetch.js";

describe("compose Discord webhook fetch", () => {
  it("rewrites discord.com to the Compose mock origin", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      seen.push(String(input));
      return Response.json({ type: 1, channel_id: "e2e-channel" });
    };
    const wrapped = composeDiscordWebhookFetch(
      {
        config: { RIDDLR_DISCORD_WEBHOOK_ORIGIN: "http://discord-webhook-mock:8080" },
      } as AppContext,
      fetchImpl,
    );
    await wrapped("https://discord.com/api/webhooks/1/token?wait=true");
    expect(seen).toEqual(["http://discord-webhook-mock:8080/api/webhooks/1/token?wait=true"]);
  });

  it("leaves fetch unchanged when no origin is configured", async () => {
    const inner: typeof fetch = async () => Response.json({});
    const ctx = { config: { RIDDLR_DISCORD_WEBHOOK_ORIGIN: "" } } as AppContext;
    expect(composeDiscordWebhookFetch(ctx, inner)).toBe(inner);
  });
});
