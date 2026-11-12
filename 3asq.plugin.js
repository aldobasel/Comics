// Harbor source plugin for 3asq.online (Madara / WordPress).
// Uses only harbor.http and harbor.parseHtml; no DOM, fetch, or storage.
const BASE = "https://3asq.online";
const PAGE_SIZE = 21;

function absolute(value) {
  if (!value) return undefined;
  const url = String(value).trim().split(/\s+/)[0];
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}
function imageUrl(el) {
  return el && absolute(el.attr("data-src") || el.attr("data-lazy-src") || el.attr("src"));
}
function mangaId(href) {
  const match = String(href || "").match(/\/manga\/([^/?#]+)\/?(?:[?#].*)?$/i);
  return match ? match[1] : null;
}
function chapterId(href) {
  const match = String(href || "").match(/\/manga\/([^/?#]+\/[^/?#]+)\/?(?:[?#].*)?$/i);
  return match ? match[1] : null;
}
function cleanText(el) { return el ? (el.text() || "").trim() : ""; }
async function request(path, options) {
  const res = await harbor.http(BASE + path, Object.assign({ responseType: "text" }, options || {}));
  if (!res || !res.ok) throw new Error("3asq HTTP " + (res && res.status) + ": " + path);
  return harbor.parseHtml(res.body || "");
}
function summary(el) {
  const link = el.querySelector('.post-title a[href*="/manga/"]') ||
    el.querySelector('.tab-thumb a[href*="/manga/"]') ||
    el.querySelector('a[href*="/manga/"]');
  if (!link) return null;
  const id = mangaId(link.attr("href"));
  if (!id) return null;
  const titleEl = el.querySelector('.post-title a[href*="/manga/"]');
  return {
    id,
    title: cleanText(titleEl || link) || id,
    cover: imageUrl(el.querySelector(".item-thumb img") || el.querySelector(".tab-thumb img") || el.querySelector("img")),
  };
}
function unique(items) {
  const seen = {};
  return items.filter((item) => {
    if (!item || seen[item.id]) return false;
    seen[item.id] = true;
    return true;
  });
}
function findMetadata(doc, label) {
  const rows = doc.querySelectorAll(".post-content_item");
  for (const row of rows) {
    if (cleanText(row.querySelector(".summary-heading")).includes(label)) {
      return cleanText(row.querySelector(".summary-content")) || undefined;
    }
  }
  return undefined;
}
function extractChapters(doc) {
  return unique(doc.querySelectorAll("li.wp-manga-chapter").map((li) => {
    const link = li.querySelector("a");
    if (!link) return null;
    const id = chapterId(link.attr("href"));
    if (!id) return null;
    const title = cleanText(link);
    const number = title.match(/(?:^|\s)(\d+(?:[.,]\d+)?)(?=\s|\b|$)/);
    const dateElement = li.querySelector(".chapter-release-date a");
    const date = dateElement && dateElement.attr("title");
    return {
      id,
      chapter: number ? number[1].replace(",", ".") : null,
      title: title || id.split("/").pop(),
      volume: null,
      pages: 0,
      language: "ar",
      publishAt: date || undefined,
    };
  }));
}
async function ajaxChapters(slug) {
  const path = "/manga/" + encodeURIComponent(slug) + "/ajax/chapters/";
  const variants = [
    { method: "POST", body: "", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" } },
    { method: "POST", data: "" },
  ];
  for (const options of variants) {
    try {
      const doc = await request(path, options);
      const chapters = extractChapters(doc);
      if (chapters.length) return chapters;
    } catch (_) { /* try the next request option */ }
  }
  return [];
}

const plugin = {
  id: "3asq-custom",
  name: "مانجا العاشق (3asq)",

  async popular(offset, tagId) {
    const page = Math.floor((Number(offset) || 0) / PAGE_SIZE) + 1;
    const path = tagId
      ? "/manga-genre/" + encodeURIComponent(tagId) + "/" + (page > 1 ? "page/" + page + "/" : "")
      : "/manga/" + (page > 1 ? "page/" + page + "/" : "") + "?m_orderby=latest";
    const doc = await request(path);
    return unique(doc.querySelectorAll(".page-item-detail").map(summary));
  },

  async search(query, offset, tagId) {
    const page = Math.floor((Number(offset) || 0) / PAGE_SIZE) + 1;
    const path = (page > 1 ? "/page/" + page + "/" : "/") +
      "?s=" + encodeURIComponent(query || "") + "&post_type=wp-manga";
    const doc = await request(path);
    const rows = doc.querySelectorAll(".c-tabs-item__content");
    let results = unique(rows.map(summary));
    // Site search has no confirmed combined genre-search endpoint.
    // Ignore tagId here rather than incorrectly excluding matches from later genre pages.
    return results;
  },

  async detail(id) {
    const doc = await request("/manga/" + encodeURIComponent(id) + "/");
    const heading = doc.querySelector(".post-title h1") || doc.querySelector("h1");
    const title = cleanText(heading) || id;
    const description = cleanText(doc.querySelector(".description-summary .summary__content") ||
      doc.querySelector(".summary__content") || doc.querySelector(".manga-excerpt"));
    return {
      id,
      title,
      altTitle: findMetadata(doc, "أسماء أخرى"),
      cover: imageUrl(doc.querySelector(".summary_image img")),
      description: description || undefined,
      status: findMetadata(doc, "الحالة"),
      author: findMetadata(doc, "الكاتب"),
    };
  },

  async chapters(id) {
    const ajax = await ajaxChapters(id);
    if (ajax.length) return ajax;
    const doc = await request("/manga/" + encodeURIComponent(id) + "/");
    return extractChapters(doc);
  },

  async pageUrls(id) {
    const parts = String(id).split("/").map(encodeURIComponent).join("/");
    const doc = await request("/manga/" + parts + "/");
    const imgs = doc.querySelectorAll(".reading-content img");
    const seen = {};
    return imgs.map(imageUrl).filter((url) => {
      if (!url || !/^https?:\/\//i.test(url) || seen[url]) return false;
      seen[url] = true;
      return true;
    });
  },

  async tags() {
    const doc = await request("/?s=&post_type=wp-manga");
    const seen = {};
    return doc.querySelectorAll('a[href*="/manga-genre/"]').map((link) => {
      const match = String(link.attr("href") || "").match(/\/manga-genre\/([^/?#]+)/);
      if (!match || seen[match[1]]) return null;
      const name = cleanText(link);
      if (!name) return null;
      seen[match[1]] = true;
      return { id: match[1], name, group: "التصنيفات" };
    }).filter(Boolean);
  },
};
return plugin;
