import { describe, expect, it } from "vitest";
import {
  buildDiscordSignalPayload,
  DISCORD_WEBHOOK_URL_RE,
  executeDiscordWebhook,
  parseDiscordWebhookUrl,
  redactDiscordWebhookUrl,
  sanitizeNotificationText,
  validateDiscordWebhook,
} from "./discord.js";

const TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd";
const WEBHOOK_URL = `https://discord.com/api/webhooks/123456789012345678/${TOKEN}`;

describe("Discord incoming webhooks", () => {
  it("accepts incoming webhook URLs and redacts the token", () => {
    expect(DISCORD_WEBHOOK_URL_RE.test(WEBHOOK_URL)).toBe(true);
    expect(parseDiscordWebhookUrl(WEBHOOK_URL)?.path).toContain("/webhooks/123456789012345678/");
    expect(redactDiscordWebhookUrl(WEBHOOK_URL)).toBe(
      "https://discord.com/api/webhooks/123456789012345678/[redacted]",
    );
    expect(parseDiscordWebhookUrl("https://example.test/api/webhooks/1/token")).toBeUndefined();
  });

  it("validates GET /webhooks/{id}/{token} as type 1 incoming", async () => {
    const ok = await validateDiscordWebhook({
      url: WEBHOOK_URL,
      fetchImpl: async () =>
        Response.json({ type: 1, channel_id: "111", guild_id: "222", name: "alerts" }),
    });
    expect(ok).toEqual({
      ok: true,
      info: { channelId: "111", guildId: "222", name: "alerts" },
    });
    const missing = await validateDiscordWebhook({
      url: WEBHOOK_URL,
      fetchImpl: async () => Response.json({ message: "Unknown Webhook" }, { status: 404 }),
    });
    expect(missing.ok).toBe(false);
    if (missing.ok === false) {
      expect(missing.status).toBe(404);
    }
    const wrongType = await validateDiscordWebhook({
      url: WEBHOOK_URL,
      fetchImpl: async () => Response.json({ type: 2, channel_id: "111" }),
    });
    expect(wrongType.ok).toBe(false);
  });

  it("executes with wait=true, strips @everyone, and sets allowed_mentions.parse to []", async () => {
    let body: Record<string, unknown> = {};
    let href = "";
    const result = await executeDiscordWebhook({
      url: WEBHOOK_URL,
      content: "SIGNAL: @everyone <@$123> drain",
      embeds: [{ title: "@everyone exploit", description: "see <@123>" }],
      fetchImpl: async (input, init) => {
        href = String(input);
        body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return Response.json({ id: "msg-1" });
      },
    });
    expect(result.ok).toBe(true);
    expect(result.providerMessageId).toBe("msg-1");
    expect(href).toContain("?wait=true");
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(String(body.content)).not.toMatch(/@everyone/);
    expect(String(body.content)).not.toMatch(/<@/);
  });

  it("retries Discord 429 once when retry_after is bounded and refuses unbounded waits", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const retried = await executeDiscordWebhook({
      url: WEBHOOK_URL,
      content: "hello",
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return Response.json({ retry_after: 1.5 }, { status: 429 });
        }
        return Response.json({ id: "msg-2" });
      },
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(retried.ok).toBe(true);
    expect(calls).toBe(2);
    expect(sleeps).toEqual([1500]);
    const skipped: number[] = [];
    const over = await executeDiscordWebhook({
      url: WEBHOOK_URL,
      content: "hello",
      fetchImpl: async () => Response.json({ retry_after: 30 }, { status: 429 }),
      sleepImpl: async (ms) => {
        skipped.push(ms);
      },
    });
    expect(over.ok).toBe(false);
    expect(over.errorClass).toBe("rate_limited");
    expect(skipped).toEqual([]);
  });

  it("marks deleted webhooks as auth and falls back to content-only after embed 400", async () => {
    const deleted = await executeDiscordWebhook({
      url: WEBHOOK_URL,
      content: "hello",
      fetchImpl: async () => new Response(null, { status: 404 }),
    });
    expect(deleted.errorClass).toBe("auth");
    const posts: Array<Record<string, unknown>> = [];
    const fallback = await executeDiscordWebhook({
      url: WEBHOOK_URL,
      content: "hello",
      embeds: [{ title: "too big" }],
      fetchImpl: async (_input, init) => {
        const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        posts.push(payload);
        if (posts.length === 1) {
          return Response.json({ embeds: ["invalid"] }, { status: 400 });
        }
        return Response.json({ id: "msg-3" });
      },
    });
    expect(fallback.ok).toBe(true);
    expect(posts[0]?.embeds).toBeDefined();
    expect(posts[1]?.embeds).toBeUndefined();
    expect(String(posts[1]?.content)).toContain("hello");
  });

  it("puts reliability, catalyst, origins, age, and assets on the embed", () => {
    const payload = buildDiscordSignalPayload({
      headline: "@everyone drain",
      kind: "early_warning",
      reliability: "single_source",
      whyItMatters: "Bridge pause",
      catalystKind: "security_incident",
      impact: "critical",
      independentOrigins: 1,
      ageLabel: "4 minutes",
      assets: ["coingecko:ethereum"],
      proofUrl: "http://127.0.0.1:8080/signals/1",
      agentName: "Desk",
    });
    expect(payload.content).toContain("UNVERIFIED EARLY WARNING");
    expect(payload.content).not.toMatch(/@everyone/);
    expect(payload.embeds[0]?.title).toContain("UNVERIFIED EARLY WARNING");
    expect(payload.embeds[0]?.fields?.map((item) => item.name)).toEqual([
      "Reliability",
      "Catalyst",
      "Impact",
      "Independent origins",
      "Source age",
      "Assets",
    ]);
    expect(sanitizeNotificationText("@everyone")).toBe("everyone");
  });
});
