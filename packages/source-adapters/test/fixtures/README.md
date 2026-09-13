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
