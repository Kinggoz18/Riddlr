# RSS and Atom feeds

Riddlr collects feed items through a `GET` of an operator-pasted URL. It does
not scrape the publisher site and it does not execute XML DTDs.

Sources → **Add source** → **Configure RSS/Atom** accepts the feed URL, a trust
tier, and a poll interval of 1–60 minutes. Add another feed source for a second
URL. Suggested Federal Reserve and ECB URLs default to official firsthand.

Items persist as snippets. Eligible public pages linked from an item follow the
same enrichment path as SearXNG hits. The platform family `feed` is not
authoritative; the operator sets trust on the feed hostname identity.

Official feeds in the plan examples:

- `https://www.federalreserve.gov/feeds/press_all.xml`
- `https://www.ecb.europa.eu/rss/press.html`
- Substack `https://<pub>.substack.com/feed`
- YouTube `https://www.youtube.com/feeds/videos.xml?channel_id=`
