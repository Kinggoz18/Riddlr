# SEC EDGAR

EDGAR is an **opt-in** evidence source for SEC filings. There is no API key.
The SEC requires a declared User-Agent of the form
`Riddlr/<version> <operator contact email>`. The operator supplies the email
on the source form. Mozilla-compatible strings and GitHub URLs return HTTP 403
undeclared automated tool.

Fair-use cap is 10 requests per second. Poll every 2 minutes in US business
hours (America/New_York weekdays 09:00–17:00), otherwise 15 minutes.

## Setup

Sources → **Add source** → **Configure SEC EDGAR**. One source. Set the contact
email. Attach the source to an Equities agent (new sources attach to the
default Crypto agent only). Crypto agents use the EFTS keyword path only.
Company IR RSS feeds use the existing feeds adapter; attach them to the
Equities agent.

## What the adapter actually fetches

| Call | Use |
| --- | --- |
| `GET https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&count=100&output=atom` | Current 8-K Atom. Also `type=4`, `type=10-Q`, `type=SC 13D`. |
| `GET https://www.sec.gov/files/company_tickers.json` | Daily equities registry seed (`cik_str`, `ticker`, `title`). |
| `GET https://data.sec.gov/submissions/CIK##########.json` | Recent filings, 8-K items, primary document. |
| `GET https://efts.sec.gov/LATEST/search-index` | Crypto-adjacent full-text search. Cap 100 hits. One keyword query per hour. |
| `GET https://www.sec.gov/Archives/edgar/data/<cik>/<accession>/form4.xml` | Form 4 XML. `xslF345X*` prefixes are stripped. |

Equities agents keep Atom entries whose CIK is on the watchlist. Unwatched
issuers are discarded. Crypto agents do not poll Atom; they search EFTS with
watchlist symbols and names.

8-K items map: `1.01`/`1.02` material corporate event; `2.02` earnings; `2.04`/`2.05`/`2.06`
impairment or exit; `3.01` listing or delisting; `5.02` officer change; `8.01`
material corporate event; `1.03` insolvency. Form 4 is insider transaction,
value = shares × price, unit `usd`, never high impact alone. 8-K 2.02 and 1.03
default high.

Atom items can complete an event without fetching the iXBRL body.

Verified 2026-09-14: User-Agent `Riddlr/0.1 <email>` is accepted. A Mozilla
compatible string with a GitHub URL returns 403 undeclared automated tool.
Redirects are not followed. Bodies over 2 MB are rejected.

Official docs: https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data

| Item | Value |
| --- | --- |
| Adapter | `edgar` |
| Family | `filing` |
| Licence | Public SEC data; declared User-Agent required |
| Mapping | Native-complete evidence; identity `{ platform: "sec", externalId: cik }` at `official_firsthand` |

## Failure classes

| Class | What you see | Fix |
| --- | --- | --- |
| `blocked` | 403 undeclared automated tool, or missing contact email | Set contact email. User-Agent must be `Riddlr/<version> <email>` with no Mozilla string and no GitHub URL. |
| `rate_limited` | HTTP 429. Message includes `Retry-After` when sent. | Wait for the next poll. |
| `unavailable` | 5xx, timeout, redirect, or HTML Atom body | Check sec.gov |
| `malformed` | Atom entry missing title, Form 4 missing transaction code, ticker row missing ticker | Schema drift; that entry is skipped |
| `too_large` | Body over 2 MB | Skip that call |
| `source_disabled` | No enabled EDGAR source | Add the source; it is not auto-created |

An empty Atom feed is empty success. A watchlist change mid-scan does not drop
items already parsed; CIK filters are recomputed on the next scan.

## Fixtures

Captured 2026-09-14. See
`packages/source-adapters/test/fixtures/README.md`.
