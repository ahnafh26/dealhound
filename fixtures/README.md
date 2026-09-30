# Fixtures

`USE_FIXTURES=1` makes each real source replay the response saved here instead of calling the network, and turns every source on without keys. It's for offline development: the same listings come back whatever you search.

| Folder | Replayed as | Where it came from |
| --- | --- | --- |
| `demo/` | the four demo sources (always, not only offline) | hand-made listings for two products, with realistic noise |
| `ebay/search.json` | eBay Browse API search | hand-made from eBay's documented response shape |
| `serpapi/search.json` | SerpAPI Google Shopping | hand-made from SerpAPI's documented response shape |
| `bestbuy/search.json` | Best Buy Products API | hand-made from Best Buy's documented response shape |
| `apple-refurb/mac.html` | Apple's refurbished Mac page | hand-made in the page's format, trimmed to the product grid |
| `kijiji/search.html` | a Kijiji Buy & Sell search page | hand-made in the page's format, following carbuyer's notes |
| `facebook-marketplace/search.html` | a logged-out Marketplace search | hand-made in the page's format, following carbuyer's notes |
| `craigslist/search.json` | Craigslist's search feed | hand-made in the feed's format, following carbuyer's notes |

Every listing, seller and id here is made up.

## Replacing them with real responses

Run the app with `RECORD_FIXTURES=1` and search once with the sources you care about turned on. Each successful response overwrites that source's file. Access tokens are never written. The parser tests in `tests/sources/` use these files, so re-run `npm test` afterwards. A test that fails against a real response means the site's format differs from the hand-made one, and the parser needs updating.

Real responses can include what sellers wrote (names in descriptions, phone numbers in location lines). Trim or anonymize them before committing.
