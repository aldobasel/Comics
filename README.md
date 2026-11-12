# Comics Valley — native Harbor source (1.0.0)

**Direct JS source; no Suwayomi or external proxy.** The plugin uses only `harbor.http()` and `harbor.parseHtml()`.

## What was implemented

- `popular(offset, tagId)` — Madara `/comics-new/` archive and AJAX `madara_load_more` fallback/pagination.
- `search(query, offset)` — WordPress Madara search, with its own AJAX fallback.
- `detail(id)` — title, cover, description, status and author from manga detail pages.
- `chapters(id)` — on-page chapter list or **POST** `<series>/ajax/chapters/` (the new endpoint used by the upstream Tachiyomi extension), then GET compatibility fallback.
- `pageUrls(chapterId)` — list-style reader (`?style=list`) and lazy-loaded page images.
- `tags()` — genre and language/tag links, if present in the catalog HTML.

The source is listed as `lang: "all"`, `nsfw: true`, consistent with the upstream Kotlin source. Chapter language is `all` unless the site provides a reliable explicit language per chapter; it is **not** incorrectly hardcoded to English.

## Installation

For your `aldobasel/Comics-and-stuff` repository:

1. Upload `comicsvalley.plugin.js` to the repository root.
2. Replace `repo.json` with the included version (it includes the prior three sources unchanged, plus Comics Valley).
3. Refresh the repository/extensions list inside Harbor. The repository URL is still:

   `https://raw.githubusercontent.com/aldobasel/Comics-and-stuff/main/repo.json`

If your actual GitHub `repo.json` has been edited after the previously generated `harbor-direct-v5` file, merge the **single new Comics Valley entry** into your latest manifest rather than replacing unrelated changes.

## Verification and limitations

- JavaScript syntax and a simulated `harbor.http` regression suite: **PASS**.
- Direct HTTP request to `https://comicsvalley.com/` from the web inspection tool: **403 Forbidden**; live HTML and source behavior could not be fully inspected. This is **not a verified successful connection inside Harbor**.
- The plugin cannot automatically pass a Cloudflare challenge or transfer a browser session unless the installed Harbor version performs that in its HTTP bridge.
- Some chapters on Comics Valley are text-only, which Harbor's image-page source interface may not support.
- The website might change layout or HTTP behavior, so an in-app test is still required before considering this a reliable source.

### Relevant implementation references

- https://github.com/yuzono/tachiyomi-extensions (ComicsValley.kt, Madara with `mangaSubString = "comics-new"`, `useNewChapterEndpoint = true`, `useLoadMoreRequest = Always`)
- https://gist.github.com/mohamedotaku/81f3e9c12556bb3f87a9893ba998b3f0 (Madara endpoint implementation)
