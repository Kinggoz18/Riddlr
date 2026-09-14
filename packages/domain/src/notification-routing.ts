import {
  MAX_NOTIFICATION_ROUTES_PER_AGENT,
  MAX_NOTIFICATION_TARGETS,
  takeBounded,
} from "./limits.js";
import type { ImpactLevel } from "./reliability.js";

export const NOTIFICATION_CHANNELS = ["telegram", "whatsapp", "discord"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const DISCORD_WEBHOOK_URL_RE =
  /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d{17,20}\/[A-Za-z0-9_-]{60,}$/;

export const INSTANCE_TELEGRAM_TARGET_ID = "instance:telegram";
export const INSTANCE_WHATSAPP_TARGET_ID = "instance:whatsapp";

const IMPACT_RANK: Record<ImpactLevel, number> = {
  informational: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

export type NotificationRoute = {
  minImpact: ImpactLevel;
  catalystKinds: readonly string[];
  assetCanonicalIds: readonly string[];
  reliabilityStatuses: readonly string[];
  includeEarlyWarnings: boolean;
  targetIds: readonly string[];
};

export type NotificationRouteMatchInput = {
  impact: ImpactLevel;
  catalystKind?: string;
  assetCanonicalIds: readonly string[];
  reliability?: string;
  notifyKind: "signal" | "early_warning" | "confirmation" | "dispute" | "retraction";
  earlyWarningsEnabled: boolean;
};

export function isInstanceTargetId(id: string): boolean {
  return id === INSTANCE_TELEGRAM_TARGET_ID || id === INSTANCE_WHATSAPP_TARGET_ID;
}

export function isNotificationChannel(value: string): value is NotificationChannel {
  return value === "telegram" || value === "whatsapp" || value === "discord";
}

export function routeMatches(
  route: NotificationRoute,
  input: NotificationRouteMatchInput,
): boolean {
  if (IMPACT_RANK[input.impact] < IMPACT_RANK[route.minImpact]) {
    return false;
  }
  if (route.catalystKinds.length > 0) {
    if (!input.catalystKind || !route.catalystKinds.includes(input.catalystKind)) {
      return false;
    }
  }
  if (route.assetCanonicalIds.length > 0) {
    const overlap = input.assetCanonicalIds.some((id) => route.assetCanonicalIds.includes(id));
    if (!overlap) {
      return false;
    }
  }
  if (route.reliabilityStatuses.length > 0) {
    if (!input.reliability || !route.reliabilityStatuses.includes(input.reliability)) {
      return false;
    }
  }
  if (input.notifyKind === "early_warning") {
    return input.earlyWarningsEnabled && route.includeEarlyWarnings;
  }
  return true;
}

export function selectRoutedTargetIds(
  routes: readonly NotificationRoute[],
  input: NotificationRouteMatchInput,
): string[] {
  const matched = takeBounded(routes, MAX_NOTIFICATION_ROUTES_PER_AGENT).filter((route) =>
    routeMatches(route, input),
  );
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const route of matched) {
    for (const targetId of takeBounded(route.targetIds, MAX_NOTIFICATION_TARGETS)) {
      if (seen.has(targetId)) {
        continue;
      }
      seen.add(targetId);
      ids.push(targetId);
    }
  }
  return ids;
}

export function defaultNotificationRoutes(input: {
  allTargetIds: readonly string[];
  primaryTargetId?: string;
  earlyWarningsEnabled: boolean;
}): NotificationRoute[] {
  const all = takeBounded(input.allTargetIds, MAX_NOTIFICATION_TARGETS);
  const primary =
    input.primaryTargetId && all.includes(input.primaryTargetId) ? input.primaryTargetId : all[0];
  if (all.length === 0 || !primary) {
    return [];
  }
  return [
    {
      minImpact: "high",
      catalystKinds: [],
      assetCanonicalIds: [],
      reliabilityStatuses: [],
      includeEarlyWarnings: input.earlyWarningsEnabled,
      targetIds: all,
    },
    {
      minImpact: "moderate",
      catalystKinds: [],
      assetCanonicalIds: [],
      reliabilityStatuses: [],
      includeEarlyWarnings: false,
      targetIds: [primary],
    },
  ];
}

export function orderByImpactPriority<T extends { impact: ImpactLevel }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => IMPACT_RANK[right.impact] - IMPACT_RANK[left.impact]);
}

export function confirmationTargetIds(input: {
  prior: readonly { channel: string; destination: string }[];
  available: readonly { id: string; channel: string; destination: string }[];
}): string[] {
  const wanted = new Set(input.prior.map((item) => `${item.channel}:${item.destination}`));
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const target of input.available) {
    const key = `${target.channel}:${target.destination}`;
    if (!wanted.has(key) || seen.has(target.id)) {
      continue;
    }
    seen.add(target.id);
    ids.push(target.id);
  }
  return ids;
}

export function pickPrimaryTargetId(input: {
  discordPrimaryId?: string;
  telegramConfigured: boolean;
  whatsappConfigured: boolean;
  discordIds: readonly string[];
}): string | undefined {
  if (input.discordPrimaryId) {
    return input.discordPrimaryId;
  }
  if (input.telegramConfigured) {
    return INSTANCE_TELEGRAM_TARGET_ID;
  }
  if (input.whatsappConfigured) {
    return INSTANCE_WHATSAPP_TARGET_ID;
  }
  return input.discordIds[0];
}
