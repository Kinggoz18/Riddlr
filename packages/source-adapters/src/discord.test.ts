import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applicationIdFromBotToken,
  createDiscordAdapter,
  DISCORD_BOT_PERMISSIONS,
  DISCORD_READ_MESSAGE_HISTORY,
  DISCORD_VIEW_CHANNEL,
  discordBotInviteUrl,
  joinDiscordEmbeds,
  matchesDiscordKeywords,
  parseDiscordArchivedThreads,
  parseDiscordMessages,
  snowflakeFromDate,
} from "./discord.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/discord");

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as unknown;
}

const fetchedAt = new Date("2026-09-10T12:00:00.000Z");

describe("Discord official REST adapter", () => {
  it("parses the documented message example into a discord.com URL", () => {
    const parsed = parseDiscordMessages([readJson("message-example.json")], fetchedAt, {
      guildId: "222222222222222222",
    });
    expect(parsed.evidence).toHaveLength(1);
    expect(parsed.evidence[0]?.sourceFamily).toBe("discord");
    expect(parsed.evidence[0]?.url).toBe(
      "https://discord.com/channels/222222222222222222/290926798999357250/334385199974967042",
    );
    expect(parsed.evidence[0]?.bodyText).toBe("Supa Hot");
    expect(parsed.evidence[0]?.adapterPayload?.reactions).toEqual([{ name: "🔥", count: 1 }]);
  });

  it("joins embed title, description, and fields, and derives webhook origin from embed url", () => {
    const parsed = parseDiscordMessages(
      [
        {
          id: "123456789012345678",
          channel_id: "111111111111111111",
          guild_id: "222222222222222222",
          content: "",
          webhook_id: "987654321098765432",
          timestamp: "2026-09-10T11:00:00.000Z",
          author: { id: "1", username: "NewsBot", bot: true },
          embeds: [
            {
              title: "Issuer lists BTC",
              description: "Spot bitcoin ETF approved.",
              url: "https://www.reuters.com/markets/bitcoin-etf",
              fields: [{ name: "Venue", value: "NASDAQ" }],
              footer: { text: "Reuters" },
            },
          ],
          attachments: [{ filename: "chart.png", content_type: "image/png" }],
        },
      ],
      fetchedAt,
      {},
    );
    expect(parsed.evidence[0]?.contentCompleteness).toBe("native_complete");
    expect(parsed.evidence[0]?.bodyText).toContain("Issuer lists BTC");
    expect(parsed.evidence[0]?.bodyText).toContain("Spot bitcoin ETF approved.");
    expect(parsed.evidence[0]?.bodyText).toContain("Venue: NASDAQ");
    expect(parsed.evidence[0]?.referencedOriginKey).toBe("host:www.reuters.com");
    expect(parsed.evidence[0]?.originKey).toBe("host:www.reuters.com");
    expect(parsed.evidence[0]?.adapterPayload?.attachments).toEqual([
      { filename: "chart.png", contentType: "image/png" },
    ]);
    expect(joinDiscordEmbeds([{ title: "Only title" }]).text).toBe("Only title");
  });

  it("treats empty content without embeds as missing MESSAGE_CONTENT intent", () => {
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
    expect(parsed.evidence).toHaveLength(1);
    expect(parsed.evidence[0]?.contentCompleteness).toBe("incomplete");
    expect(parsed.errors[0]?.class).toBe("capability_missing");
    expect(parsed.errors[0]?.message).toMatch(/MESSAGE_CONTENT/);
  });

  it("classifies empty array, empty object, and missing id as empty or malformed", () => {
    expect(parseDiscordMessages(readJson("empty-array.json"), fetchedAt, {}).evidence).toHaveLength(
      0,
    );
    expect(
      parseDiscordMessages(readJson("empty-object.json"), fetchedAt, {}).errors[0]?.class,
    ).toBe("malformed");
    const drift = parseDiscordMessages([readJson("message-drift-missing-id.json")], fetchedAt, {});
    expect(drift.errors[0]?.message).toMatch(/missing id or channel_id/);
  });

  it("parses documented archived public threads", () => {
    const parsed = parseDiscordArchivedThreads(readJson("archived-threads.json"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.threadIds).toEqual(["41771983423143937"]);
    expect(parsed.hasMore).toBe(false);
    expect(parsed.before).toBe("2021-04-12T23:40:39.855793+00:00");
  });

  it("matches keywords on word boundaries, not substrings", () => {
    expect(matchesDiscordKeywords("bitcoin etf inflows", ["bitcoin"])).toBe(true);
    expect(matchesDiscordKeywords("bitcoin etf inflows", ["coin"])).toBe(false);
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
    expect(adapter.capabilities.lookbackNotes).toMatch(/72 hours/);
    expect(DISCORD_BOT_PERMISSIONS).toBe(DISCORD_VIEW_CHANNEL | DISCORD_READ_MESSAGE_HISTORY);
    expect(DISCORD_BOT_PERMISSIONS & (1 << 3)).toBe(0);
  });

  it("builds an invite URL only with a snowflake client_id", () => {
    expect(discordBotInviteUrl("123456789012345678")).toBe(
      "https://discord.com/oauth2/authorize?client_id=123456789012345678&permissions=66560&scope=bot",
    );
    expect(() => discordBotInviteUrl("")).toThrow(/snowflake/);
    const applicationId = "123456789012345678";
    const prefix = Buffer.from(applicationId, "utf8").toString("base64").replace(/=+$/, "");
    expect(applicationIdFromBotToken(`${prefix}.timestamp.hmac`)).toBe(applicationId);
    expect(applicationIdFromBotToken("not-a-bot-token")).toBeUndefined();
  });

  it("encodes lookback as a Discord snowflake after id", () => {
    const flake = snowflakeFromDate(new Date("2026-09-10T12:00:00.000Z"));
    expect(/^\d+$/.test(flake)).toBe(true);
    expect(BigInt(flake) > 0n).toBe(true);
  });

  it("rejects a source with no channel snowflakes or lookback above 72h", async () => {
    const adapter = createDiscordAdapter();
    expect((await adapter.validate({ token: "BotTokenValueHere", channelIds: [] })).ok).toBe(false);
    expect(
      (
        await adapter.validate({
          token: "BotTokenValueHere",
          channelIds: ["111111111111111111"],
          lookbackHours: 96,
        })
      ).ok,
    ).toBe(false);
  });

  it("filters keywords and maps 401 to auth without calling other channels after 429", async () => {
    const calls: string[] = [];
    const adapter = createDiscordAdapter(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      if (url.includes("/threads/archived/public")) {
        return Response.json({ threads: [], members: [], has_more: false });
      }
      if (url.includes("333333333333333333")) {
        return new Response("rate", { status: 429, headers: { "retry-after": "1.5" } });
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
    expect(limited.errors[0]?.message).toMatch(/retry_after=1.5/);
    expect(calls.filter((item) => item.includes("111111111111111111")).length).toBeLessThan(8);
  });

  it("names Missing Access on 403 and fetches archived threads then starter messages", async () => {
    const calls: string[] = [];
    const adapter = createDiscordAdapter(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      if (url.includes("444444444444444444/messages")) {
        return Response.json(readJson("missing-access.json"), { status: 403 });
      }
      if (url.includes("/threads/archived/public")) {
        return Response.json(readJson("archived-threads.json"));
      }
      if (url.includes("/channels/41771983423143937/messages")) {
        return Response.json([
          {
            id: "155117677105512449",
            channel_id: "41771983423143937",
            guild_id: "41771983423143937",
            content: "Thread starter about bitcoin ETF inflows",
            timestamp: "2021-04-12T23:40:39.855793+00:00",
            author: { id: "9", username: "mason" },
          },
        ]);
      }
      return Response.json([readJson("message-example.json")]);
    });
    const forbidden = await adapter.fetch(
      {
        token: "BotTokenValueHere",
        channelIds: ["444444444444444444"],
        lookbackHours: 6,
      },
      { query: "", limit: 20 },
    );
    expect(forbidden.errors[0]?.class).toBe("blocked");
    expect(forbidden.errors[0]?.message).toMatch(/Missing Access \(50001\)/);
    const withThreads = await adapter.fetch(
      {
        token: "BotTokenValueHere",
        channelIds: ["111111111111111111"],
        lookbackHours: 6,
      },
      { query: "", limit: 20 },
    );
    expect(calls.some((item) => item.includes("/threads/archived/public"))).toBe(true);
    expect(withThreads.evidence.some((item) => item.externalId === "155117677105512449")).toBe(
      true,
    );
  });

  it("bounds channel message pages to five", async () => {
    let messagePages = 0;
    const adapter = createDiscordAdapter(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/threads/archived/public")) {
        return Response.json({ threads: [], members: [], has_more: false });
      }
      messagePages += 1;
      const start = 100000000000000000n + BigInt(messagePages) * 100n;
      return Response.json(
        Array.from({ length: 100 }, (_, index) => ({
          id: (start + BigInt(index)).toString(),
          channel_id: "111111111111111111",
          content: `page ${messagePages} row ${index} bitcoin`,
        })),
      );
    });
    await adapter.fetch(
      {
        token: "BotTokenValueHere",
        channelIds: ["111111111111111111"],
        lookbackHours: 6,
      },
      { query: "", limit: 1000 },
    );
    expect(messagePages).toBe(5);
  });

  it("bounds archived-thread list pages to two", async () => {
    let threadPages = 0;
    const adapter = createDiscordAdapter(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/threads/archived/public")) {
        threadPages += 1;
        return Response.json({
          threads: [
            {
              id: `${41771983423143937n + BigInt(threadPages)}`,
              thread_metadata: {
                archive_timestamp: `2021-04-12T23:40:3${threadPages}.855793+00:00`,
              },
            },
          ],
          members: [],
          has_more: true,
        });
      }
      return Response.json([]);
    });
    await adapter.fetch(
      {
        token: "BotTokenValueHere",
        channelIds: ["111111111111111111"],
        lookbackHours: 6,
      },
      { query: "", limit: 20 },
    );
    expect(threadPages).toBe(2);
  });

  it("maps HTML 200, 5xx, and timeouts", async () => {
    const html = createDiscordAdapter(
      async () =>
        new Response("<html>nope</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    expect(
      (
        await html.fetch(
          { token: "BotTokenValueHere", channelIds: ["111111111111111111"], lookbackHours: 6 },
          { query: "", limit: 10 },
        )
      ).errors[0]?.class,
    ).toBe("malformed");
    const server = createDiscordAdapter(async () => new Response("fail", { status: 503 }));
    expect(
      (
        await server.fetch(
          { token: "BotTokenValueHere", channelIds: ["111111111111111111"], lookbackHours: 6 },
          { query: "", limit: 10 },
        )
      ).errors[0]?.class,
    ).toBe("unavailable");
    const timedOut = createDiscordAdapter(async () => {
      throw new Error("The operation was aborted");
    });
    expect(
      (
        await timedOut.fetch(
          { token: "BotTokenValueHere", channelIds: ["111111111111111111"], lookbackHours: 6 },
          { query: "", limit: 10 },
        )
      ).errors[0]?.class,
    ).toBe("timeout");
  });
});
