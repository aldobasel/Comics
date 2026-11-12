// Comics Valley (Madara) for Harbor, no third-party backend.
// Based on: ComicsValley.kt (mangaSubString=comics-new,
// useNewChapterEndpoint=true, useLoadMoreRequest=Always), and Madara shared source.
// The website currently limits automated requests in some environments.
const CV_BASE = 'https://comicsvalley.com';
const CV_PAGE_SIZE = 24;
const CV_HEADERS = { 'Accept': 'text/html, */*;q=0.8' };

function cvText(e) { return e ? String(e.text() || '').trim() : ''; }
function cvAttr(e, k) { return e ? String(e.attr(k) || '').trim() : ''; }
function cvAbs(href, base) {
  let u = String(href || '').trim().replace(/&amp;/g, '&');
  if (!u || /^(?:data|javascript|blob):/i.test(u)) return undefined;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  const host = (base || CV_BASE).replace(/\/$/, '').match(/^https?:\/\/[^/]+/i);
  const root = host ? host[0] : CV_BASE;
  return root + (u[0] === '/' ? u : '/' + u);
}
function cvAllowed(url) {
  return /^https:\/\/(?:www\.)?comicsvalley\.(?:com|co)(?:\/|$)/i.test(url || '');
}
function cvUrl(value) {
  const url = cvAbs(value);
  if (!cvAllowed(url)) throw new Error('Comics Valley: unsupported URL');
  return url.split('#')[0];
}
function cvSeries(url) {
  if (!cvAllowed(url)) return false;
  const path = String(url).replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0];
  return /^\/(?:adult-comics|comics-new|manga)\/[^/]+\/?$/i.test(path);
}
function cvImage(e, base) {
  if (!e) return undefined;
  let u = cvAttr(e, 'data-src') || cvAttr(e, 'data-lazy-src') || cvAttr(e, 'data-cfsrc') ||
          cvAttr(e, 'data-original') || cvAttr(e, 'src');
  if (!u || /^data:image\//.test(u)) {
    const srcset = cvAttr(e, 'data-srcset') || cvAttr(e, 'srcset');
    const bits = srcset.split(',');
    if (bits.length) u = bits[bits.length - 1].trim().split(/\s+/)[0];
  }
  return cvAbs(u, base);
}
function cvUnique(items) {
  const seen = {};
  return items.filter(item => item && item.id && !seen[item.id] && (seen[item.id] = true));
}
function cvIsChallenge(html) {
  return /cf-chl-|cf-turnstile|challenge-platform|Just a moment\.\.\.|Attention Required!.*Cloudflare/i.test(html);
}
async function cvRequest(url, options) {
  const u = cvUrl(url);
  const opt = Object.assign({ responseType: 'text', headers: CV_HEADERS }, options || {});
  let result;
  try { result = await harbor.http(u, opt); }
  catch (err) { throw new Error('Comics Valley network failure (' + u.replace(/^https?:\/\//,'').split('/')[0] + '): ' + String(err && err.message || err)); }
  if (!result || result.ok === false || Number(result.status) >= 400) {
    const status = result && result.status || '?';
    if (status === 403 || status === 503) throw new Error('Comics Valley HTTP ' + status + ' (possible site verification / Cloudflare)');
    throw new Error('Comics Valley HTTP ' + status + ' for ' + u);
  }
  const body = typeof result === 'string' ? result : result.body;
  if (typeof body !== 'string') throw new Error('Comics Valley: expected HTML response; got ' + typeof body);
  if (cvIsChallenge(body)) throw new Error('Comics Valley verification page, not comic content; Harbor must complete the site check');
  return body;
}
function cvDoc(html) { return harbor.parseHtml(html); }
async function cvGet(url, options) {
  const html = await cvRequest(url, options);
  return cvDoc(html);
}
function cvCard(item) {
  const links = [
    item.querySelector('.post-title a'),
    item.querySelector('h3 a'),
    item.querySelector('.item-thumb a'),
    item.querySelector('a[href*="/adult-comics/"]'),
    item.querySelector('a[href*="/comics-new/"]')
  ];
  let link = null, id = null;
  for (const a of links) {
    const href = cvAbs(cvAttr(a, 'href'));
    if (cvSeries(href)) { link = a; id = href.replace(/[?#].*$/, '').replace(/\/$/, '') + '/'; break; }
  }
  if (!id) return null;
  const cover = item.querySelector('img');
  const title = cvText(link) || cvAttr(link, 'title') || cvAttr(cover, 'alt') || id.split('/').filter(Boolean).pop();
  return { id, title, cover: cvImage(cover, id) };
}
function cvCards(doc) {
  let cards = [];
  for (const s of ['.page-item-detail', '.manga__item', '.c-tabs-item__content', '.manga-item']) {
    const els = doc.querySelectorAll(s);
    if (els.length) {
      cards = cvUnique(els.map(cvCard));
      if (cards.length) break;
    }
  }
  // Simple fallback for archive templates without the standard Madara wrapper.
  if (!cards.length) {
    const links = doc.querySelectorAll('a[href*="/adult-comics/"], a[href*="/comics-new/"]');
    cards = cvUnique(links.map(a => {
      const id = cvAbs(cvAttr(a, 'href'));
      if (!cvSeries(id)) return null;
      const title = cvText(a) || cvAttr(a, 'title');
      if (!title) return null;
      return { id: id.replace(/\/$/,'')+'/', title, cover: cvImage(a.querySelector('img'),id) };
    }));
  }
  return cards;
}
function cvForm(fields) {
  return Object.keys(fields).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(fields[k])).join('&');
}
function cvPostOptions(body, ref) {
  return { method:'POST', body, headers: {
    'Accept': 'text/html, */*;q=0.8',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest', 'Referer': ref || CV_BASE + '/comics-new/'
  }};
}
function cvLoadForm(page, popular, query) {
  const search = query !== undefined;
  const values = {
    action:'madara_load_more', page:String(page-1),
    template: search ? 'madara-core/content/content-search' : 'madara-core/content/content-archive',
    'vars[paged]':'1', 'vars[post_type]':'wp-manga', 'vars[post_status]':'publish',
    'vars[sidebar]':'right', 'vars[manga_archives_item_layout]':'big_thumbnail'
  };
  if (search) { values['vars[template]']='archive'; values['vars[s]']=query; }
  else {
    values['vars[orderby]']='meta_value_num';
    values['vars[meta_key]']=popular ? '_wp_manga_views' : '_latest_update';
    values['vars[order]']='desc';
  }
  return cvForm(values);
}
async function cvLoadMore(page, popular, query) {
  const path = CV_BASE + '/wp-admin/admin-ajax.php';
  const body = cvLoadForm(page, popular, query);
  const doc = await cvGet(path, cvPostOptions(body));
  return cvCards(doc);
}
async function cvArchive(page, tag) {
  const root = tag ? '/' + tag.replace(/^\/+|\/+$/g,'') + '/' : '/comics-new/';
  const path = CV_BASE + root + (page > 1 ? 'page/' + page + '/' : '') + (tag ? '' : '?m_orderby=latest');
  return cvCards(await cvGet(path));
}
async function cvFindList(page, tag, query) {
  let primaryError;
  const isSearch = query !== undefined;
  if (page === 1 || tag) {
    try {
      const path = isSearch ? CV_BASE + '/?s=' + encodeURIComponent(query) + '&post_type=wp-manga'
        : CV_BASE + (tag ? '/' + tag + '/' : '/comics-new/?m_orderby=latest');
      const rows = cvCards(await cvGet(path));
      if (rows.length) return rows;
    } catch(e) { primaryError = e; }
  }
  if (!tag) {
    try {
      const rows = await cvLoadMore(page, false, query);
      if (rows.length) return rows;
    } catch (e) { if (!primaryError) primaryError=e; }
  }
  if (!isSearch && !tag) {
    try {
      const rows = await cvArchive(page, tag);
      if (rows.length) return rows;
    } catch(e) { if (!primaryError) primaryError=e; }
  } else {
    try {
      const root = page === 1 ? '/' : '/page/' + page + '/';
      const path = CV_BASE + root + '?s=' + encodeURIComponent(query) + '&post_type=wp-manga';
      const rows = cvCards(await cvGet(path));
      if (rows.length) return rows;
    } catch(e) { if (!primaryError) primaryError=e; }
  }
  if (primaryError) throw primaryError;
  if (page===1) throw new Error('Comics Valley: archive returned no readable series; site markup or access may have changed');
  return [];
}
function cvMeta(doc, label) {
  for (const el of doc.querySelectorAll('.post-content_item')) {
    const heading = cvText(el.querySelector('.summary-heading')).toLowerCase();
    if (heading.includes(label)) return cvText(el.querySelector('.summary-content'));
  }
  return undefined;
}
function cvChapterNumber(title) {
  const m = String(title).match(/(?:chapter|ch\.?|issue|part|episode|vol(?:ume)?|#)\s*[#.:\-]*\s*(\d+(?:[.,]\d+)?)/i);
  return m ? m[1].replace(',', '.') : null;
}
function cvChapters(doc, series) {
  const rows = doc.querySelectorAll('li.wp-manga-chapter, .listing-chapters_wrap li a, .main.version-chap li');
  const out = [];
  for (const el of rows) {
    const a = el.querySelector('a[href]') || (cvAttr(el,'href') ? el : null);
    const href = cvAbs(cvAttr(a,'href'), series);
    if (!cvAllowed(href) || !href.startsWith(series) || href === series) continue;
    const title = cvText(a) || cvAttr(a,'title') || 'Chapter';
    const dateNode = el.querySelector('.chapter-release-date');
    out.push({ id: href.split('?')[0].replace(/\/$/,'')+'/', title, chapter:cvChapterNumber(title), volume:null, pages:0, language:'all', publishAt:cvAttr(dateNode,'title') || undefined });
  }
  return cvUnique(out);
}
async function cvGetChapters(seriesId) {
  const series = cvUrl(seriesId).replace(/[?#].*$/,'').replace(/\/$/, '') + '/';
  const doc = await cvGet(series);
  const direct = cvChapters(doc, series);
  if (direct.length) return direct;
  // This source enables the newer Madara endpoint (verified in upstream extension).
  // The HTML holder is often empty until this request succeeds.
  const xhrUrl = series.replace(/\/$/,'') + '/ajax/chapters/';
  let error;
  try {
    const result = cvChapters(await cvGet(xhrUrl, cvPostOptions('',series)), series);
    if (result.length) return result;
  } catch(e) { error = e; }
  // Compatibility path for Harbor HTTP bridges that do not support POST reliably.
  try {
    const result = cvChapters(await cvGet(xhrUrl), series);
    if (result.length) return result;
  } catch(e) { if (!error) error=e; }
  throw error || new Error('Comics Valley: chapter list missing from detail page and /ajax/chapters/');
}
function cvPages(doc, url) {
  const selectors = ['.reading-content .page-break img', '.reading-content img', '#readerarea img', '.entry-content .page-break img', 'img.wp-manga-chapter-img'];
  for (const sel of selectors) {
    const results = [], seen = {};
    for (const img of doc.querySelectorAll(sel)) {
      const u = cvImage(img,url);
      if (u && /^https?:\/\//i.test(u) && !seen[u]) { results.push(u); seen[u]=true; }
    }
    if (results.length) return results;
  }
  return [];
}
const plugin = {
  id:'comicsvalley-all', name:'Comics Valley (All Languages)',
  async popular(offset, tagId) {
    const page = Math.floor(Math.max(0, Number(offset)||0)/CV_PAGE_SIZE)+1;
    const tag = String(tagId || '');
    if (tag && !/^(?:comic-genre|comic-tag)\/[a-z0-9_-]+$/i.test(tag)) throw new Error('Comics Valley: invalid filter');
    return cvFindList(page,tag,undefined);
  },
  async search(query, offset, tagId) {
    const q = String(query || '').trim();
    if (!q) return this.popular(offset,tagId);
    const page = Math.floor(Math.max(0, Number(offset)||0)/CV_PAGE_SIZE)+1;
    // Search all languages/categories, not only currently selected genre.
    return cvFindList(page,'',q);
  },
  async detail(id) {
    const url = cvUrl(id).replace(/[?#].*$/,'').replace(/\/$/,'')+'/';
    const doc = await cvGet(url);
    const heading = doc.querySelector('.post-title h1') || doc.querySelector('h1');
    const title = cvText(heading);
    if (!title) throw new Error('Comics Valley: detail page does not have a title ('+url+')');
    return { id:url, title,
      cover:cvImage(doc.querySelector('.summary_image img') || doc.querySelector('.summary-content img'),url),
      description:cvText(doc.querySelector('.description-summary .summary__content') || doc.querySelector('.summary__content')) || undefined,
      status:cvMeta(doc,'status'), author:cvMeta(doc,'author'),
      altTitle:cvMeta(doc,'alternative') };
  },
  async chapters(id) { return cvGetChapters(id); },
  async pageUrls(chapterId) {
    const url = cvUrl(chapterId).replace(/[?#].*$/,'').replace(/\/$/,'') + '/?style=list';
    const pages = cvPages(await cvGet(url),url);
    if (!pages.length) throw new Error('Comics Valley: no image pages found (some chapters are text-only or protected)');
    return pages;
  },
  async tags() {
    const doc = await cvGet(CV_BASE+'/comics-new/');
    const rows = [], seen = {};
    for (const a of doc.querySelectorAll('a[href*="/comic-genre/"], a[href*="/comic-tag/"]')) {
      const url = cvAbs(cvAttr(a,'href'));
      const m = url && url.match(/\/(comic-genre|comic-tag)\/([\w-]+)\/?(?:[?#]|$)/i);
      if (!m) continue;
      const id = m[1]+'/'+m[2];
      const name = cvText(a);
      if (!seen[id] && name) { seen[id]=true; rows.push({id,name,group:m[1]==='comic-tag'?'Language / Tag':'Genre'}); }
    }
    return rows;
  }
};
return plugin;
