# RSS and Atom feeds

Riddlr collects feed items through a `GET` of an operator-pasted URL. It does
not scrape the publisher site and it does not execute XML DTDs.

Sources → **Add source** → **Configure RSS/Atom** accepts the feed URL, a trust
tier, and a poll interval of 1–60 minutes. Add another feed source for a second
URL. Suggested Federal Reserve and ECB URLs default to official firsthand.

Finish on the default Crypto agent attaches three feeds:

- `https://blog.ethereum.org/en/feed.xml` (official firsthand)
- `https://www.coindesk.com/arc/outboundfeeds/rss/` (reputable press)
- `https://decrypt.co/feed` (reputable press)

Items with RSS `content:encoded` or Atom `content` of at least 400 characters
persist as `native_complete`. Other items persist as snippets. Eligible public
pages linked from a snippet follow the same enrichment path as SearXNG hits.
The platform family `feed` is not authoritative; the operator sets trust on the
feed hostname identity.

Official and regulator feeds:

- `https://www.federalreserve.gov/feeds/press_all.xml`
- `https://www.ecb.europa.eu/rss/press.html`
- `https://www.sec.gov/news/pressreleases.rss`

Publisher and protocol feeds you can add yourself:

- `https://cointelegraph.com/rss`
- Substack `https://<pub>.substack.com/feed`
- YouTube `https://www.youtube.com/feeds/videos.xml?channel_id=`

See [integrations/feeds.md](../integrations/feeds.md).
