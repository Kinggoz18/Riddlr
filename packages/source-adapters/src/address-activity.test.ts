import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  boundActivityItems,
  classifyTransfer,
  shouldPersistTransfer,
  subjectCanonicalIdForTransfer,
  usdNotionalForTransfer,
} from "./address-activity.js";
import {
  createAlchemyAddressWebhook,
  parseAlchemyActivityItem,
  parseAlchemyAddressActivity,
  parseAlchemyCreateWebhook,
  parseAlchemyTeamWebhooks,
} from "./alchemy-activity.js";
import {
  createHeliusTransferWebhook,
  parseHeliusCreateWebhook,
  parseHeliusEnhancedPayload,
} from "./helius-activity.js";

const alchemyFixtures = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/alchemy");
const heliusFixtures = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/helius");

function readJson(dir: string, name: string): unknown {
  return JSON.parse(readFileSync(join(dir, name), "utf8")) as unknown;
}

describe("Alchemy ADDRESS_ACTIVITY parser", () => {
  it("parses the documented two-transfer payload and USDC values", () => {
    const parsed = parseAlchemyAddressActivity(readJson(alchemyFixtures, "address-activity.json"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.envelope?.webhookId).toBe("wh_k63lg72rxda78gce");
    expect(parsed.envelope?.eventId).toBe("whevt_vq499kv7elmlbp2v");
    expect(parsed.envelope?.transfers).toHaveLength(2);
    expect(parsed.envelope?.transfers[0]?.amount).toBe(293.092129);
    expect(parsed.envelope?.transfers[0]?.assetSymbol).toBe("USDC");
    expect(parsed.envelope?.transfers[0]?.explorerUrl).toContain(
      "0x7a4a39da2a3fa1fc2ef88fd1eaea070286ed2aba21e0419dcfb6d5c5d9f02a72",
    );
    expect(parsed.envelope?.transfers[1]?.amount).toBe(2400);
  });

  it("returns no transfers for the documented empty activity list", () => {
    const parsed = parseAlchemyAddressActivity(readJson(alchemyFixtures, "empty-activity.json"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.envelope?.transfers).toEqual([]);
  });

  it("classifies an empty object as malformed", () => {
    const parsed = parseAlchemyAddressActivity(readJson(alchemyFixtures, "empty-object.json"));
    expect(parsed.envelope).toBeUndefined();
    expect(parsed.errors[0]?.class).toBe("malformed");
  });

  it("classifies a captured activity missing hash as malformed", () => {
    const parsed = parseAlchemyActivityItem(
      (
        readJson(alchemyFixtures, "address-activity-drift-missing-hash.json") as {
          event: { activity: unknown[] };
        }
      ).event.activity[0],
    );
    expect(parsed.transfer).toBeUndefined();
    expect(parsed.errors[0]?.class).toBe("malformed");
  });
});

describe("Helius enhanced TRANSFER parser", () => {
  it("parses the documented 0.1 SOL transfer", () => {
    const parsed = parseHeliusEnhancedPayload(readJson(heliusFixtures, "enhanced-transfer.json"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.envelopes).toHaveLength(1);
    expect(parsed.envelopes[0]?.transfers[0]?.amount).toBe(0.1);
    expect(parsed.envelopes[0]?.transfers[0]?.assetSymbol).toBe("SOL");
    expect(parsed.envelopes[0]?.eventId).toBe(
      "5rfFLBUp5YPr6rC2g1KBBW8LGZBcZ8Lvs7gKAdgrBjmQvFf6EKkgc5cpAQUTwGxDJbNqtLYkjV5vS5zVK4tb6JtP",
    );
  });

  it("returns no envelopes for the documented empty array", () => {
    const parsed = parseHeliusEnhancedPayload(readJson(heliusFixtures, "empty-array.json"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.envelopes).toEqual([]);
  });

  it("classifies an empty object as malformed", () => {
    const parsed = parseHeliusEnhancedPayload(readJson(heliusFixtures, "empty-object.json"));
    expect(parsed.envelopes).toEqual([]);
    expect(parsed.errors[0]?.class).toBe("malformed");
  });

  it("classifies a captured transaction missing signature as malformed", () => {
    const parsed = parseHeliusEnhancedPayload(
      readJson(heliusFixtures, "enhanced-transfer-drift-missing-signature.json"),
    );
    expect(parsed.envelopes).toEqual([]);
    expect(parsed.errors[0]?.class).toBe("malformed");
  });
});

describe("address-activity classification", () => {
  it("treats documented USDC value as usd notional below the $1M floor", () => {
    const transfer = {
      txHash: "0x7a4a39da2a3fa1fc2ef88fd1eaea070286ed2aba21e0419dcfb6d5c5d9f02a72",
      logIndex: "0x6e",
      fromAddress: "0x503828976d22510aad0201ac7ec88293211d23da",
      toAddress: "0xbe3f4b43db5eb49d1f48f53443b9abce45da3b79",
      assetSymbol: "USDC",
      amount: 293.092129,
      chain: "ethereum" as const,
      explorerUrl: "https://etherscan.io/tx/0xabc",
      category: "token",
    };
    expect(usdNotionalForTransfer(transfer, {})).toBe(293.092129);
    const classified = classifyTransfer(transfer, {
      labels: new Map(),
      portfolio: new Set(),
      prices: {},
    });
    expect(classified.aboveLargeThreshold).toBe(false);
    expect(shouldPersistTransfer(classified)).toBe(false);
  });

  it("persists an exchange inflow at the $1M floor", () => {
    const transfer = {
      txHash: "0xabc",
      logIndex: "0x1",
      fromAddress: "0x1111111111111111111111111111111111111111",
      toAddress: "0x28c6c06298d514db089934071355e5743bf21d60",
      assetSymbol: "USDC",
      amount: 1_000_000,
      chain: "ethereum" as const,
      explorerUrl: "https://etherscan.io/tx/0xabc",
      category: "token",
    };
    const classified = classifyTransfer(transfer, {
      labels: new Map([
        [
          "ethereum:0x28c6c06298d514db089934071355e5743bf21d60",
          { label: "Binance 14", role: "exchange" },
        ],
      ]),
      portfolio: new Set(),
      prices: {},
    });
    expect(classified.reasonCodes).toEqual(["exchange_inflow"]);
    expect(classified.aboveLargeThreshold).toBe(true);
    expect(shouldPersistTransfer(classified)).toBe(true);
  });

  it("prices ETH and SOL from the latest spot series keys", () => {
    expect(
      usdNotionalForTransfer(
        {
          txHash: "0xabc",
          logIndex: "0x1",
          fromAddress: "0x1111111111111111111111111111111111111111",
          toAddress: "0x2222222222222222222222222222222222222222",
          assetSymbol: "ETH",
          amount: 2,
          chain: "ethereum",
          explorerUrl: "https://etherscan.io/tx/0xabc",
          category: "external",
        },
        { "coingecko:ethereum": 2000 },
      ),
    ).toBe(4000);
    expect(
      usdNotionalForTransfer(
        {
          txHash: "sig",
          logIndex: "native:0",
          fromAddress: "So11111111111111111111111111111111111111112",
          toAddress: "So22222222222222222222222222222222222222222",
          assetSymbol: "SOL",
          amount: 10,
          chain: "solana",
          explorerUrl: "https://solscan.io/tx/sig",
          category: "native",
        },
        { "coingecko:solana": 150 },
      ),
    ).toBe(1500);
    expect(
      subjectCanonicalIdForTransfer({
        txHash: "0xabc",
        logIndex: "0x1",
        fromAddress: "0x1111111111111111111111111111111111111111",
        toAddress: "0x2222222222222222222222222222222222222222",
        assetSymbol: "WETH",
        amount: 1,
        chain: "ethereum",
        explorerUrl: "https://etherscan.io/tx/0xabc",
        category: "token",
      }),
    ).toBe("coingecko:ethereum");
    expect(
      subjectCanonicalIdForTransfer({
        txHash: "sig",
        logIndex: "native:0",
        fromAddress: "So11111111111111111111111111111111111111112",
        toAddress: "So22222222222222222222222222222222222222222",
        assetSymbol: "SOL",
        amount: 1,
        chain: "solana",
        explorerUrl: "https://solscan.io/tx/sig",
        category: "native",
      }),
    ).toBe("coingecko:solana");
    expect(
      subjectCanonicalIdForTransfer({
        txHash: "0xabc",
        logIndex: "0x1",
        fromAddress: "0x1111111111111111111111111111111111111111",
        toAddress: "0x2222222222222222222222222222222222222222",
        assetSymbol: "USDC",
        amount: 1,
        chain: "ethereum",
        explorerUrl: "https://etherscan.io/tx/0xabc",
        category: "token",
      }),
    ).toBeUndefined();
  });

  it("persists portfolio-owned transfers below the $1M floor", () => {
    const transfer = {
      txHash: "0xabc",
      logIndex: "0x1",
      fromAddress: "0x1111111111111111111111111111111111111111",
      toAddress: "0x2222222222222222222222222222222222222222",
      assetSymbol: "USDC",
      amount: 500,
      chain: "ethereum" as const,
      explorerUrl: "https://etherscan.io/tx/0xabc",
      category: "token",
    };
    const classified = classifyTransfer(transfer, {
      labels: new Map(),
      portfolio: new Set(["ethereum:0x1111111111111111111111111111111111111111"]),
      prices: {},
    });
    expect(classified.aboveLargeThreshold).toBe(false);
    expect(shouldPersistTransfer(classified)).toBe(true);
  });

  it("bounds activity items to 64", () => {
    expect(boundActivityItems(Array.from({ length: 65 }, (_, index) => index))).toHaveLength(64);
  });
});

describe("Alchemy Notify setup calls", () => {
  it("parses a create-webhook body with data.id and signing_key", () => {
    const parsed = parseAlchemyCreateWebhook({
      data: { id: "wh_k63lg72rxda78gce", signing_key: "whsec_test", is_active: true },
    });
    expect(parsed.webhookId).toBe("wh_k63lg72rxda78gce");
    expect(parsed.signingKey).toBe("whsec_test");
    expect(parsed.errors).toEqual([]);
  });

  it("classifies is_active false as a disabled webhook", () => {
    const parsed = parseAlchemyTeamWebhooks(
      { data: [{ id: "wh_k63lg72rxda78gce", is_active: false }] },
      "wh_k63lg72rxda78gce",
    );
    expect(parsed.active).toBe(false);
    expect(parsed.errors).toEqual([]);
  });

  it("classifies HTTP 429 as rate_limited and HTML 200 as unavailable", async () => {
    const limited = await createAlchemyAddressWebhook({
      fetchImpl: async () => new Response("slow down", { status: 429 }),
      notifyToken: "notify-token-fixture",
      webhookUrl: "http://localhost:8080/hooks/alchemy/00000000-0000-4000-8000-000000000001",
      network: "ETH_MAINNET",
      addresses: ["0x28c6c06298d514db089934071355e5743bf21d60"],
    });
    expect(limited.errors[0]?.class).toBe("rate_limited");
    const html = await createAlchemyAddressWebhook({
      fetchImpl: async () =>
        new Response("<html>login</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      notifyToken: "notify-token-fixture",
      webhookUrl: "http://localhost:8080/hooks/alchemy/00000000-0000-4000-8000-000000000001",
      network: "ETH_MAINNET",
      addresses: ["0x28c6c06298d514db089934071355e5743bf21d60"],
    });
    expect(html.errors[0]?.class).toBe("unavailable");
    const redirected = await createAlchemyAddressWebhook({
      fetchImpl: async () =>
        new Response(null, { status: 302, headers: { location: "https://example.invalid" } }),
      notifyToken: "notify-token-fixture",
      webhookUrl: "http://localhost:8080/hooks/alchemy/00000000-0000-4000-8000-000000000001",
      network: "ETH_MAINNET",
      addresses: ["0x28c6c06298d514db089934071355e5743bf21d60"],
    });
    expect(redirected.errors[0]?.class).toBe("unavailable");
  });
});

describe("Helius webhook setup calls", () => {
  it("parses webhookID from a create-webhook body", () => {
    const parsed = parseHeliusCreateWebhook({ webhookID: "webhook-1" });
    expect(parsed.webhookId).toBe("webhook-1");
    expect(parsed.errors).toEqual([]);
  });

  it("classifies HTTP 429 as rate_limited and HTML 200 as unavailable", async () => {
    const limited = await createHeliusTransferWebhook({
      fetchImpl: async () => new Response("slow down", { status: 429 }),
      apiKey: "helius-key-fixture",
      webhookUrl: "http://localhost:8080/hooks/helius/00000000-0000-4000-8000-000000000001",
      authHeader: "riddlr-helius",
      addresses: ["M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K"],
    });
    expect(limited.errors[0]?.class).toBe("rate_limited");
    const html = await createHeliusTransferWebhook({
      fetchImpl: async () =>
        new Response("<html>login</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      apiKey: "helius-key-fixture",
      webhookUrl: "http://localhost:8080/hooks/helius/00000000-0000-4000-8000-000000000001",
      authHeader: "riddlr-helius",
      addresses: ["M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K"],
    });
    expect(html.errors[0]?.class).toBe("unavailable");
  });
});
