import { describe, expect, it } from "vitest";
import { assertPublicWalletAddress, PrivateMaterialError } from "./portfolio.js";

describe("read-only portfolio identifiers", () => {
  it("accepts a public Ethereum address and rejects seeds and private keys", () => {
    expect(
      assertPublicWalletAddress("ethereum", "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"),
    ).toBe("0x742d35cc6634c0532925a3b844bc454e4438f44e");
    expect(() =>
      assertPublicWalletAddress(
        "ethereum",
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      ),
    ).toThrow(PrivateMaterialError);
    expect(() =>
      assertPublicWalletAddress(
        "ethereum",
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    ).toThrow(PrivateMaterialError);
  });
});
