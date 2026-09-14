# X

Riddlr collects named-principal posts through the official recent-search API
(`GET https://api.x.com/2/tweets/search/recent`). It does not scrape X and
does not call archive search (`/2/tweets/search/all`).

X and Discord stay **claim sources only**. Community-tier posts cannot open
events. See [integrations/x.md](../integrations/x.md).

## App setup

1. Create a project and app in the [X Developer Portal](https://developer.x.com/).
2. Copy a bearer token. Riddlr stores it encrypted and never shows it again.
3. Confirm the app's access level includes **recent search** and that the
   account has credits. HTTP 401 is a bad token. HTTP 402 means credits are
   depleted. HTTP 403 means recent search is not on that plan or the app is
   not enrolled.

Sources → **Add source** → **Configure X** requires authors (max 30). Optional
keywords are ANDed with the author watchlist. Mentions-only and keyword-only
sources are rejected. Lookback is 1–168 hours until the first successful fetch;
after that `start_time` is the last success, never earlier than seven days.
Monthly read budget defaults to 5,000 (ceiling 40,000).

## What the adapter actually fetches

The query is `(from:a OR from:b OR ...) -is:retweet -is:reply lang:en` plus
optional ANDed keywords. Query length is capped at 512 characters; a watchlist
that exceeds that bound is rejected. `max_results` is 100. `next_token`
pagination is bounded to 3 pages. `tweet.fields` include `entities`; outbound
URLs come from `entities.urls[].expanded_url`.

The adapter persists author ID, username snapshot, verified flag, referenced
tweets, conversation ID, cashtags, and outbound URLs. Retweets, quotes, copied
text, and a shared linked origin are derived references, not independent
confirmation. Operators set trust on the observed identity under Sources. The
platform family `x` is not authoritative.

Official reference: https://docs.x.com/x-api/posts/search/quickstart/recent-search
