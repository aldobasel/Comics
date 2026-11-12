// Contract and simulated-HTTP regression tests. Not a live Harbor or website test.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
function doc(html) {
  // The simplified mock deliberately exposes no script content via parseHtml.
  return {
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === '[data-label]' && html.includes('data-label=')) {
        return [{attr(k) { return k === 'data-label' ? 'Vision (2015)' : undefined; }}];
      }
      return [];
    }
  };
}
function build(file, http) {
  const src = fs.readFileSync(__dirname + '/' + file, 'utf8');
  const ctx = { harbor: {http, parseHtml:doc} };
  const plug = vm.runInNewContext('(function(harbor){\n' + src + '\n})',ctx)(ctx.harbor);
  for (const k of ['popular', 'search', 'detail', 'chapters', 'pageUrls']) assert.equal(typeof plug[k], 'function', file + ': '+k);
  return plug;
}
const cventry = (name, path, category) => ({
  title: {$t: name},
  link: [{rel:'alternate',type:'text/html',href:'https://arcomixverse.blogspot.com'+path}],
  category: [{term: category}]
});
(async () => {
  const requests=[];
  const global=build('globalcomix.plugin.js', async (u, options) => {
    requests.push(u);
    assert.equal(options.headers['x-gc-identmode'], 'cookie');
    if (u.includes('/readV2/')) return {payload: {page_objects:[
      {desktop_image_url:'https://cdn.example/a.jpg',is_page_paid:false},
      {desktop_image_url:'https://cdn.example/b.jpg',is_page_paid:true}
    ]}};
    if (u.includes('/releases')) return {payload: {results:[
      {release:{id:'71',name:'العدد الأول',language:'ar'}},
      {id:'72',title:'Issue Two',lang:'en'}
    ]}};
    if (u.includes('/v1/read/')) return {payload:{comic:{id:'8',name:'Example Arabic Comic',image_url:'https://cdn.example/cover.jpg'}}};
    if (u.includes('/v1/comics')) return {payload: {results: [
      {comic:{comic_id:'8',title:'Example Arabic Comic',cover:'https://cdn.example/cover.jpg'}}
    ]}};
    throw Error('Unexpected global HTTP call: '+u);
  });
  assert.equal((await global.popular(0)).length,1);
  assert.ok(requests[0].includes('lang_id%5B%5D=all'));
  assert.ok(requests[0].includes('sort=popular'));
  assert.equal((await global.search('باتمان',0)).length,1);
  assert.ok(requests[1].includes('q=%D8%A8%D8%A7%D8%AA%D9%85%D8%A7%D9%86'));
  assert.equal((await global.detail('8')).title,'Example Arabic Comic');
  assert.ok(requests[2].includes('/v1/read/8'));
  const releases=await global.chapters('8');
  assert.equal(releases.length,2);
  assert.equal(releases[0].language,'ar');
  assert.deepEqual(Array.from(await global.pageUrls('71')),['https://cdn.example/a.jpg']);
  const cvCalls=[];
  const comicverse=build('comicverse.plugin.js', async (u) => {
    cvCalls.push(u);
    if (u.includes('feeds/posts/default/-/Series?')) return {ok:true,body: {feed:{entry:[
      cventry('Vision (2015)','/2026/01/vision.html','Series')
    ]}}};
    if (u.includes('feeds/posts/default/-/Vision%20(2015)')) return {ok:true,body:{feed:{entry:[
      cventry('العدد 1','/2026/01/vision-issue-1.html','Vision (2015)'),
      cventry('العدد 2','/2026/01/vision-issue-2.html','Vision (2015)')
    ]}}};
    if (u.endsWith('/2026/01/vision.html')) return {ok:true,body: `<div id="clwd"><script>clwd.run('https://arcomixverse.blogspot.com/feeds/posts/default/-/Vision%20(2015)')</script></div>`};
    throw Error('Unexpected Comic Verse URL '+u);
  });
  assert.equal((await comicverse.popular(0)).length,1);
  const chapters=await comicverse.chapters('/2026/01/vision.html');
  assert.equal(chapters.length,2);
  assert.equal(chapters[0].language,'ar');
  assert.ok(cvCalls.some(u=>u.includes('Vision%20(2015)')));
  console.log('PASS: JS contract, parsed JSON handling, multilingual API filters, GlobalComix /read details, Blogger clwd.run chapter-feed extraction, Arabic chapters.');
  console.log('LIMIT: simulated responses only; live requests inside Harbor still require end-to-end testing.');
})().catch(e=>{console.error(e);process.exitCode=1;});
