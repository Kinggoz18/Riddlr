import { describe, expect, it } from "vitest";
import {
  blockedPublisherHosts,
  DEFAULT_OFFICIAL_FIRSTHAND_HOSTS,
  DEFAULT_PRICE_TRACKER_HOSTS,
  DEFAULT_REPUTABLE_PRESS_HOSTS,
  publisherHostIsBlocked,
} from "./publisher-hosts.js";

describe("default price-tracker publisher hosts", () => {
  it("blocks CoinGecko and CoinMarketCap hosts when no operator policy exists", () => {
    expect(DEFAULT_PRICE_TRACKER_HOSTS).toContain("coingecko.com");
    expect(DEFAULT_PRICE_TRACKER_HOSTS).toContain("coinmarketcap.com");
    expect(publisherHostIsBlocked("www.coingecko.com", [])).toBe(true);
    expect(publisherHostIsBlocked("coinmarketcap.com", [])).toBe(true);
    expect(publisherHostIsBlocked("reuters.com", [])).toBe(false);
    expect(DEFAULT_REPUTABLE_PRESS_HOSTS).toContain("reuters.com");
    expect(DEFAULT_OFFICIAL_FIRSTHAND_HOSTS).toContain("sec.gov");
  });

  it("honors an explicit unblock over the default block list", () => {
    expect(
      publisherHostIsBlocked("coingecko.com", [
        { hostname: "coingecko.com", blocked: false, revision: 2 },
        { hostname: "coingecko.com", blocked: true, revision: 1 },
      ]),
    ).toBe(false);
    expect(
      blockedPublisherHosts([{ hostname: "coingecko.com", blocked: false, revision: 1 }]),
    ).not.toContain("coingecko.com");
    expect(
      blockedPublisherHosts([{ hostname: "news.example.com", blocked: true, revision: 1 }]),
    ).toEqual(expect.arrayContaining(["news.example.com", "tradingview.com"]));
  });
});
