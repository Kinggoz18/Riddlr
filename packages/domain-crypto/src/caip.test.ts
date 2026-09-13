import { describe, expect, it } from "vitest";
import { caip19ForPlatform, caip19FromPlatforms } from "./caip.js";

describe("CAIP-19 mapping", () => {
  it("maps an Ethereum contract to eip155:1/erc20 with a lowercase address", () => {
    expect(caip19ForPlatform("ethereum", "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9")).toBe(
      "eip155:1/erc20:0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9",
    );
  });

  it("maps a Solana mint and skips unknown platforms and non-hex EVM addresses", () => {
    expect(caip19FromPlatforms({ solana: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof" })).toEqual([
      "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof",
    ]);
    expect(caip19ForPlatform("tron", "TSSMHYeV2uE9qYH95DqyoCuNCzEL1NvU3S")).toBeUndefined();
    expect(caip19ForPlatform("ethereum", "not-an-address")).toBeUndefined();
  });
});
