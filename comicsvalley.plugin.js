// Comics Valley — native Harbor manga source.
// This file is evaluated as the body of function(harbor) { ... }.
// No fetch, DOM, local storage, external services or browser automation.
// Network: harbor.http; HTML parsing: harbor.parseHtml.
// Madara implementation based on ComicsValley.kt and Madara shared extension.

const BASE = 'https://comicsvalley.com';
const ITEM_OFFSET_STEP = 48; // Harbor popular/search offsets: 0, 48, 96, ...

function abs(url) {
  if (!url) return undefined;
  const u = String(url).trim().replace(/&amp;/g, '&');
  if (!u || /^(data:|blob:|javascript:|#)/i.test(u)) return undefined;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return BASE + u;
  return BASE + '/' + u;
}
function txt(el) { return el ? String(el.text() || '').trim() : ''; }
function attr(el, name) { return el ? String(el.attr(name) || '').trim() : ''; }
function image(el) {
  if (!el) return undefined;
  let src = attr(el, 'data-src') || attr(el, 'data-lazy-src') || attr(el, 'data-original') || attr(el, 'data-cfsrc') || attr(el, 'src');
  if (!src || /^data:/i.test(src)) {
    const set = attr(el, 'data-srcset') || attr(el, 'srcset');
    const candidates = set.split(',').map(x => x.trim().split(/\s+/)[0]).filter(Boolean);
    src = candidates[candidates.length - 1];
  }
  return abs(src);
}
function isSite(url) {
  return /^https:\/\/(?:www\.)?comicsvalley\.com(?:\/|$)/i.test(String(url || ''));
}
function allowedURL(id) {
  const u = abs(id);
  if (!isSite(u)) throw new Error('Comics Valley: unexpected URL for this source');
  return u.replace(/#.*$/, '');
}
function seriesURL(href) {
  const u = abs(href);
  if (!isSite(u)) return null;
  if (!/^\/(?:comics-new|adult-comics|manga)\/[^/?#]+\/?(?:[?#]|$)/i.test(u.replace(/^https?:\/\/[^/]+/i, ''))) return null;
  return u.split(/[?#]/)[0].replace(/\/$/, '') + '/';
}
function isChallenge(html) {
  return /cf-chl-|cf-turnstile|challenge-platform|just a moment|checking your browser/i.test(html);
}
async function getHtml(path, opts) {
  const url = allowedURL(path);
  const options = Object.assign({ responseType: 'text' }, opts || {});
  let res;
  try { res = await harbor.http(url, options); }
  catch (e) { throw new Error('Comics Valley: request failed (' + url + '): ' + String(e && e.message || e)); }
  if (!res || res.ok === false || Number(res.status) >= 400) {
    const status = res && res.status || '?';
    throw new Error('Comics Valley HTTP ' + status + ' at ' + url + (status === 403 || status === 503 ? ' (site verification may be required)' : ''));
  }
  const html = typeof res === 'string' ? res : res.body;
  if (typeof html !== 'string') throw new Error('Comics Valley: expected HTML text at ' + url);
  if (isChallenge(html)) throw new Error('Comics Valley: received verification page, not catalog data');
  return html;
}
async function getDoc(path, opts) {
  return harbor.parseHtml(await getHtml(path, opts));
}
function formBody(pairs) {
  return pairs.map(p => encodeURIComponent(p[0]) + '=' + encodeURIComponent(String(p[1]))).join('&');
}
function postOptions(body, referer) {
  return { method: 'POST', body, responseType: 'text', headers: {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': referer || BASE + '/comics-new/'
  } };
}
function cardToSummary(el) {
  const candidates = ['.post-title a', 'h3 a', 'h2 a', 'a[href*="/comics-new/"]', 'a[href*="/adult-comics/"]'];
  let link, id;
  for (const selector of candidates) {
    const a = el.querySelector(selector);
    const match = a && seriesURL(attr(a, 'href'));
    if (match) { link = a; id = match; break; }
  }
  if (!id) return null;
  const img = el.querySelector('img');
  const title = txt(link) || attr(link, 'title') || attr(img, 'alt') || id.split('/').filter(Boolean).pop();
  return { id, title, cover: image(img) };
}
function unique(items) {
  const seen = {};
  return items.filter(x => x && x.id && !seen[x.id] && (seen[x.id] = true));
}
function cardsFromDoc(doc) {
  const wrappers = ['.page-item-detail', '.manga__item', '.c-tabs-item__content', '.manga-item'];
  for (const selector of wrappers) {
    const found = unique(doc.querySelectorAll(selector).map(cardToSummary));
    if (found.length) return found;
  }
  const links = [
    ...doc.querySelectorAll('a[href*="/comics-new/"]'),
    ...doc.querySelectorAll('a[href*="/adult-comics/"]')
  ];
  return unique(links.map(link => {
    const id = seriesURL(attr(link, 'href'));
    if (!id) return null;
    const img = link.querySelector('img');
    const title = txt(link) || attr(link, 'title') || attr(img, 'alt');
    return title ? { id, title, cover: image(img) } : null;
  }));
}
function catalogFields(page, query) {
  const isSearch = query !== undefined;
  const result = [
    ['action', 'madara_load_more'], ['page', String(page - 1)],
    ['template', 'madara-core/content/content-' + (isSearch ? 'search' : 'archive')],
    ['vars[paged]', '1'], ['vars[post_type]', 'wp-manga'],
    ['vars[post_status]', 'publish'], ['vars[sidebar]', 'right'],
    ['vars[manga_archives_item_layout]', 'big_thumbnail']
  ];
  if (isSearch) result.push(['vars[template]', 'archive'], ['vars[s]', query]);
  else result.push(['vars[orderby]', 'meta_value_num'], ['vars[meta_key]', '_latest_update'], ['vars[order]', 'desc']);
  return formBody(result);
}
async function catalog(page, query, tagId) {
  const ajax = BASE + '/wp-admin/admin-ajax.php';
  let err;
  if (!tagId) {
    // Comics Valley's Tachiyomi source specifies Madara LoadMoreStrategy.Always.
    try {
      const doc = await getDoc(ajax, postOptions(catalogFields(page, query)));
      const items = cardsFromDoc(doc);
      if (items.length || page > 1) return items;
    } catch (e) { err = e; }
  }
  // Simple HTML fallback, useful when the site's archive works but AJAX doesn't.
  try {
    let url;
    if (query !== undefined) {
      url = BASE + (page > 1 ? '/page/' + page + '/' : '/') + '?s=' + encodeURIComponent(query) + '&post_type=wp-manga';
    } else if (tagId) {
      if (!/^genre:[a-z0-9_-]+$/i.test(String(tagId))) throw new Error('Comics Valley: invalid tag');
      url = BASE + '/comics-new/' + (page > 1 ? 'page/' + page + '/' : '') + '?genre%5B%5D=' + encodeURIComponent(String(tagId).slice(6));
    } else {
      url = BASE + '/comics-new/' + (page > 1 ? 'page/' + page + '/' : '') + '?m_orderby=latest';
    }
    const rows = cardsFromDoc(await getDoc(url));
    if (rows.length || page > 1) return rows;
  } catch (e) { if (!err) err = e; }
  if (err) throw err;
  throw new Error('Comics Valley: catalog returned no comic cards (layout or access may have changed)');
}
function numberedChapter(name) {
  const m = String(name).match(/(?:chapter|ch\.?|issue|part|#)\s*[#:.-]*\s*(\d+(?:\.\d+)?)/i);
  return m ? m[1] : null;
}
function chaptersFromDoc(doc) {
  const out = [];
  for (const li of doc.querySelectorAll('li.wp-manga-chapter')) {
    const a = li.querySelector('a');
    const id = abs(attr(a, 'href'));
    if (!isSite(id)) continue;
    const title = txt(a) || attr(a, 'title') || 'Chapter';
    out.push({ id: id.split(/[?#]/)[0].replace(/\/$/, '') + '/', title,
      chapter: numberedChapter(title), volume: null, pages: 0, language: 'all',
      publishAt: attr(li.querySelector('.chapter-release-date'), 'title') || undefined });
  }
  return unique(out);
}
async function getChapters(id) {
  const series = allowedURL(id).split(/[?#]/)[0].replace(/\/$/, '') + '/';
  const doc = await getDoc(series);
  const direct = chaptersFromDoc(doc);
  if (direct.length) return direct;
  // Madara new chapter endpoint. Exact upstream path: POST <manga>/ajax/chapters
  const xhrURL = series.replace(/\/$/, '') + '/ajax/chapters';
  const xhr = chaptersFromDoc(await getDoc(xhrURL, postOptions('', series)));
  if (xhr.length) return xhr;
  return [];
}
function readerImages(doc) {
  const selectors = [
    '.reading-content .page-break img', 'div.page-break img',
    '.reading-content img', '#readerarea img',
    '.entry-content img.wp-manga-chapter-img', 'li.blocks-gallery-item img'
  ];
  for (const selector of selectors) {
    const out = [], seen = {};
    for (const el of doc.querySelectorAll(selector)) {
      const url = image(el);
      if (url && /^https?:\/\//i.test(url) && !seen[url]) { out.push(url); seen[url] = true; }
    }
    if (out.length) return out;
  }
  return [];
}

const plugin = {
  id: 'comicsvalley-all', // must match repo.json
  name: 'Comics Valley (All Languages)',

  async popular(offset, tagId) {
    const page = Math.floor(Math.max(0, Number(offset) || 0) / ITEM_OFFSET_STEP) + 1;
    return catalog(page, undefined, tagId);
  },

  async search(query, offset, tagId) {
    const q = String(query || '').trim();
    if (!q) return this.popular(offset, tagId);
    const page = Math.floor(Math.max(0, Number(offset) || 0) / ITEM_OFFSET_STEP) + 1;
    return catalog(page, q, null);
  },

  async detail(id) {
    const url = allowedURL(id).split(/[?#]/)[0].replace(/\/$/, '') + '/';
    const doc = await getDoc(url);
    const h1 = doc.querySelector('.post-title h1') || doc.querySelector('h1');
    const title = txt(h1);
    if (!title) throw new Error('Comics Valley: title page has no heading: ' + url);
    const meta = label => {
      for (const block of doc.querySelectorAll('.post-content_item')) {
        if (txt(block.querySelector('.summary-heading')).toLowerCase().includes(label))
          return txt(block.querySelector('.summary-content')) || undefined;
      }
      return undefined;
    };
    return { id: url, title,
      cover: image(doc.querySelector('.summary_image img') || doc.querySelector('.summary-content img')),
      description: txt(doc.querySelector('.summary__content')) || undefined,
      altTitle: meta('alternative'), status: meta('status'), author: meta('author') };
  },

  async chapters(id) { return getChapters(id); },

  async pageUrls(chapterId) {
    const url = allowedURL(chapterId).split(/[?#]/)[0].replace(/\/$/, '') + '/?style=list';
    const images = readerImages(await getDoc(url));
    if (!images.length) throw new Error('Comics Valley: reader returned no public page images');
    return images;
  },

  async tags() {
    const doc = await getDoc(BASE + '/comics-new/');
    const out = [], seen = {};
    for (const a of doc.querySelectorAll('a[href*="/manga-genre/"]')) {
      const url = abs(attr(a, 'href'));
      const match = url && url.match(/\/manga-genre\/([a-z0-9_-]+)\/?(?:[?#]|$)/i);
      const name = txt(a);
      if (match && name && !seen[match[1]]) {
        seen[match[1]] = true;
        out.push({ id: 'genre:' + match[1], name, group: 'Genre' });
      }
    }
    return out;
  }
};

return plugin;
