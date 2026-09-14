# X API v2 recent search

X is an **opt-in** evidence source for named-principal statements. It is a
claim source only. Community-tier posts attach to events; they cannot open
one. Official-firsthand and known-analyst identities can create unverified
early warnings.

## Setup

Sources → **Add source** → **Configure X**. Paste an app-only bearer token.
Add 1–30 author handles. Optional keywords are ANDed, not ORed. Mentions-only
sources are rejected.

Monthly read budget defaults to 5,000 unique posts (`meta.result_count`
counted on `source_fetch_requests`). Ceiling 40,000. When the budget is
spent, health is `capability_missing: monthly read budget exhausted` and the
adapter does not call X.

## What the adapter actually fetches

| Call | Use |
| --- | --- |
| `GET https://api.x.com/2/tweets/search/recent` | Named-principal recent search |

Query: `(from:a OR from:b OR ...) -is:retweet -is:reply lang:en` plus optional
ANDed keywords. Query length ≤ 512 characters. A 30-author list of maximum
handle length is rejected when it exceeds that bound.

`tweet.fields=created_at,author_id,lang,public_metrics,referenced_tweets,conversation_id,entities`,
`expansions=author_id,referenced_tweets.id`,
`user.fields=username,verified,public_metrics`. `max_results` = 100.
`next_token` bounded to 3 pages. `start_time` is the last successful fetch
stored on the source, never earlier than 7 days.

Outbound URLs are `entities.urls[].expanded_url`. Cashtags in
`entities.cashtags` are appended to the body when missing so the registry can
resolve them.

`/2/tweets/search/all` is never called.

Verified 2026-09-14: `https://docs.x.com/x-api/posts/search/quickstart/recent-search`
returned HTTP 403 from this environment, so live recent-search JSON was not
captured. Error text for HTTP 402 is the documented CreditsDepleted message:
"Your enrolled account does not have any credits to fulfill this request."

Official docs: https://docs.x.com/x-api/posts/search/quickstart/recent-search

| Item | Value |
| --- | --- |
| Adapter | `x` |
| Family | `x` |
| Licence | X API terms; operator-local cache; post text is not re-exposed on a public API |
| Mapping | Native-complete evidence; identity `{ platform: "x", externalId: author_id }` |

## Failure classes

| Class | What you see | Fix |
| --- | --- | --- |
| `capability_missing` | HTTP 402 credits depleted; HTTP 403 plan/enrollment; monthly read budget exhausted | Load credits, enroll recent search, or wait for the next UTC month |
| `auth` | HTTP 401 or `errors[]` title Unauthorized | Replace the bearer token |
| `rate_limited` | HTTP 429. Message includes `x-rate-limit-reset` when present | Wait for the reset |
| `unavailable` | 5xx or timeout | Retry on the next scan |
| `malformed` | HTML 200, missing `data`, or a post missing `id` / text | Schema drift; no silent skip of the page |
| `too_large` | Body over 2 MB | Skip that call |

An empty `data` array with `meta.result_count` 0 is empty success.

## Fixtures

Documented error bodies and empty/drift shapes, 2026-09-14. See
`packages/source-adapters/test/fixtures/README.md`.
