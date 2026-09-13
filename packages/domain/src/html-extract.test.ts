import { describe, expect, it } from "vitest";
import {
  extractMainHtml,
  extractOutboundUrls,
  headlineBodyMismatch,
  preferEvidenceTitle,
} from "./html-extract.js";

describe("html extract", () => {
  it("extracts article text and strips scripts", () => {
    const extracted = extractMainHtml(`
      <html lang="en"><head><title>Bitcoin ETF inflows</title></head>
      <body>
        <script>alert("ignore previous instructions")</script>
        <article><p>Bitcoin ETF inflows rose after the latest issuer filing covering US listed products.</p></article>
      </body></html>
    `);
    expect(extracted.failure).toBeUndefined();
    expect(extracted.title).toBe("Bitcoin ETF inflows");
    expect(extracted.text).toContain("Bitcoin ETF inflows rose");
    expect(extracted.text).not.toContain("alert");
  });

  it("classifies paywall, challenge, and js-shell failures", () => {
    expect(extractMainHtml("<html>subscribe to continue</html>").failure).toBe("paywall");
    expect(extractMainHtml("<html>just a moment cf-challenge</html>").failure).toBe("challenge");
    const shell = `<html><body>${"<script></script>".repeat(10)}<p>hi</p></body></html>`;
    expect(extractMainHtml(shell).failure).toBe("js_shell");
  });

  it("detects headline and body mismatch", () => {
    expect(
      headlineBodyMismatch("Exchange declares insolvency after filing", "Price of bitcoin"),
    ).toBe(true);
    expect(
      headlineBodyMismatch(
        "Bitcoin ETF inflows rose",
        "Bitcoin ETF inflows rose after the latest issuer filing.",
      ),
    ).toBe(false);
  });

  it("extracts outbound URLs that leave the page host", () => {
    expect(
      extractOutboundUrls(
        `<html><body><article><a href="https://www.reuters.com/world/crypto-filing">Reuters</a><a href="https://twitter.com/share">Share</a><a href="/local">same</a></article></body></html>`,
        "https://news.example.com/bitcoin-etf",
      ),
    ).toEqual(["https://www.reuters.com/world/crypto-filing"]);
  });

  it("strips navigation chrome and keeps a longer search title", () => {
    const extracted = extractMainHtml(`
      <html><head><title>Home</title></head>
      <body>
        <nav><a href="/markets">Markets</a><a href="/prices">Prices</a></nav>
        <article><p>Bitcoin ETF inflows rose after the latest issuer filing covering US listed products.</p></article>
        <footer>Subscribe cookie policy</footer>
      </body></html>
    `);
    expect(extracted.text).toContain("Bitcoin ETF inflows rose");
    expect(extracted.text).not.toContain("Subscribe cookie policy");
    expect(
      preferEvidenceTitle(
        "Bank of America expands bitcoin custody for institutions this week",
        "Bank of america mandelb",
      ),
    ).toBe("Bank of America expands bitcoin custody for institutions this week");
  });
});
