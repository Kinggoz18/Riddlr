export const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export const money = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export const compactMoney = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export type AssetOption = {
  canonicalId: string;
  symbol: string;
  name: string;
};

export const ASSET_CATALOG: AssetOption[] = [
  { canonicalId: "coingecko:bitcoin", symbol: "BTC", name: "Bitcoin" },
  { canonicalId: "coingecko:ethereum", symbol: "ETH", name: "Ethereum" },
  { canonicalId: "coingecko:solana", symbol: "SOL", name: "Solana" },
  { canonicalId: "coingecko:tether", symbol: "USDT", name: "Tether" },
  { canonicalId: "coingecko:usd-coin", symbol: "USDC", name: "USD Coin" },
  { canonicalId: "coingecko:binancecoin", symbol: "BNB", name: "BNB" },
  { canonicalId: "coingecko:ripple", symbol: "XRP", name: "XRP" },
  { canonicalId: "coingecko:dogecoin", symbol: "DOGE", name: "Dogecoin" },
];

export function assetLabel(canonicalId: string) {
  const known = ASSET_CATALOG.find((item) => item.canonicalId === canonicalId);
  if (known) {
    return `${known.name} · ${known.symbol}`;
  }
  const local = canonicalId.split(":")[1];
  return local ? local.replace(/-/g, " ") : canonicalId;
}

export function resolveAssetInput(raw: string): string | undefined {
  const value = raw.trim().toLowerCase().replace(/^\$/, "");
  if (!value) {
    return undefined;
  }
  const known = ASSET_CATALOG.find(
    (item) =>
      item.canonicalId === value ||
      item.symbol.toLowerCase() === value ||
      item.name.toLowerCase() === value ||
      item.canonicalId.split(":")[1] === value,
  );
  if (known) {
    return known.canonicalId;
  }
  if (/^[a-z][a-z0-9-]{1,32}:[a-z0-9][a-z0-9._-]{0,127}$/.test(value)) {
    return value;
  }
  return undefined;
}

export function eventStatusLabel(status: string) {
  switch (status) {
    case "needs_analysis":
      return "Needs analysis";
    case "analyzed":
      return "Analyzed";
    case "candidate":
      return "Candidate";
    case "immaterial":
      return "Not material";
    case "empty":
      return "No evidence";
    case "abandoned":
      return "Skipped";
    default:
      return status;
  }
}

export function epistemicStatusLabel(status: string) {
  switch (status) {
    case "discovered":
      return "Discovered";
    case "observed":
      return "Observed";
    case "confirmed":
      return "Confirmed";
    case "inferred":
      return "Inferred";
    case "signal":
      return "Signal";
    default:
      return status.replaceAll("_", " ");
  }
}

export function candidateKindLabel(kind: string) {
  switch (kind) {
    case "potential_opportunity":
      return "Potential opportunity";
    case "emerging_narrative":
      return "Emerging narrative";
    case "hidden_gem":
      return "Hidden gem";
    case "major_event":
      return "Major event";
    case "unusual_market_behaviour":
      return "Unusual market behaviour";
    case "risk":
      return "Risk";
    case "anomaly":
      return "Anomaly";
    case "significant_development":
      return "Significant development";
    case "asset_specific_change":
      return "Asset-specific change";
    case "general_market_trend":
      return "General market trend";
    default:
      return kind.replaceAll("_", " ");
  }
}

export function independenceCopy(independent: number, derived: number) {
  return `${independent} independent source${independent === 1 ? "" : "s"} · ${derived} reprint${derived === 1 ? "" : "s"}`;
}

export const OBJECTIVE_OPTIONS = [
  ["general_crypto_intelligence", "General crypto intelligence"],
  ["emerging_narratives", "Emerging narratives"],
  ["major_events", "Major events"],
  ["significant_market_changes", "Significant market changes"],
  ["risk_signals", "Risk signals"],
  ["cross_source_corroboration", "Cross-source corroboration"],
  ["potential_opportunities", "Potential opportunities"],
  ["hidden_gems", "Hidden gems"],
  ["unusual_market_behaviour", "Unusual market behaviour"],
  ["anomalies", "Anomalies"],
  ["asset_specific_changes", "Asset-specific changes"],
  ["general_market_trends", "General market trends"],
] as const;

export function objectiveLabel(id: string) {
  return OBJECTIVE_OPTIONS.find(([key]) => key === id)?.[1] ?? id.replaceAll("_", " ");
}

export function scheduleLabel(schedule: string) {
  switch (schedule) {
    case "30m":
      return "Every 30 minutes";
    case "1h":
      return "Every hour";
    case "2h":
      return "Every 2 hours";
    case "4h":
      return "Every 4 hours";
    case "6h":
      return "Every 6 hours";
    case "12h":
      return "Every 12 hours";
    case "daily":
      return "Once a day";
    default:
      return schedule;
  }
}

export function auditActionLabel(action: string) {
  switch (action) {
    case "setup.admin":
      return "Administrator created";
    case "setup.totp_skipped":
      return "Authenticator skipped";
    case "setup.llm_skipped":
      return "Model skipped";
    case "auth.2fa":
      return "Authenticator verified";
    case "auth.totp_enabled":
      return "Authenticator enabled";
    case "auth.recovery_used":
      return "Recovery code used";
    case "auth.recovery_rotate":
      return "Recovery codes regenerated";
    case "auth.password_change":
      return "Password changed";
    case "auth.password_reset":
      return "Password reset";
    case "auth.session_revoke":
      return "Session revoked";
    case "auth.session_revoke_others":
      return "Other sessions signed out";
    case "settings.llm":
      return "Model saved";
    case "settings.whatsapp":
      return "WhatsApp saved";
    case "settings.telegram":
      return "Telegram saved";
    case "secrets.key_rotate":
      return "Encryption keys rotated";
    case "agent.create":
      return "Agent created";
    case "agent.duplicate":
      return "Agent duplicated";
    case "agent.delete":
      return "Agent deleted";
    case "audit.cleared":
      return "Audit log cleared";
    case "skill.create":
      return "Skill created";
    case "source.create":
      return "Source added";
    case "portfolio.create":
      return "Portfolio created";
    default:
      return action
        .split(/[._]/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}

export function auditResourceLabel(resource: string | null | undefined) {
  if (!resource) {
    return undefined;
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resource)) {
    return resource.slice(0, 8);
  }
  return resource;
}

export function adapterLabel(adapterId: string) {
  switch (adapterId) {
    case "searxng":
      return "SearXNG";
    case "discord":
      return "Discord";
    case "x":
      return "X";
    case "coingecko":
      return "CoinGecko";
    case "coinmarketcap":
      return "CoinMarketCap";
    case "cryptocom":
      return "Crypto.com Exchange";
    default:
      return adapterId;
  }
}

export function marketProviderLabel(provider: string | null | undefined) {
  if (!provider) {
    return "No live market source";
  }
  return adapterLabel(provider);
}

export function channelLabel(id: string) {
  return id.length > 6 ? `Channel · ${id.slice(-4)}` : id;
}

export function handleLabel(value: string) {
  return `@${value.replace(/^@/, "")}`;
}

export function editClockHour(raw: string): string {
  if (/[ap]/i.test(raw)) {
    return raw;
  }
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) {
    return digits;
  }
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

export function formatClockHour(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  const ampm = trimmed.match(/^(\d{1,2})(?::?(\d{2}))?\s*([ap])m?$/);
  if (ampm) {
    let hour = Number(ampm[1]);
    if (ampm[3] === "p" && hour < 12) {
      hour += 12;
    }
    if (ampm[3] === "a" && hour === 12) {
      hour = 0;
    }
    return hour >= 0 && hour <= 23 ? `${String(hour).padStart(2, "0")}:00` : "";
  }
  const match = trimmed.match(/^(\d{1,2})/);
  if (!match) {
    return "";
  }
  const hour = Number(match[1]);
  return hour >= 0 && hour <= 23 ? `${String(hour).padStart(2, "0")}:00` : "";
}

export function parseClockHour(raw: string): number | undefined {
  const formatted = formatClockHour(raw);
  if (!formatted) {
    return undefined;
  }
  return Number(formatted.slice(0, 2));
}
