# Registry-driven asset resolution

Watchlist and evidence asset identity is the `assets` registry. The Crypto
module extracts and canonicalizes only against that registry. CoinGecko
`/coins/markets` joined with `/coins/list?include_platform=true` seeds the
top N ids daily. Aliases include symbol, name, cashtag, and CAIP-19 contract
ids. Ambiguous symbols fail closed unless a longer name or cashtag is present.

Operators add assets by search over the registry. Unknown canonical ids are
rejected. Rank leaving the top N never deactivates a watched or held asset.

**Status:** accepted
