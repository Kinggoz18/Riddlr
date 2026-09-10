# X

Riddlr collects X posts through the official recent-search API
(`GET https://api.x.com/2/tweets/search/recent`). It does not scrape X and
does not call archive search (`/2/tweets/search/all`).

## App setup

1. Create a project and app in the [X Developer Portal](https://developer.x.com/).
2. Copy a bearer token. Riddlr stores it encrypted and never shows it again.
3. Confirm the app's access level includes **recent search**. Free and some
   paid plans do not. A 401 is a bad token. A 403 means recent search is not
   available on that plan.

Sources → **Add X source** accepts authors, mentions, keywords, and a lookback
of 1–168 hours (seven days). Provide at least one of authors, mentions, or
keywords.

## What the adapter actually fetches

Recent search covers a rolling seven-day window. `max_results` is 10–100;
Riddlr sends at most 50. The query string is capped at 512 characters.
`start_time` is clamped to that seven-day window.

Official reference: https://docs.x.com/x-api/posts/search/quickstart/recent-search
