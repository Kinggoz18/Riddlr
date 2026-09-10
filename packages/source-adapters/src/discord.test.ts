import { describe, expect, it } from "vitest";
import {
  createDiscordAdapter,
  DISCORD_BOT_PERMISSIONS,
  DISCORD_READ_MESSAGE_HISTORY,
  DISCORD_VIEW_CHANNEL,
  parseDiscordMessages,
  snowflakeFromDate,
} from "./discord.js";

const fetchedAt = new Date("2026-09-10T12:00:00.000Z");

describe("Discord official REST adapter", () => {
  it("parses channel messages and builds a canonical discord.com URL", () => {
    const parsed = parseDiscordMessages(
      [
        {
          id: "123456789012345678",
          channel_id: "111111111111111111",
          guild_id: "222222222222222222",
          content: "Bitcoin ETF inflows discussed here",
          timestamp: "2026-09-10T11:00:00.000Z",
          author: { id: "9", username: "alice" },
        },
      ],
      fetchedAt,
      { guildId: "222222222222222222" },
    );
    expect(parsed.evidence).toHaveLength(1);
    expect(parsed.evidence[0]?.sourceFamily).toBe("discord");
    expect(parsed.evidence[0]?.url).toBe(
      "https://discord.com/channels/222222222222222222/111111111111111111/123456789012345678",
    );
    expect(parsed.evidence[0]?.bodyText).toContain("Bitcoin");
  });

  it("treats empty content as missing MESSAGE_CONTENT intent", () => {
    const parsed = parseDiscordMessages(
      [
        {
          id: "123456789012345678",
          channel_id: "111111111111111111",
          content: "",
          author: { username: "alice" },
        },
      ],
      fetchedAt,
      {},
    );
    expect(parsed.evidence).toHaveLength(0);
    expect(parsed.errors[0]?.class).toBe("capability_missing");
    expect(parsed.errors[0]?.message).toMatch(/MESSAGE_CONTENT/);
  });

  it("caps messages per channel", () => {
    const payload = Array.from({ length: 200 }, (_, index) => ({
      id: `${100000000000000000 + index}`,
      channel_id: "111111111111111111",
      content: `Hello ${index}`,
    }));
    const parsed = parseDiscordMessages(payload, fetchedAt, { maxResults: 5 });
    expect(parsed.evidence).toHaveLength(5);
  });

  it("advertises poll lookback, not archive search, and least-privilege bits", () => {
    const adapter = createDiscordAdapter();
    expect(adapter.capabilities.modes).toEqual(["poll"]);
    expect(adapter.capabilities.lookbackNotes).toMatch(/not guild message-search archive/);
    expect(DISCORD_BOT_PERMISSIONS).toBe(DISCORD_VIEW_CHANNEL | DISCORD_READ_MESSAGE_HISTORY);
    expect(DISCORD_BOT_PERMISSIONS & (1 << 3)).toBe(0);
  });

  it("encodes lookback as a Discord snowflake after id", () => {
    const flake = snowflakeFromDate(new Date("2026-09-10T12:00:00.000Z"));
    expect(/^\d+$/.test(flake)).toBe(true);
    expect(BigInt(flake) > 0n).toBe(true);
  });

  it("rejects a source with no channel snowflakes", async () => {
    const adapter = createDiscordAdapter();
    const result = await adapter.validate({ token: "BotTokenValueHere", channelIds: [] });
    expect(result.ok).toBe(false);
  });

  it("filters keywords and maps 401 to auth without calling other channels after 429", async () => {
    const calls: string[] = [];
    const adapter = createDiscordAdapter(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      if (url.includes("333333333333333333")) {
        return new Response("rate", { status: 429 });
      }
      return Response.json([
        {
          id: "123456789012345678",
          channel_id: "111111111111111111",
          content: "stablecoin depeg chatter",
          timestamp: "2026-09-10T11:00:00.000Z",
          author: { username: "bob" },
        },
      ]);
    });
    const allowed = await adapter.fetch(
      {
        token: "BotTokenValueHere",
        channelIds: ["111111111111111111"],
        keywords: ["stablecoin"],
        lookbackHours: 6,
      },
      { query: "", limit: 20 },
    );
    expect(allowed.evidence).toHaveLength(1);
    const dropped = await adapter.fetch(
      {
        token: "BotTokenValueHere",
        channelIds: ["111111111111111111"],
        keywords: ["ethereum"],
        lookbackHours: 6,
      },
      { query: "", limit: 20 },
    );
    expect(dropped.evidence).toHaveLength(0);
    const limited = await adapter.fetch(
      {
        token: "BotTokenValueHere",
        channelIds: ["333333333333333333", "111111111111111111"],
        lookbackHours: 6,
      },
      { query: "", limit: 20 },
    );
    expect(limited.errors.some((item) => item.class === "rate_limited")).toBe(true);
    expect(calls.filter((item) => item.includes("111111111111111111")).length).toBeLessThan(4);
  });
});
