import { describe, expect, it } from "vitest";
import {
  confirmationTargetIds,
  DISCORD_WEBHOOK_URL_RE,
  defaultNotificationRoutes,
  INSTANCE_TELEGRAM_TARGET_ID,
  orderByImpactPriority,
  pickPrimaryTargetId,
  routeMatches,
  selectRoutedTargetIds,
} from "./notification-routing.js";

const base = {
  impact: "high" as const,
  catalystKind: "security_incident",
  assetCanonicalIds: ["coingecko:bitcoin"],
  reliability: "corroborated",
  notifyKind: "signal" as const,
  earlyWarningsEnabled: true,
};

describe("notification routing", () => {
  it("sends high and critical to every configured target and moderate to the primary", () => {
    const routes = defaultNotificationRoutes({
      allTargetIds: ["discord-a", INSTANCE_TELEGRAM_TARGET_ID],
      primaryTargetId: INSTANCE_TELEGRAM_TARGET_ID,
      earlyWarningsEnabled: false,
    });
    expect(selectRoutedTargetIds(routes, { ...base, impact: "critical" }).sort()).toEqual(
      ["discord-a", INSTANCE_TELEGRAM_TARGET_ID].sort(),
    );
    expect(selectRoutedTargetIds(routes, { ...base, impact: "moderate" })).toEqual([
      INSTANCE_TELEGRAM_TARGET_ID,
    ]);
    expect(selectRoutedTargetIds(routes, { ...base, impact: "low" })).toEqual([]);
  });

  it("delivers a signal once when two rules name the same target", () => {
    const ids = selectRoutedTargetIds(
      [
        {
          minImpact: "moderate",
          catalystKinds: [],
          assetCanonicalIds: [],
          reliabilityStatuses: [],
          includeEarlyWarnings: false,
          targetIds: ["t1", "t2"],
        },
        {
          minImpact: "high",
          catalystKinds: ["security_incident"],
          assetCanonicalIds: [],
          reliabilityStatuses: [],
          includeEarlyWarnings: false,
          targetIds: ["t2", "t3"],
        },
      ],
      base,
    );
    expect(ids).toEqual(["t1", "t2", "t3"]);
  });

  it("holds early warnings unless the operator enabled them on the matching route", () => {
    const route = {
      minImpact: "high" as const,
      catalystKinds: [],
      assetCanonicalIds: [],
      reliabilityStatuses: [],
      includeEarlyWarnings: true,
      targetIds: ["t1"],
    };
    expect(
      routeMatches(route, { ...base, notifyKind: "early_warning", earlyWarningsEnabled: false }),
    ).toBe(false);
    expect(
      routeMatches(route, { ...base, notifyKind: "early_warning", earlyWarningsEnabled: true }),
    ).toBe(true);
    expect(
      routeMatches(
        { ...route, includeEarlyWarnings: false },
        { ...base, notifyKind: "early_warning", earlyWarningsEnabled: true },
      ),
    ).toBe(false);
  });

  it("filters by catalyst kind, asset, and reliability", () => {
    const route = {
      minImpact: "moderate" as const,
      catalystKinds: ["security_incident"],
      assetCanonicalIds: ["coingecko:bitcoin"],
      reliabilityStatuses: ["corroborated"],
      includeEarlyWarnings: false,
      targetIds: ["t1"],
    };
    expect(routeMatches(route, base)).toBe(true);
    expect(routeMatches(route, { ...base, catalystKind: "token_unlock" })).toBe(false);
    expect(routeMatches(route, { ...base, assetCanonicalIds: ["coingecko:ethereum"] })).toBe(false);
    expect(routeMatches(route, { ...base, reliability: "single_source" })).toBe(false);
  });

  it("orders a burst so critical precedes informational", () => {
    const ordered = orderByImpactPriority([
      { id: "info", impact: "informational" as const },
      { id: "crit", impact: "critical" as const },
      { id: "mod", impact: "moderate" as const },
    ]);
    expect(ordered.map((item) => item.id)).toEqual(["crit", "mod", "info"]);
  });

  it("sends confirmation, dispute, and retraction to the original destinations", () => {
    expect(
      confirmationTargetIds({
        prior: [
          { channel: "discord", destination: "channel-1" },
          { channel: "telegram", destination: "telegram:1" },
        ],
        available: [
          { id: "d1", channel: "discord", destination: "channel-1" },
          { id: "t1", channel: "telegram", destination: "telegram:1" },
          { id: "d2", channel: "discord", destination: "other" },
        ],
      }),
    ).toEqual(["d1", "t1"]);
  });

  it("picks telegram as the default primary when no Discord primary is set", () => {
    expect(
      pickPrimaryTargetId({
        telegramConfigured: true,
        whatsappConfigured: true,
        discordIds: ["d1"],
      }),
    ).toBe(INSTANCE_TELEGRAM_TARGET_ID);
  });

  it("matches Discord incoming webhook URLs from the Execute Webhook spec", () => {
    const token = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd";
    expect(
      DISCORD_WEBHOOK_URL_RE.test(`https://discord.com/api/webhooks/123456789012345678/${token}`),
    ).toBe(true);
    expect(
      DISCORD_WEBHOOK_URL_RE.test(
        `https://ptb.discord.com/api/webhooks/123456789012345678/${token}`,
      ),
    ).toBe(true);
    expect(DISCORD_WEBHOOK_URL_RE.test(`http://127.0.0.1/api/webhooks/1/${token}`)).toBe(false);
    expect(DISCORD_WEBHOOK_URL_RE.test(`https://discord.com/api/webhooks/1/short`)).toBe(false);
  });
});
