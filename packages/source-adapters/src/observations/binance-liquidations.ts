import {
  BINANCE_WS_RECONNECT_MAX_MS,
  BINANCE_WS_RECONNECT_MIN_MS,
  isFiniteNumber,
  MAX_BINANCE_OI_SYMBOLS,
  MAX_BINANCE_WS_BUFFER,
  MAX_BINANCE_WS_FRAME_AGE_MS,
  type SeriesObservation,
  takeBounded,
} from "@riddlr/domain";

export const BINANCE_FUTURES_PROVIDER_ID = "binance-futures";
export const BINANCE_FORCE_ORDER_WS_URL = "wss://fstream.binance.com/ws/!forceOrder@arr";

export type ForceOrderFill = {
  symbol: string;
  notionalUsd: number;
  eventTime: Date;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseDecimal(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function parseForceOrderFrame(payload: unknown): ForceOrderFill | undefined {
  const row = asRecord(payload);
  if (!row || row.e !== "forceOrder") {
    return undefined;
  }
  const order = asRecord(row.o);
  if (!order) {
    return undefined;
  }
  const symbol = typeof order.s === "string" ? order.s.trim().toUpperCase() : "";
  const filled = parseDecimal(order.z);
  const avgPrice = parseDecimal(order.ap);
  const eventMs = parseDecimal(order.T) ?? parseDecimal(row.E);
  if (!symbol || filled === undefined || avgPrice === undefined || eventMs === undefined) {
    return undefined;
  }
  const notionalUsd = Math.abs(filled * avgPrice);
  if (!isFiniteNumber(notionalUsd)) {
    return undefined;
  }
  return {
    symbol,
    notionalUsd,
    eventTime: new Date(eventMs),
  };
}

export type ForceOrderAggregator = {
  push(payload: unknown): void;
  drain(input: {
    now: Date;
    resolveSubject: (symbol: string) => string | undefined;
  }): SeriesObservation[];
  size(): number;
};

export function createForceOrderAggregator(
  options: { maxBuffer?: number; maxAgeMs?: number; onDrop?: (reason: string) => void } = {},
): ForceOrderAggregator {
  const maxBuffer = options.maxBuffer ?? MAX_BINANCE_WS_BUFFER;
  const maxAgeMs = options.maxAgeMs ?? MAX_BINANCE_WS_FRAME_AGE_MS;
  const frames: ForceOrderFill[] = [];
  return {
    push(payload) {
      const parsed = parseForceOrderFrame(payload);
      if (!parsed) {
        options.onDrop?.("malformed");
        return;
      }
      if (frames.length >= maxBuffer) {
        options.onDrop?.("buffer_full");
        return;
      }
      frames.push(parsed);
    },
    drain({ now, resolveSubject }) {
      const cutoff = now.getTime() - maxAgeMs;
      const currentMinute = Math.floor(now.getTime() / 60_000) * 60_000;
      const keep: ForceOrderFill[] = [];
      const buckets = new Map<string, { usd: number; at: number }>();
      for (const frame of frames) {
        if (frame.eventTime.getTime() < cutoff) {
          continue;
        }
        const minute = Math.floor(frame.eventTime.getTime() / 60_000) * 60_000;
        if (minute >= currentMinute) {
          keep.push(frame);
          continue;
        }
        const key = `${frame.symbol}:${minute}`;
        const current = buckets.get(key) ?? { usd: 0, at: minute };
        current.usd += frame.notionalUsd;
        buckets.set(key, current);
      }
      frames.length = 0;
      frames.push(...keep);
      const observations: SeriesObservation[] = [];
      for (const [key, bucket] of buckets) {
        const symbol = key.split(":")[0] ?? "";
        const subject = resolveSubject(symbol);
        if (!subject) {
          continue;
        }
        observations.push({
          provider: BINANCE_FUTURES_PROVIDER_ID,
          metric: "liquidations_1m_usd",
          subjectCanonicalId: subject,
          value: bucket.usd,
          unit: "usd",
          observedAt: new Date(bucket.at),
        });
      }
      return takeBounded(observations, MAX_BINANCE_OI_SYMBOLS);
    },
    size() {
      return frames.length;
    },
  };
}

let sharedAggregator: ForceOrderAggregator | undefined;

export function sharedBinanceForceOrderAggregator(options?: {
  onDrop?: (reason: string) => void;
}): ForceOrderAggregator {
  sharedAggregator ??= createForceOrderAggregator(options);
  return sharedAggregator;
}

export function reconnectDelayMs(attempt: number, random = Math.random): number {
  const exp = Math.min(
    BINANCE_WS_RECONNECT_MAX_MS,
    BINANCE_WS_RECONNECT_MIN_MS * 2 ** Math.min(Math.max(attempt, 0), 5),
  );
  return Math.floor(exp / 2 + random() * (exp / 2));
}

export async function runBinanceForceOrderSocket(options: {
  aggregator: ForceOrderAggregator;
  isEnabled: () => Promise<boolean>;
  url?: string;
  webSocket?: typeof WebSocket;
  delayMs?: (attempt: number) => number;
  signal?: AbortSignal;
  logger?: { warn: (payload: unknown, message: string) => void };
}): Promise<void> {
  const WebSocketImpl = options.webSocket ?? WebSocket;
  const url = options.url ?? BINANCE_FORCE_ORDER_WS_URL;
  let attempt = 0;
  while (!options.signal?.aborted) {
    const enabled = await options.isEnabled();
    if (!enabled) {
      await sleep(options.delayMs?.(attempt) ?? reconnectDelayMs(attempt), options.signal);
      continue;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocketImpl(url);
        const onAbort = () => {
          try {
            ws.close();
          } catch {
            /* closed */
          }
          resolve();
        };
        options.signal?.addEventListener("abort", onAbort, { once: true });
        ws.addEventListener("open", () => {
          attempt = 0;
        });
        ws.addEventListener("message", (event) => {
          const data = typeof event.data === "string" ? event.data : String(event.data);
          try {
            options.aggregator.push(JSON.parse(data) as unknown);
          } catch {
            options.aggregator.push(data);
          }
        });
        ws.addEventListener("error", () => {
          options.logger?.warn({ url }, "Binance forceOrder socket error");
        });
        ws.addEventListener("close", () => {
          options.signal?.removeEventListener("abort", onAbort);
          resolve();
        });
        if (typeof ws.addEventListener !== "function") {
          reject(new Error("WebSocket implementation missing addEventListener."));
        }
      });
    } catch (error) {
      options.logger?.warn({ err: error, url }, "Binance forceOrder socket failed");
    }
    attempt += 1;
    await sleep(options.delayMs?.(attempt) ?? reconnectDelayMs(attempt), options.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
