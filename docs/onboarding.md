# Onboarding

First-run is **four steps**. There is no fifth step.

1. **Administrator** — email, password, and password confirmation (at least 12
   characters). Store the password somewhere recoverable.
2. **Security** — first save the password to the device password manager
   (skippable). Then authenticator is strongly advised: scan a Google
   Authenticator QR code or enter the key, confirm a 6-digit code, then save
   recovery codes (shown once). **Skip for now** continues without TOTP;
   enable later in Settings.
3. **LLM provider** — OpenAI-compatible or Anthropic-compatible base URL,
   model, and API key (encrypted at rest, never shown again). **Skip for now**
   continues without a model; scans still collect evidence. Add a provider later
   in Settings.
4. **Domains and sources** — Crypto is selected. Equities, Forex, Commodities,
   and Macro are disabled Coming soon. Optional Telegram. Finish creates the
   default **Riddlr Intelligence Agent** with SearXNG, CoinGecko, and a
   Bitcoin / Ethereum / Tether watchlist. That agent is the Crypto watcher:
   scheduled scans, candidate discovery, and analysis of material events.

After Finish, setup routes close. The origin shows **Sign in**. Password-only
sign-in works until authenticator is enabled.

Overview then shows **Finish the desk**: connect a model if skipped, turn on
authenticator if skipped, add Discord or X, record a portfolio, configure a
notification channel, and run the first scan. These are not extra onboarding
steps.

To run first-run again, wipe instance volumes:

```bash
pnpm compose:reset
```
