// Comic Verse for Harbor - direct JavaScript plugin (revised APK-informed extraction).
// Based on inspected strings/methods of tachiyomi-ar.comicverse-v1.6.21.apk.
const CV_BASE = 'https://arcomixverse.blogspot.com';
const CV_SIZE = 24;
function cvAbs(url) {
  if (!url) return undefined;
  let u = String(url).trim().replace(/&amp;/g, '&');
  if (!u || /^data:|^javascript:/i.test(u)) return undefined;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  return CV_BASE + (u[0] === '/' ? '' : '/') + u;
}
function cvPath(url) {
  const a = cvAbs(url);
  if (!a || !a.startsWith(CV_BASE + '/')) return null;
  return a.slice(CV_BASE.length).split('#')[0].split('?')[0];
}
function cvAttr(el, k) { return el ? el.attr(k) : undefined; }
function cvTxt(el) { return el ? String(el.text() || '').trim() : ''; }
function cvFirst(node, selectors) {
  for (const s of selectors) { const e = node.querySelector(s); if (e) return e; }
  return null;
}
function cvImg(el) {
  const s = cvAttr(el, 'data-src') || cvAttr(el, 'data-original') || cvAttr(el, 'data-lazy-src') || cvAttr(el, 'src');
  return cvAbs(s);
}
function cvUnique(items) {
  const seen = new Set();
  return items.filter(x => x && x.id && !seen.has(x.id) && (seen.add(x.id), true));
}
async function cvRequest(url, type) {
  const u = cvAbs(url);
  let r;
  try { r = await harbor.http(u, { responseType: type }); }
  catch (e) { throw new Error('Comic Verse request error: ' + String(e && e.message || e)); }
  if (!r || r.ok === false || Number(r.status) >= 400) throw new Error('Comic Verse HTTP ' + (r && r.status || '?'));
  let out = Object.prototype.hasOwnProperty.call(r, 'body') ? r.body : r;
  if (type === 'json') {
    if (typeof out === 'string') { try { return JSON.parse(out); } catch (_) { throw new Error('Comic Verse: Blogger feed is not JSON'); } }
    if (out && typeof out === 'object') return out;
    throw new Error('Comic Verse: empty Blogger JSON');
  }
  if (typeof out !== 'string') throw new Error('Comic Verse: expected HTML text');
  return out;
}
function cvFeedUrl(label, options) {
  let url = CV_BASE + '/feeds/posts/default';
  if (label) url += '/-/' + String(label).split('/').map(encodeURIComponent).join('/');
  const args = Object.assign({ alt: 'json' }, options || {});
  return url + '?' + Object.keys(args).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(args[k])).join('&');
}
async function cvFeed(label, params) {
  const payload = await cvRequest(cvFeedUrl(label, params), 'json');
  return payload && payload.feed && Array.isArray(payload.feed.entry) ? payload.feed.entry : [];
}
function cvEntryLink(e) {
  const arr = e.link || [];
  const a = arr.find(x => x.rel === 'alternate' && (!x.type || x.type === 'text/html')) || arr.find(x => x.rel === 'alternate');
  return a ? cvPath(a.href) : null;
}
function cvEntryTitle(e) { return e.title && e.title.$t ? String(e.title.$t).trim() : ''; }
function cvEntryCover(e) {
  const th = e['media$thumbnail'];
  if (th && th.url) return cvAbs(String(th.url).replace(/\/s\d+(?:-c)?\//, '/w600/'));
  const html = e.content && e.content.$t || e.summary && e.summary.$t || '';
  return html ? cvImg(harbor.parseHtml(html).querySelector('img')) : undefined;
}
function cvIsSeries(e) { return (e.category || []).some(x => String(x.term || '').toLowerCase() === 'series'); }
function cvSummary(e) {
  if (!cvIsSeries(e)) return null;
  const id = cvEntryLink(e);
  return id ? { id, title: cvEntryTitle(e) || id, cover: cvEntryCover(e) } : null;
}
function cvIssueNumber(title) {
  const m = String(title).match(/(?:العدد|الفصل|issue|chapter|#)\s*#?\s*(\d+(?:\.\d+)?)/i);
  return m ? m[1] : null;
}
function cvIssue(e) {
  if (cvIsSeries(e)) return null;
  const id = cvEntryLink(e);
  if (!id) return null;
  const title = cvEntryTitle(e) || 'العدد';
  return { id, title, chapter: cvIssueNumber(title), volume: null, pages: 0,
    language: 'ar', publishAt: e.published && e.published.$t || undefined };
}
function cvMetaCover(doc) {
  return cvAbs(cvAttr(cvFirst(doc, ['meta[property="og:image"]', 'meta[name="twitter:image"]']), 'content')) ||
    cvImg(cvFirst(doc, ['.manga-widget img', '.series-cover img', '.post-body img', 'article img']));
}
function cvCandidates(raw, doc) {
  const urls = [], labels = [];
  const clean = x => String(x || '').trim().replace(/&amp;/g, '&').replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  const addUrl = x => {
    x = clean(x);
    if (!x) return;
    if (/^\/feeds\/posts\/default/i.test(x)) x = CV_BASE + x;
    if (/^feeds\/posts\/default/i.test(x)) x = CV_BASE + '/' + x;
    if (/^\/\/-\//.test(x)) x = CV_BASE + '/feeds/posts/default' + x.slice(1);
    if (/^-\//.test(x)) x = CV_BASE + '/feeds/posts/default/' + x;
    const u = cvAbs(x);
    if (u && /\/feeds\/posts\/default(?:\/|\?|$)/i.test(u) && !urls.includes(u)) urls.push(u);
  };
  const addLabel = x => {
    x = clean(x);
    if (x && !/^(Series|Chapter|Manga|MARVEL|DC)$/i.test(x) && !labels.includes(x)) labels.push(x);
  };
  const unescaped = String(raw).replace(/\\\//g, '/').replace(/&amp;/g, '&');
  // The exact "clwd.run('feed-url')" pattern comes from the Comic Verse APK.
  // Parse scripts as RAW HTML, since harbor.parseHtml does not expose scripts.
  for (const m of unescaped.matchAll(/clwd\.run\(\s*\[?\s*['"]([^'"\n]+)['"]/gi)) addUrl(m[1]);
  for (const m of unescaped.matchAll(/(?:feedUrl|feed_url)\s*[:=]\s*['"]([^'"\n]+)['"]/gi)) addUrl(m[1]);
  for (const m of unescaped.matchAll(/(?:https?:)?\/\/[^\s'"<>]+\/feeds\/posts\/default[^\s'"<>]*/gi)) addUrl(m[0]);
  // ZeistManga's "#myUL > script" can contain label = 'series name'.
  for (const m of unescaped.matchAll(/\blabel\s*=\s*['"]([^'"\n]+)['"]/gi)) addLabel(m[1]);
  for (const node of doc.querySelectorAll('[data-label]')) addLabel(cvAttr(node, 'data-label'));
  for (const m of unescaped.matchAll(/\bdata-label\s*=\s*['"]([^'"\n]+)['"]/gi)) addLabel(m[1]);
  return { urls, labels };
}
function cvChapterFeedUrl(url) {
  // Every feed URL is requested as Blogger JSON, regardless of how clwd.run
  // embedded it (query-only parameters, &amp; or full address).
  const cleaned = String(url).replace(/&amp;/g, '&');
  const sep = cleaned.includes('?') ? '&' : '?';
  return cleaned + sep + (/[?&]alt=/.test(cleaned) ? '' : 'alt=json&') + 'max-results=9999';
}
function cvDirect(doc, seriesId) {
  const rows = [];
  for (const a of doc.querySelectorAll('#clwd a[href], #myUL a[href], .chapter-list a[href], .eplister a[href]')) {
    const id = cvPath(cvAttr(a, 'href'));
    if (!id || id === seriesId || !/\.html$/.test(id)) continue;
    const title = cvTxt(a) || cvAttr(a, 'title') || 'العدد';
    rows.push({ id, title, chapter: cvIssueNumber(title), volume: null, pages: 0, language: 'ar' });
  }
  return cvUnique(rows);
}
function cvPopularCards(doc) {
  const cards = [];
  for (const el of doc.querySelectorAll('div.PopularPosts div.grid > figure, figure[class*="item"], .series-card')) {
    const a = cvFirst(el, ['figcaption > a', 'a[href*=".html"]']);
    const id = cvPath(cvAttr(a, 'href'));
    if (id) cards.push({ id, title: cvTxt(a) || cvAttr(a, 'title') || id, cover: cvImg(el.querySelector('img')) });
  }
  return cvUnique(cards);
}
const plugin = {
  id: 'comicverse-ar', name: 'Comic Verse (عربي)',
  async popular(offset, tagId) {
    const opts = { 'start-index': (Math.max(0, Number(offset) || 0) + 1), 'max-results': CV_SIZE, orderby: 'updated' };
    const label = tagId ? 'Series/' + String(tagId) : 'Series';
    const items = cvUnique((await cvFeed(label, opts)).map(cvSummary));
    if (items.length) return items;
    // The fallback is a real on-site listing, not a fabricated result.
    if (!offset && !tagId) return cvPopularCards(harbor.parseHtml(await cvRequest('/', 'text')));
    return [];
  },
  async search(query, offset, tagId) {
    const opts = { 'start-index': (Math.max(0, Number(offset) || 0) + 1), 'max-results': CV_SIZE, q: String(query || '').trim() };
    const items = cvUnique((await cvFeed(tagId ? 'Series/' + String(tagId) : 'Series', opts)).map(cvSummary));
    return items;
  },
  async detail(id) {
    const raw = await cvRequest(id, 'text');
    const doc = harbor.parseHtml(raw);
    return { id, title: cvTxt(cvFirst(doc, ['h1', 'h2.post-title'])) || id,
      cover: cvMetaCover(doc), description: cvTxt(cvFirst(doc, ['#synopsis', '.synopsis', '.description', '.post-body'])),
      status: cvTxt(cvFirst(doc, ['span[data-status]', '.status'])),
      author: cvTxt(cvFirst(doc, ['#author', '.author'])) };
  },
  async chapters(id) {
    const raw = await cvRequest(id, 'text');
    const doc = harbor.parseHtml(raw);
    const direct = cvDirect(doc, id);
    if (direct.length) return direct;
    const candidates = cvCandidates(raw, doc);
    let lastError;
    // Avoid the many speculative HTTP requests that exhausted Harbor timeouts.
    for (const url of candidates.urls.slice(0, 2)) {
      try {
        const data = await cvRequest(cvChapterFeedUrl(url), 'json');
        const rows = cvUnique((data.feed && data.feed.entry || []).map(cvIssue));
        if (rows.length) return rows;
      } catch (e) { lastError = e; }
    }
    for (const label of candidates.labels.slice(0, 2)) {
      try {
        // The Android ZeistManga implementation requests up to 999999 for all chapters.
        const rows = cvUnique((await cvFeed(label, { 'max-results': 999999, 'start-index': 1 })).map(cvIssue));
        if (rows.length) return rows;
      } catch (e) { lastError = e; }
    }
    throw new Error('Comic Verse: chapter feed unavailable; label=' + candidates.labels.slice(0, 2).join('|') +
      (lastError ? '; ' + (lastError.message || String(lastError)) : '; no feed label found'));
  },
  async pageUrls(id) {
    const raw = await cvRequest(id, 'text');
    const doc = harbor.parseHtml(raw);
    const images = [], add = v => {
      const url = cvAbs(v);
      if (url && /^https?:\/\//i.test(url) && !images.includes(url)) images.push(url);
    };
    for (const img of doc.querySelectorAll('#cvOriginal img, #myUL img, .reading-content img')) {
      add(cvAttr(img, 'data-src') || cvAttr(img, 'src'));
    }
    if (!images.length) {
      // APK's reader also collects "img[src]" from a parsed reader page.
      const fragment = raw.match(/<div[^>]+id=["']cvOriginal["'][\s\S]*?<\/div>/i);
      if (fragment) {
        for (const m of fragment[0].matchAll(/<img[^>]+(?:data-src|src)\s*=\s*["']([^"']+)/gi)) add(m[1]);
      }
    }
    if (!images.length) throw new Error('Comic Verse: no images found in public reader markup');
    return images;
  },
  async tags() { return ['MARVEL', 'DC', 'IMAGE', 'BOOM', 'CROSSOVER', 'GHOST MACHINE'].map(id => ({ id, name: id, group: 'Publisher' })); }
};
return plugin;
