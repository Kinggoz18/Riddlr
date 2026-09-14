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
4. **Domains and sources** — Crypto is selected and stays the default agent.
   Equities is selectable (supported). Forex, Commodities, and Macro are
   disabled Coming soon. Optional Telegram. Finish creates the
   default **Riddlr Intelligence Agent** with SearXNG, CoinGecko, and a
   Bitcoin / Ethereum / Tether watchlist. That agent is the Crypto watcher:
   scheduled scans, candidate discovery, and analysis of material events.
   Create an Equities agent after setup and add SEC EDGAR.

After Finish, setup routes close. The origin shows **Sign in**. Password-only
sign-in works until authenticator is enabled.

If Riddlr was started so other devices can open the dashboard without SSH, the
browser asks for the setup code printed at start **before** step 1. That
screen is not a fifth onboarding step. Unused codes expire after 15 minutes;
print a new one from the machine that runs Docker. After Finish, the code
stops working.

Saving a model checks that it answers. **Skip for now** still continues without
a model; scans collect evidence and analysis waits. Finish starts the default
Crypto scan when the queue is available. Overview shows that scan instead of
asking you to run one by hand.

Optional leftovers (authenticator, Discord/X, portfolio, notifications) stay
under **Finish the desk**. They are not extra onboarding steps.

To run first-run again, wipe instance volumes:

```bash
pnpm compose:reset
```
