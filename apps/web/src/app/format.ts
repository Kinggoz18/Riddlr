import { isTypedSignalId, TYPED_SIGNAL_LABELS } from "@riddlr/domain";

export const DEFAULT_DAILY_TOKEN_BUDGET = 100_000;
export const MIN_DAILY_TOKEN_BUDGET = 500;
export const MAX_DAILY_TOKEN_BUDGET = 200_000;

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

export function formatSpotQuote(value?: number | null, unit?: string | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  if (!unit || unit === "usd") {
    return compactMoney.format(value);
  }
  if (unit === "percent" || unit === "apr") {
    return `${value.toFixed(2)}%`;
  }
  return `${value} ${unit}`;
}

export function formatSignedPct(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const abs = Math.abs(value).toFixed(2);
  if (value > 0) {
    return `+${abs}%`;
  }
  if (value < 0) {
    return `-${abs}%`;
  }
  return "0.00%";
}

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
  { canonicalId: "sec:0000320193", symbol: "AAPL", name: "Apple Inc." },
];

export function assetLabel(canonicalId: string) {
  const known = ASSET_CATALOG.find((item) => item.canonicalId === canonicalId);
  if (known) {
    return `${known.name} · ${known.symbol}`;
  }
  const local = canonicalId.split(":")[1];
  return local ? local.replace(/-/g, " ") : canonicalId;
}

export function assetTicker(canonicalId: string, item?: { symbol?: string | null }) {
  if (item?.symbol?.trim()) {
    return item.symbol.trim().toUpperCase();
  }
  const known = ASSET_CATALOG.find((entry) => entry.canonicalId === canonicalId);
  if (known) {
    return known.symbol;
  }
  const local = canonicalId.split(":")[1];
  return (local ?? canonicalId).replace(/-/g, "").slice(0, 6).toUpperCase();
}

export function assetDisplayName(canonicalId: string, item?: { name?: string | null }) {
  if (item?.name?.trim()) {
    return item.name.trim();
  }
  const known = ASSET_CATALOG.find((entry) => entry.canonicalId === canonicalId);
  if (known) {
    return known.name;
  }
  const local = canonicalId.split(":")[1];
  return local ? local.replace(/-/g, " ") : canonicalId;
}

export function assetClassLabel(assetClass?: string | null) {
  switch (assetClass) {
    case "cryptocurrency":
      return "Cryptocurrency";
    case "meme_coin":
      return "Meme coin";
    case "stablecoin":
      return "Stablecoin";
    case "stock":
      return "Stock";
    case "etf":
      return "ETF";
    case "index":
      return "Index";
    default:
      return assetClass ? assetClass.replaceAll("_", " ") : undefined;
  }
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

export function tokenBudgetLabel(budget: number | null | undefined) {
  return budget === null ? "Unlimited" : (budget ?? DEFAULT_DAILY_TOKEN_BUDGET).toLocaleString();
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

export function lifecycleStatusLabel(status: string) {
  switch (status) {
    case "open":
      return "Open";
    case "developing":
      return "Developing";
    case "confirmed":
      return "Confirmed";
    case "disputed":
      return "Disputed";
    case "retracted":
      return "Retracted";
    case "resolved":
      return "Resolved";
    case "superseded":
      return "Superseded";
    default:
      return status.replaceAll("_", " ");
  }
}

export function leadTimeLabel(hours: number | null | undefined) {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) {
    return undefined;
  }
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${minutes} minute${minutes === 1 ? "" : "s"} lead`;
  }
  const rounded = hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours);
  return `${rounded} hour${rounded === 1 ? "" : "s"} lead`;
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

export function reliabilityStatusLabel(status: string) {
  switch (status) {
    case "observed":
      return "Observed";
    case "single_source":
      return "Single source";
    case "primary_confirmed":
      return "Primary confirmed";
    case "legacy_unassessed":
      return "Unassessed";
    default:
      return status.replaceAll("_", " ");
  }
}

export function catalystKindLabel(kind: string) {
  switch (kind) {
    case "security_incident":
      return "Security incident";
    case "insolvency_or_withdrawal_halt":
      return "Insolvency or withdrawal halt";
    case "peg_deviation":
      return "Peg deviation";
    case "token_unlock":
      return "Token unlock";
    case "listing_or_delisting":
      return "Listing or delisting";
    case "governance_proposal":
      return "Governance proposal";
    case "regulatory_or_legal_action":
      return "Regulatory or legal action";
    case "sanction":
      return "Sanction";
    case "macro_policy_decision":
      return "Macro policy decision";
    case "scheduled_release":
      return "Scheduled release";
    case "insider_transaction":
      return "Insider transaction";
    case "material_corporate_event":
      return "Material corporate event";
    case "earnings_or_guidance":
      return "Earnings or guidance";
    case "large_transfer":
      return "Large transfer";
    case "market_stress":
      return "Market stress";
    case "observed_anomaly":
      return "Observed anomaly";
    case "principal_statement":
      return "Principal statement";
    default:
      return kind.replaceAll("_", " ").replaceAll(":", " ");
  }
}

export function typedSignalLabel(id: string, anticipated?: boolean) {
  const base = isTypedSignalId(id) ? TYPED_SIGNAL_LABELS[id] : id.replaceAll("_", " ");
  return anticipated ? `${base} · Anticipated` : base;
}

export function candidateKindLabel(kind: string) {
  switch (kind) {
    case "potential_opportunity":
      return "Potential opportunity";
    case "search_mention":
      return "Search mention";
    case "single_source_report":
      return "Single-source report";
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
  return `${independent} independent origin${independent === 1 ? "" : "s"} · ${derived} reprint${derived === 1 ? "" : "s"}`;
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

export const EQUITIES_OBJECTIVE_OPTIONS = [
  ["general_equities_intelligence", "General equities intelligence"],
  ["major_events", "Major events"],
  ["risk_signals", "Risk signals"],
  ["cross_source_corroboration", "Cross-source corroboration"],
  ["asset_specific_changes", "Asset-specific changes"],
] as const;

export function objectiveLabel(id: string) {
  return (
    OBJECTIVE_OPTIONS.find(([key]) => key === id)?.[1] ??
    EQUITIES_OBJECTIVE_OPTIONS.find(([key]) => key === id)?.[1] ??
    id.replaceAll("_", " ")
  );
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
    case "setup.unlock":
      return "Setup code accepted";
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
    case "settings.email":
      return "Email transport saved";
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
    case "feeds":
      return "RSS/Atom";
    case "defillama":
      return "DefiLlama";
    case "hyperliquid":
      return "Hyperliquid";
    case "binance-futures":
      return "Binance USD-M Futures";
    case "polymarket":
      return "Polymarket";
    case "kalshi":
      return "Kalshi";
    case "snapshot":
      return "Snapshot";
    case "alchemy":
      return "Alchemy";
    case "helius":
      return "Helius";
    case "edgar":
      return "SEC EDGAR";
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
