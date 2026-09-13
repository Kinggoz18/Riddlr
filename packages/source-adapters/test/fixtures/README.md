# Source adapter fixtures

Captured from live provider responses. Secrets are not present in these files.

| File | URL | Captured |
| --- | --- | --- |
| `coingecko/markets-page1.json` | `GET https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1` | 2026-09-13 |
| `coingecko/coins-list-truncated.json` | `GET https://api.coingecko.com/api/v3/coins/list?include_platform=true` (truncated to the captured markets page plus collision and common-word ids) | 2026-09-13 |
| `coingecko/empty.json` | Empty JSON array (`[]`), the documented empty list body | 2026-09-13 |
| `coingecko/markets-drift-missing-id.json` | First row of the captured markets page with `id` removed to represent schema drift | 2026-09-13 |
| `coingecko/invalid-vs-currency.json` | `GET https://api.coingecko.com/api/v3/coins/markets?vs_currency=not-a-currency` (HTTP 400) | 2026-09-13 |
