# Snapshot

Snapshot is an **opt-in** evidence source for governance proposals. There is no
API key.

Tally is not shipped.

## Setup

Sources → **Add source** → **Configure Snapshot**. One source. Pin space ids
such as `grovefinance.eth` (cap 16). Watched assets also map through a
maintained list in the crypto module (Aave `aave.eth`, Uniswap
`uniswapgovernance.eth`, Compound `compound-governance.eth`, ENS `ens.eth`)
and optional `externalIds.snapshotSpaces` on the asset registry. Grove is not
in that default map; pin it on the form to poll it.

Scans POST once per source. The first poll uses `created_gt` = now − 7 days
when no cursor is stored, then stores the maximum `created` on the page.

Default trust for each space identity is **official firsthand**. Changing a
space's trust later does not get overwritten on the next scan.

Proposal state transitions (`pending` → `active` → `closed`) as `updates`
stance and `editedAt` wait on event lifecycle. This adapter emits
native-complete proposal evidence.

## What the adapter actually fetches

| Call | Use |
| --- | --- |
| `POST https://hub.snapshot.org/graphql` | `proposals(first: 50, where: { space_in, created_gt }, orderBy: "created", orderDirection: "asc")` |

The selection set is `id created title body choices start end state author
space { id name } scores scores_total votes link`. `created` is required for
the cursor; Hub `link` is the canonical URL (shape
`https://snapshot.box/#/s:<space>/proposal/<id>`).

Verified 2026-09-14: Hub `ratelimit-limit` is 100 per 60s. Riddlr caps 60/min.
`aave.eth` and `uniswap` returned an empty `proposals` list (valid empty, not
`capability_missing`). Happy path used `grovefinance.eth` (two active
proposals; `created` equalled `start`; `scores_total` / `votes` were 0). An
unknown GraphQL argument returns HTTP 400 with `errors[].message`. Health
probe is `{ __typename }`. Redirects are not followed. Bodies over 2 MB are
rejected.

Official docs: https://docs.snapshot.box/tools/api

| Item | Value |
| --- | --- |
| Adapter | `snapshot` |
| Family | `governance` |
| Licence | Public GraphQL, no key |
| Mapping | Native-complete evidence; `publishedAt` = `created` unix seconds; author = proposer; identity `{ platform: "snapshot", externalId: space.id }` |

Impact is **moderate** by default. Title or object matching treasury,
emission, fee-switch, or upgrade raises **high**. `scores_total` (else
`votes`) is stored as unit `votes` when present.

## Failure classes

| Class | What you see | Fix |
| --- | --- | --- |
| `rate_limited` | HTTP 429. Message includes `Retry-After` when Hub sent it. | Wait for the next scan. |
| `unavailable` | 5xx, timeout, redirect, or HTML body | Check hub.snapshot.org |
| `malformed` | GraphQL `errors[]`, missing proposals list, or a proposal missing `id` / space / `created` | Schema drift; no silent skip of the page |
| `too_large` | Body over 2 MB | Skip that call |
| `source_disabled` | No enabled Snapshot source | Add the source; it is not auto-created |

An empty `proposals` list is empty success, not `capability_missing`. Hub does
not 404 an unknown space in `space_in`. A watchlist change mid-scan does not
drop items already parsed; derived spaces are recomputed on the next scan.

## Fixtures

Captured 2026-09-14 from `https://hub.snapshot.org/graphql`. See
`packages/source-adapters/test/fixtures/README.md`.
