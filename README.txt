Harbor source rebuild — 2026-11-12

Files
- comicverse.plugin.js  (v1.4.0) Comic Verse Arabic. Blogger /feeds/posts/default/-/SERIES_LABEL chapter extraction without incorrectly demanding a Chapter category. Arabic in manifest and chapter objects.
- globalcomix.plugin.js (v0.7.0) GlobalComix public catalog. Uses /store release cards to derive series; reads issue links on series pages. This is PARTIAL support: /browse is a JS-dependent shell, full-text site-wide search is NOT supported by public HTML, and full reader image pages remain inaccessible without a verified readV3 JSON integration.
- 3asq.plugin.js      unchanged from earlier
- repo.json           manifest for all 3 sources
- test-plugins.js     offline contract tests (run: node test-plugins.js)

WHAT WAS TESTED
- JavaScript syntax
- Valid JSON manifest and unique entry IDs
- Mocked Blogger series feed where chapter entries have only series labels (no 'Chapter' category)
- Arabic chapter fields and reader image field handling
- Mocked GlobalComix /store release cards, deduplication, series issue links and preview-only detection

NOT TESTED
- Live Harbor desktop integration (not available in this session)
- HTTP responses from websites in Harbor's native runtime (not accessible)
- GlobalComix readV3 API, paid content, authorization, or universal search

CAUTION
This patch is not a claim that either site works end-to-end in Harbor. GlobalComix still cannot read JS-only page lists. No Cloudflare bypass or cookie exfiltration is implemented. Avoid uploading secrets or session cookies.

UPDATE
Replace comicverse.plugin.js, globalcomix.plugin.js and repo.json on your GitHub repo. Keep 3asq.plugin.js unchanged. Github was NOT modified by this build.
