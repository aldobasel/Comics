// GlobalComix for Harbor - direct API plugin. Routes inspected from the user's
// tachiyomi-all.globalcomix-v1.6.2.apk (classes.dex), NOT inferred from /browse HTML.
// Only public metadata and publicly accessible reading pages are supported.
const GC_API = 'https://api.globalcomix.com/v1';
const GC_SITE = 'https://globalcomix.com';
const GC_BATCH = 20;
// The client identifier below ships in the supplied Android APK. This is not a
// user account token; it identifies the public Android integration. If the API
// requires other authorization, do not attempt to circumvent it.
const GC_HEADERS = {
  'Referer': GC_SITE + '/',
  'x-gc-client': 'gck_d0f170d5729446dcb3b55e6b3ebc7bf6',
  'x-gc-identmode': 'cookie',
  'Accept': 'application/json'
};
function gcString(x) { return x === null || x === undefined ? '' : String(x).trim(); }
function gcAbs(x) {
  x = gcString(x);
  if (!x || /^data:|^blob:|^javascript:/i.test(x)) return undefined;
  if (/^https?:\/\//i.test(x)) return x;
  if (x.startsWith('//')) return 'https:' + x;
  return GC_SITE + (x[0] === '/' ? '' : '/') + x;
}
function gcObj(x) { return x && typeof x === 'object' && !Array.isArray(x) ? x : {}; }
function gcWrap(response) {
  if (response && response.ok === false) throw new Error('GlobalComix HTTP ' + (response.status || '?'));
  if (response && Number(response.status) >= 400) throw new Error('GlobalComix HTTP ' + response.status);
  let d = response && Object.prototype.hasOwnProperty.call(response, 'body') ? response.body : response;
  if (typeof d === 'string') {
    if (/cf-chl|challenge-platform|just a moment|checking your browser/i.test(d)) throw new Error('GlobalComix blocked by site verification; Harbor WebView session required');
    try { d = JSON.parse(d); } catch (_) { throw new Error('GlobalComix returned HTML instead of API JSON'); }
  }
  if (!d || typeof d !== 'object') throw new Error('GlobalComix API returned no JSON');
  return d;
}
async function gcGet(path, params) {
  const parts = [];
  for (const key of Object.keys(params || {})) {
    const value = params[key];
    if (value === undefined || value === null || value === '') continue;
    parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
  }
  const url = GC_API + path + (parts.length ? '?' + parts.join('&') : '');
  let r;
  try { r = await harbor.http(url, { responseType: 'json', headers: GC_HEADERS }); }
  catch (e) { throw new Error('GlobalComix API connection failed: ' + gcString(e && e.message || e)); }
  const d = gcWrap(r);
  const err = d.error || (d.success === false && (d.message || 'API rejected request'));
  if (err) throw new Error('GlobalComix API: ' + gcString(typeof err === 'object' ? err.message || err.code : err));
  return d;
}
function gcUnwrap(data) {
  let v = data;
  for (let i = 0; i < 6; i++) {
    if (!v || Array.isArray(v) || typeof v !== 'object') break;
    const next = ['payload', 'data', 'result', 'entity', 'comic'].find(k => v[k] && typeof v[k] === 'object');
    if (!next) break;
    v = v[next];
  }
  return v;
}
function gcRecords(data, keys) {
  // DTOs observed in the APK: ResponseDto/PaginatedPayloadDto/EntityDto,
  // with payload, results, pagination, and releases fields.
  const visited = new Set();
  function scan(v, depth) {
    if (!v || depth > 5 || typeof v !== 'object' || visited.has(v)) return null;
    visited.add(v);
    if (Array.isArray(v)) return v;
    for (const k of keys) if (Array.isArray(v[k])) return v[k];
    for (const k of ['payload', 'data', 'results', 'releases', 'entity', 'comic', 'items', 'comics', 'catalog', 'list']) {
      if (v[k]) { const r = scan(v[k], depth + 1); if (r) return r; }
    }
    return null;
  }
  return scan(data, 0) || [];
}
function gcVal(x, keys) {
  for (const k of keys) {
    if (x && x[k] !== undefined && x[k] !== null && x[k] !== '') return x[k];
  }
  return null;
}
function gcImage(x) {
  const v = gcVal(x, ['image_url', 'cover_url', 'thumbnail_url', 'desktop_image_url', 'mobile_image_url', 'cover', 'image', 'thumbnail', 'cover_image', 'poster_url']);
  return gcAbs(typeof v === 'object' ? gcVal(v, ['url', 'src', 'desktop_image_url']) : v);
}
function gcComicId(obj) {
  const v = gcVal(obj, ['comic_id', 'id', 'comicId', 'series_id']);
  if (v != null && /^(\d+|[0-9a-f-]{8,})$/i.test(gcString(v))) return gcString(v);
  const url = gcString(gcVal(obj, ['url', 'path', 'permalink']));
  const m = url.match(/\/c\/[^/?#]+(?:\/[^/?#]+)?/);
  return m ? m[0] : null;
}
function gcSummary(obj) {
  obj = gcObj(obj);
  if (obj.comic && typeof obj.comic === 'object') obj = Object.assign({}, obj, obj.comic);
  const id = gcComicId(obj);
  if (!id) return null;
  const title = gcString(gcVal(obj, ['title', 'name', 'roman_name', 'comic_title', 'comic_name']));
  if (!title) return null;
  return { id, title, cover: gcImage(obj) };
}
function gcChapterId(obj) {
  const v = gcVal(obj, ['id', 'release_id', 'chapter_id', 'uuid', 'releaseId']);
  return v == null ? null : gcString(v);
}
function gcLanguage(obj) {
  const value = gcVal(obj, ['lang', 'language', 'lang_code', 'language_code', 'locale']);
  if (value && typeof value === 'object') return gcLanguage(value);
  const s = gcString(value).toLowerCase();
  if (/^[a-z]{2}(?:-[a-z]{2})?$/.test(s)) return s;
  if (/^arabic$/i.test(s)) return 'ar';
  if (/^english$/i.test(s)) return 'en';
  // Unknown language must not be mislabelled as English.
  return 'all';
}
function gcChapter(obj) {
  obj = gcObj(obj);
  if (obj.release && typeof obj.release === 'object') obj = Object.assign({}, obj, obj.release);
  const id = gcChapterId(obj);
  if (!id) return null;
  const title = gcString(gcVal(obj, ['title', 'name', 'release_name', 'chapter_title'])) || ('Issue ' + id);
  const number = gcVal(obj, ['chapter', 'chapter_number', 'issue_number', 'number']);
  const paid = gcVal(obj, ['premium_only', 'is_page_paid', 'is_paid']);
  return { id, title, chapter: number === null ? null : gcString(number), volume: null,
    pages: Number(gcVal(obj, ['total_pages', 'pages', 'page_count']) || 0) || 0,
    language: gcLanguage(obj),
    publishAt: gcVal(obj, ['published_time', 'created_at', 'published_at', 'date_published']) || undefined,
    _paid: paid === true || paid === 1 };
}
function gcUnique(list) { const seen = new Set(); return list.filter(x => x && x.id && !seen.has(x.id) && (seen.add(x.id), true)); }
function gcPageRecords(data) { return gcRecords(data, ['page_objects', 'pages', 'results']); }
const plugin = {
  id: 'globalcomix-public',
  name: 'GlobalComix (All Languages)',
  async popular(offset) {
    const p = Math.floor(Math.max(0, Number(offset) || 0) / GC_BATCH) + 1;
    const data = await gcGet('/comics', { 'lang_id[]': 'all', p, sort: 'popular' });
    const rows = gcUnique(gcRecords(data, ['results', 'comics', 'items', 'entities']).map(gcSummary));
    if (!rows.length) throw new Error('GlobalComix: /v1/comics returned no readable results (check API response format)');
    return rows;
  },
  async search(query, offset) {
    const q = gcString(query);
    if (!q) return this.popular(offset);
    const p = Math.floor(Math.max(0, Number(offset) || 0) / GC_BATCH) + 1;
    const data = await gcGet('/comics', { 'lang_id[]': 'all', p, sort: 'relevance', q });
    return gcUnique(gcRecords(data, ['results', 'comics', 'items', 'entities']).map(gcSummary));
  },
  async detail(id) {
    id = gcString(id);
    const data = await gcGet('/read/' + encodeURIComponent(id));
    const r = gcUnwrap(data);
    let item = gcObj(Array.isArray(r) ? r[0] : r);
    if (item.comic && typeof item.comic === 'object') item = Object.assign({}, item, item.comic);
    if (item.series && typeof item.series === 'object') item = Object.assign({}, item, item.series);
    return { id, title: gcString(gcVal(item, ['title', 'name', 'roman_name'])) || id,
      cover: gcImage(item),
      description: gcString(gcVal(item, ['description', 'summary', 'synopsis'])),
      author: gcString(gcVal(item, ['artist', 'author', 'creator', 'publisher_name'])),
      status: gcString(gcVal(item, ['status_name', 'status'])),
      lastChapter: gcString(gcVal(item, ['last_chapter', 'last_release'])) };
  },
  async chapters(id) {
    id = gcString(id);
    const data = await gcGet('/comics/' + encodeURIComponent(id) + '/releases', { lang_id: 'all', 'per_page': 300 });
    const rows = gcUnique(gcRecords(data, ['results', 'releases', 'items']).map(gcChapter));
    if (!rows.length) throw new Error('GlobalComix: releases API returned no issues for comic ' + id);
    return rows.map(c => { const r = Object.assign({}, c); delete r._paid; return r; });
  },
  async pageUrls(chapterId) {
    const data = await gcGet('/readV2/' + encodeURIComponent(gcString(chapterId)));
    const found = [];
    for (const p of gcPageRecords(data)) {
      const o = gcObj(p);
      if (['true', '1'].includes(String(o.is_page_paid)) || ['true', '1'].includes(String(o.premium_only))) continue;
      const image = gcAbs(gcVal(o, ['desktop_image_url', 'mobile_image_url', 'image_url', 'url']));
      if (image && !found.includes(image)) found.push(image);
    }
    if (!found.length) throw new Error('GlobalComix: no publicly readable page URLs from /v1/readV2');
    return found;
  }
};
return plugin;
