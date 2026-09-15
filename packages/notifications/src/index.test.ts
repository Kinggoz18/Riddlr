import { describe, expect, it } from "vitest";
import {
  decideNotification,
  decideObservationNotification,
  formatObservationAlert,
  formatSignalNotification,
  sendTelegramMessage,
  sendWhatsAppSessionText,
  splitTelegramText,
} from "./index.js";
import { parseWhatsAppInbound, parseWhatsAppUnixTimestamp, sessionWindowOpen } from "./whatsapp.js";

describe("notification policy", () => {
  it("suppresses duplicates via cooldown", () => {
    const policy = { minRisk: "moderate" as const, cooldownMs: 60_000 };
    expect(
      decideNotification({
        policy,
        risk: "high",
        lastSentAt: new Date("2026-09-10T00:00:00Z"),
        now: new Date("2026-09-10T00:00:30Z"),
      }).send,
    ).toBe(false);
    expect(
      decideNotification({
        policy,
        risk: "low",
        now: new Date("2026-09-10T00:02:00Z"),
      }).send,
    ).toBe(false);
  });

  it("allows a send when cooldown is zero", () => {
    expect(
      decideNotification({
        policy: { minRisk: "moderate", cooldownMs: 0 },
        risk: "high",
        lastSentAt: new Date("2026-09-10T00:00:00Z"),
        now: new Date("2026-09-10T00:00:00Z"),
      }).send,
    ).toBe(true);
  });

  it("splits telegram payloads", () => {
    expect(splitTelegramText("a".repeat(5000)).length).toBe(2);
  });

  it("honors quiet hours", () => {
    expect(
      decideNotification({
        policy: { minRisk: "low", cooldownMs: 0, quietHours: { startHour: 0, endHour: 23 } },
        risk: "high",
        now: new Date("2026-09-10T04:00:00Z"),
      }).reason,
    ).toBe("quiet_hours");
  });

  it("retries Telegram 429 once when retry_after is bounded", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await sendTelegramMessage({
      token: "t",
      chatId: "1",
      text: "hello",
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return Response.json({ parameters: { retry_after: 2 } }, { status: 429 });
        }
        return Response.json({ ok: true });
      },
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
    expect(sleeps).toEqual([2000]);
  });

  it("does not wait on Telegram 429 when retry_after exceeds the bound", async () => {
    const sleeps: number[] = [];
    const result = await sendTelegramMessage({
      token: "t",
      chatId: "1",
      text: "hello",
      fetchImpl: async () => Response.json({ parameters: { retry_after: 30 } }, { status: 429 }),
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(result.ok).toBe(false);
    expect(sleeps).toEqual([]);
  });

  it("sends WhatsApp session text only inside the 24h window and parses inbound", () => {
    const now = new Date("2026-09-10T00:00:00Z");
    const inbound = parseWhatsAppInbound(
      {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    { from: "15551234567", timestamp: String(Math.floor(now.getTime() / 1000)) },
                  ],
                },
              },
            ],
          },
        ],
      },
      now,
    );
    expect(inbound[0]?.from).toBe("15551234567");
    expect(
      sessionWindowOpen(new Date("2026-09-10T00:00:00Z"), new Date("2026-09-10T23:00:00Z")),
    ).toBe(true);
    expect(
      sessionWindowOpen(new Date("2026-09-09T00:00:00Z"), new Date("2026-09-10T23:00:00Z")),
    ).toBe(false);
  });

  it("refuses session text when the customer-service window is closed", async () => {
    const result = await sendWhatsAppSessionText({
      accessToken: "token",
      phoneNumberId: "123456",
      to: "15551234567",
      text: "signal",
      lastInboundAt: undefined,
      fetchImpl: async () => {
        throw new Error("must not send");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/template/);
  });

  it("rejects missing, future, and ancient WhatsApp timestamps", () => {
    const now = new Date("2026-09-10T00:00:00Z");
    expect(parseWhatsAppUnixTimestamp("not-a-time", now)).toBeUndefined();
    expect(
      parseWhatsAppUnixTimestamp(String(Math.floor(now.getTime() / 1000) + 3600), now),
    ).toBeUndefined();
    expect(
      parseWhatsAppUnixTimestamp(String(Math.floor(now.getTime() / 1000) - 8 * 24 * 3600), now),
    ).toBeUndefined();
    expect(
      parseWhatsAppUnixTimestamp(String(Math.floor(now.getTime() / 1000)), now)?.toISOString(),
    ).toBe(now.toISOString());
  });

  it("formats a bounded signal summary, not only a headline", () => {
    const body = formatSignalNotification({
      headline: "ETF inflows persist",
      whyItMatters: "Demand remains",
      proofSummary: "Primary filing",
      risk: "moderate",
      invalidation: "if outflows reverse",
      publicUrl: "http://127.0.0.1:8080/signals/1",
      reliability: "corroborated",
      catalystKind: "material_corporate_event",
      independentOrigins: 2,
      ageLabel: "9 minutes",
    });
    expect(body).toContain("SIGNAL:");
    expect(body).toContain("WHY:");
    expect(body).toContain("PROOF:");
    expect(body).toContain("RISK:");
    expect(body).toContain("INVALIDATION:");
    expect(body).toContain("RELIABILITY: corroborated");
    expect(body).toContain("CATALYST: material_corporate_event");
    expect(body).toContain("INDEPENDENT ORIGINS: 2");
    expect(body).toContain("AGE: 9 minutes");
  });

  it("labels unverified early warnings distinctly", () => {
    const body = formatSignalNotification({
      headline: "Official channel reports outage",
      kind: "early_warning",
      sourceLabel: "discord announcements",
      ageLabel: "12 minutes",
      proofSummary: "Single trusted post",
    });
    expect(body).toContain("UNVERIFIED EARLY WARNING");
    expect(body).toContain("not confirmed");
  });

  it("labels observation alerts as observations, never as signals", () => {
    const body = formatObservationAlert({
      metric: "funding_rate_apr",
      op: "gte",
      threshold: 20,
      value: 25,
      unit: "percent",
      provider: "hyperliquid",
      subjectCanonicalId: "hyperliquid:BTC",
      observedAt: new Date("2026-09-14T15:00:00.000Z"),
    });
    expect(body).toContain("OBSERVATION");
    expect(body).toContain("not a signal");
    expect(body).not.toMatch(/\bSIGNAL:/);
  });

  it("holds observation alerts in quiet hours and cooldown without using minRisk", () => {
    expect(
      decideObservationNotification({
        policy: { cooldownMs: 0, quietHours: { startHour: 0, endHour: 23 } },
        now: new Date("2026-09-10T04:00:00Z"),
      }).reason,
    ).toBe("quiet_hours");
    expect(
      decideObservationNotification({
        policy: { cooldownMs: 60_000 },
        lastSentAt: new Date("2026-09-10T00:00:00Z"),
        now: new Date("2026-09-10T00:00:30Z"),
      }).send,
    ).toBe(false);
  });
});
