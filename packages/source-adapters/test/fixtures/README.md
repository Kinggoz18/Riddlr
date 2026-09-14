# Source adapter fixtures

Captured from live provider responses. Secrets are not present in these files.

| File | URL | Captured |
| --- | --- | --- |
| `coingecko/markets-page1.json` | `GET https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1` | 2026-09-13 |
| `coingecko/coins-list-truncated.json` | `GET https://api.coingecko.com/api/v3/coins/list?include_platform=true` (truncated to the captured markets page plus collision and common-word ids) | 2026-09-13 |
| `coingecko/empty.json` | Empty JSON array (`[]`), the documented empty list body | 2026-09-13 |
| `coingecko/markets-drift-missing-id.json` | First row of the captured markets page with `id` removed to represent schema drift | 2026-09-13 |
| `coingecko/simple-price.json` | `GET https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true&include_market_cap=true&include_last_updated_at=true` | 2026-09-13 |
| `coingecko/simple-price-empty.json` | Empty JSON object (`{}`), the documented empty map body | 2026-09-13 |
| `coingecko/simple-price-drift-missing-usd.json` | Captured simple/price body with bitcoin `usd` removed to represent schema drift | 2026-09-13 |
| `coingecko/simple-price-invalid.json` | `GET https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=` (HTTP 422) | 2026-09-13 |
| `feeds/rss-federalreserve-press-all.xml` | `GET https://www.federalreserve.gov/feeds/press_all.xml` (first three `<item>` elements) | 2026-09-14 |
| `feeds/rss-federalreserve-empty-channel.xml` | Same capture with all `<item>` elements removed to represent an empty channel | 2026-09-14 |
| `feeds/rss-federalreserve-drift-missing-title.xml` | First captured item with `<title>` removed to represent schema drift | 2026-09-14 |
| `feeds/atom-github-bitcoin-releases.xml` | `GET https://github.com/bitcoin/bitcoin/releases.atom` (first two `<entry>` elements) | 2026-09-14 |
| `feeds/atom-youtube-google.xml` | `GET https://www.youtube.com/feeds/videos.xml?channel_id=UCK8sQmJBp8GCxrOtXWBpyEA` (first `<entry>`) | 2026-09-14 |
| `feeds/html-200-federalreserve-home.html` | `GET https://www.federalreserve.gov/` HTML 200 (first 25 lines) used as a non-XML body | 2026-09-14 |
| `searxng/news-bitcoin.json` | `GET http://searxng:8080/search?q=bitcoin&format=json&categories=news&time_range=day&language=en` (first three `results`) | 2026-09-14 |
| `searxng/empty.json` | Empty JSON search body (`results: []`), the documented empty list | 2026-09-14 |
| `searxng/news-bitcoin-drift-missing-url-title.json` | First captured news result with `url` and `title` removed to represent schema drift | 2026-09-14 |
| `defillama/protocols-truncated.json` | `GET https://api.llama.fi/protocols` (first 50 rows with `gecko_id`) | 2026-09-14 |
| `defillama/protocol-aave.json` | `GET https://api.llama.fi/protocol/aave` (`currentChainTvls` trimmed to Ethereum/borrowed/staking; `tvl` last three points) | 2026-09-14 |
| `defillama/protocol-aave-drift-missing-tvl.json` | Same capture with `tvl` removed to represent schema drift | 2026-09-14 |
| `defillama/chains-truncated.json` | `GET https://api.llama.fi/v2/chains` (first 40 rows) | 2026-09-14 |
| `defillama/historical-chain-tvl-ethereum.json` | `GET https://api.llama.fi/v2/historicalChainTvl/Ethereum` (last five points) | 2026-09-14 |
| `defillama/stablecoins-truncated.json` | `GET https://stablecoins.llama.fi/stablecoins?includePrices=true` (first eight `peggedAssets`) | 2026-09-14 |
| `defillama/coins-current.json` | `GET https://coins.llama.fi/prices/current/coingecko:tether,coingecko:usd-coin` | 2026-09-14 |
| `defillama/hacks-truncated.json` | `GET https://api.llama.fi/hacks` (first eight rows; captured `source` fields were empty) | 2026-09-14 |
| `defillama/empty-array.json` | Empty JSON array (`[]`) | 2026-09-14 |
| `defillama/empty-object.json` | Empty JSON object (`{}`) | 2026-09-14 |
| `hyperliquid/meta-and-asset-ctxs.json` | `POST https://api.hyperliquid.xyz/info` `{"type":"metaAndAssetCtxs"}` (BTC, ETH, ATOM, SOL, AVAX, DOGE, LINK, XRP, UNI rows) | 2026-09-14 |
| `hyperliquid/meta-and-asset-ctxs-drift-mismatch.json` | Same capture with one fewer `assetCtxs` row to represent index drift | 2026-09-14 |
| `hyperliquid/predicted-fundings.json` | `POST https://api.hyperliquid.xyz/info` `{"type":"predictedFundings"}` (BTC, ETH, SOL, DOGE, XRP, AVAX, LINK, UNI) | 2026-09-14 |
| `hyperliquid/empty-array.json` | Empty JSON array (`[]`) | 2026-09-14 |
| `hyperliquid/empty-object.json` | Empty JSON object (`{}`) | 2026-09-14 |
| `binance-futures/premium-index.json` | `GET https://testnet.binancefuture.com/fapi/v1/premiumIndex` (truncated; production `fapi.binance.com` NXDOMAIN from this host) | 2026-09-14 |
| `binance-futures/premium-index-drift-missing-mark.json` | Captured BTCUSDT row with `markPrice` removed to represent schema drift | 2026-09-14 |
| `binance-futures/open-interest-btcusdt.json` | `GET https://testnet.binancefuture.com/fapi/v1/openInterest?symbol=BTCUSDT` | 2026-09-14 |
| `binance-futures/open-interest-unknown.json` | `GET https://testnet.binancefuture.com/fapi/v1/openInterest?symbol=NOTACOINUSDT` (HTTP 400 `code:-1121`) | 2026-09-14 |
| `binance-futures/force-order-frames.json` | `wss://stream.binancefuture.com/ws/!forceOrder@arr` (two frames in one minute; production `fstream.binance.com` NXDOMAIN from this host) | 2026-09-14 |
| `binance-futures/empty-array.json` | Empty JSON array (`[]`) | 2026-09-14 |
| `polymarket/events-keyset-truncated.json` | `GET https://gamma-api.polymarket.com/events/keyset?active=true&closed=false&limit=100` (truncated) | 2026-09-14 |
| `polymarket/event-fed-rate-hike.json` | `GET https://gamma-api.polymarket.com/events?slug=fed-rate-hike-in-2026` | 2026-09-14 |
| `polymarket/event-fed-decision-closed.json` | `GET https://gamma-api.polymarket.com/events?slug=fed-decision-in-october` | 2026-09-14 |
| `polymarket/market-fed-rate-hike.json` | `GET https://gamma-api.polymarket.com/markets?slug=fed-rate-hike-in-2026` | 2026-09-14 |
| `polymarket/market-drift-missing-tokens.json` | Captured market with `clobTokenIds` removed to represent schema drift | 2026-09-14 |
| `polymarket/midpoint.json` | `GET https://clob.polymarket.com/midpoint?token_id=<YES>` (`{"mid":"0.905"}`) | 2026-09-14 |
| `polymarket/prices-history.json` | `GET https://clob.polymarket.com/prices-history?market=<YES>&interval=1d&fidelity=5` | 2026-09-14 |
| `polymarket/empty-array.json` | Empty JSON array (`[]`) | 2026-09-14 |
| `polymarket/empty-object.json` | Empty JSON object (`{}`) | 2026-09-14 |
| `kalshi/series-kxcpi.json` | `GET https://external-api.kalshi.com/trade-api/v2/series/KXCPI` | 2026-09-14 |
| `kalshi/series-unknown.json` | `GET https://external-api.kalshi.com/trade-api/v2/series/NOTASERIES` (HTTP 404) | 2026-09-14 |
| `kalshi/markets-kxcpi-truncated.json` | `GET https://external-api.kalshi.com/trade-api/v2/markets?series_ticker=KXCPI&status=open&limit=100` (truncated) | 2026-09-14 |
| `kalshi/market-drift-missing-bid.json` | Captured market with yes bid/ask removed to represent schema drift | 2026-09-14 |
| `kalshi/orderbook-kxcpi-26sep-t0.6.json` | `GET https://external-api.kalshi.com/trade-api/v2/markets/KXCPI-26SEP-T0.6/orderbook?depth=5` | 2026-09-14 |
| `kalshi/empty-markets.json` | `{"markets":[]}` | 2026-09-14 |
| `kalshi/empty-object.json` | Empty JSON object (`{}`) | 2026-09-14 |
| `snapshot/proposals-grove-truncated.json` | `POST https://hub.snapshot.org/graphql` `proposals` for `grovefinance.eth` (two active proposals; bodies truncated to 500 characters) | 2026-09-14 |
| `snapshot/proposals-drift-missing-id.json` | Same capture with the first proposal `id` removed to represent schema drift | 2026-09-14 |
| `snapshot/empty-proposals.json` | `{"data":{"proposals":[]}}`, the documented empty list | 2026-09-14 |
| `snapshot/errors-unknown-argument.json` | GraphQL `errors[]` for unknown argument `bogus` (HTTP 400) | 2026-09-14 |
| `snapshot/empty-object.json` | Empty JSON object (`{}`) | 2026-09-14 |
| `alchemy/address-activity.json` | Documented ADDRESS_ACTIVITY example from https://www.alchemy.com/docs/reference/address-activity-webhook.md (two transfers: USDC 293.092129 and 2400; not three) | 2026-09-14 |
| `alchemy/address-activity-drift-missing-hash.json` | Same capture with the first activity `hash` removed to represent schema drift | 2026-09-14 |
| `alchemy/empty-activity.json` | Documented envelope with `event.activity: []` | 2026-09-14 |
| `alchemy/empty-object.json` | Empty JSON object (`{}`) | 2026-09-14 |
| `helius/enhanced-transfer.json` | Documented enhanced TRANSFER example (0.1 SOL, signature `5rfFLBUp5YPr6rC2g1KBBW8LGZBcZ8Lvs7gKAdgrBjmQvFf6EKkgc5cpAQUTwGxDJbNqtLYkjV5vS5zVK4tb6JtP`) | 2026-09-14 |
| `helius/enhanced-transfer-drift-missing-signature.json` | Same capture with `signature` removed to represent schema drift | 2026-09-14 |
| `helius/empty-array.json` | Empty JSON array (`[]`) | 2026-09-14 |
| `helius/empty-object.json` | Empty JSON object (`{}`) | 2026-09-14 |
| `discord/message-example.json` | Documented Get Channel Messages example (id `334385199974967042`, content `Supa Hot`) from https://discord.com/developers/docs/resources/message | 2026-09-14 |
| `discord/message-drift-missing-id.json` | Same documented message with `id` removed to represent schema drift | 2026-09-14 |
| `discord/archived-thread.json` | Documented public thread channel example (id `41771983423143937`) from https://discord.com/developers/docs/resources/channel | 2026-09-14 |
| `discord/archived-threads.json` | List Public Archived Threads envelope wrapping that documented thread (`has_more: false`) | 2026-09-14 |
| `discord/missing-access.json` | Documented Discord JSON error `50001` Missing Access | 2026-09-14 |
| `discord/empty-array.json` | Empty JSON array (`[]`) | 2026-09-14 |
| `discord/empty-object.json` | Empty JSON object (`{}`) | 2026-09-14 |
| `x/credits-depleted.json` | Documented HTTP 402 CreditsDepleted body (`Your enrolled account does not have any credits to fulfill this request.`) | 2026-09-14 |
| `x/client-forbidden.json` | HTTP 403 recent-search plan gap (`Client Forbidden`) | 2026-09-14 |
| `x/empty-data.json` | Empty recent-search `data` array with `meta.result_count` 0 | 2026-09-14 |
| `x/empty-object.json` | Empty JSON object (`{}`) | 2026-09-14 |
| `x/search-drift-missing-id.json` | Recent-search `data` row with `id` removed to represent schema drift | 2026-09-14 |
