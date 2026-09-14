import { describe, expect, it } from "vitest";
import {
  CRYPTO_SHIPPED_LABELED_ADDRESSES,
  labeledAddressLookup,
  transferReasonCodes,
} from "./labeled-addresses.js";

describe("shipped labeled addresses", () => {
  it("ships Binance 14, Coinbase 10, and Wormhole Token Bridge as 40-hex addresses", () => {
    expect(CRYPTO_SHIPPED_LABELED_ADDRESSES).toHaveLength(3);
    expect(CRYPTO_SHIPPED_LABELED_ADDRESSES[0]).toEqual({
      chain: "ethereum",
      address: "0x28c6c06298d514db089934071355e5743bf21d60",
      label: "Binance 14",
      role: "exchange",
    });
    expect(CRYPTO_SHIPPED_LABELED_ADDRESSES[0]?.address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(CRYPTO_SHIPPED_LABELED_ADDRESSES[1]?.address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(CRYPTO_SHIPPED_LABELED_ADDRESSES[2]?.role).toBe("bridge");
  });

  it("looks up labels by chain:lowercase address", () => {
    const map = labeledAddressLookup(CRYPTO_SHIPPED_LABELED_ADDRESSES);
    expect(map.get("ethereum:0x28c6c06298d514db089934071355e5743bf21d60")?.label).toBe(
      "Binance 14",
    );
    expect(transferReasonCodes({ toRole: "exchange" })).toEqual(["exchange_inflow"]);
    expect(transferReasonCodes({ fromRole: "treasury" })).toEqual(["treasury_outflow"]);
    expect(transferReasonCodes({ fromRole: "bridge" })).toEqual(["bridge_outflow"]);
  });
});
