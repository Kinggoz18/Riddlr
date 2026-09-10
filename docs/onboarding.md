# Onboarding

First-run is **four steps**. There is no fifth step.

1. **Administrator** — email and a password of at least 12 characters
2. **Authenticator** — generate a TOTP secret, verify a 6-digit code, save
   recovery codes (shown once)
3. **LLM provider** — OpenAI-compatible or Anthropic-compatible base URL,
   model, and API key (encrypted at rest, never shown again)
4. **Domains and sources** — Crypto is selected. Equities, Forex, Commodities,
   and Macro are disabled Coming soon. Optional Telegram. Finish creates the
   default **Riddlr Intelligence Agent**

After Finish, setup routes close. The origin shows **Sign in**.

To run first-run again, wipe instance volumes:

```bash
pnpm compose:reset
```
