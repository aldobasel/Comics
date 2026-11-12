# Comics Valley — Native Harbor Plugin v1.1.0

This follows Harbor’s five-method `MangaProvider` sample. Runs only inside Harbor using `harbor.http` and `harbor.parseHtml`. No Suwayomi, external backend, `fetch`, DOM, or storage.

## Installation
1. Upload `comicsvalley.plugin.js` alongside your existing plugins in GitHub repository `aldobasel/Comics-and-stuff`.
2. Replace its `repo.json` with the provided file **only if its first three entries match your current sources**. Other three `.plugin.js` files are included unchanged for convenience.
3. Refresh repository in Harbor. Existing repository URL stays the same: https://raw.githubusercontent.com/aldobasel/Comics-and-stuff/main/repo.json

## Technical notes
- Madara AJAX catalog via POST `wp-admin/admin-ajax.php` `madara_load_more` (with minimal HTML archive fallback).
- Chapter listing via POST `<comic-url>/ajax/chapters`.
- Image list via chapter reader `?style=list` and `data-src`, `data-lazy-src`, `src`.
- `lang: all`, `nsfw: true` follow upstream Comics Valley Tachiyomi metadata.
- Site currently did not permit direct verification here (403 / network restriction). Tests are **simulated**, not a successful in-Harbor test. If Harbor gets 403/503, a plugin cannot itself unlock WebView/Cloudflare; Harbor bridge must handle this.
