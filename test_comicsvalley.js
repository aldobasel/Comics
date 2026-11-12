// Contract/regression tests using simulated harbor.http replies and Madara DOM nodes.
// These are NOT live website or Harbor app network tests.
const fs=require('fs'), vm=require('vm'), assert=require('node:assert/strict');
const src=fs.readFileSync(__dirname+'/comicsvalley.plugin.js','utf8');
const attr=(properties,text='',elements={})=>({
  attr:k=>properties[k]||'', text:()=>text,
  querySelector:s=>elements[s]||null,
  querySelectorAll:s=>elements[s] ? [elements[s]] : []
});
const series='https://comicsvalley.com/adult-comics/example-series/';
const chapter='https://comicsvalley.com/adult-comics/example-series/issue-1/';
const titleLink=attr({href:series},'Example Series');
const cover=attr({'data-src':'https://cdn.example/cover.jpg'});
const card=attr({},'',{'.post-title a':titleLink,'img':cover});
const chapterLink=attr({href:chapter},'Chapter 1');
const chapterItem=attr({},'Chapter 1',{'a[href]':chapterLink});
const imgA=attr({'data-src':'https://cdn.example/page01.jpg'});
const imgB=attr({'src':'https://cdn.example/page02.jpg'});
const lists={
  CATALOG:{'.page-item-detail':[card]},
  EMPTY:{},
  AJAX_CATALOG:{'.page-item-detail':[card]},
  AJAX_CHAPTERS:{'li.wp-manga-chapter, .listing-chapters_wrap li a, .main.version-chap li':[chapterItem]},
  READER:{'.reading-content .page-break img':[imgA,imgB]},
};
const docs={
  CATALOG:{},EMPTY:{},AJAX_CATALOG:{},AJAX_CHAPTERS:{},READER:{},
  DETAIL:{'h1':attr({},'Example Series'),'.summary_image img':cover,'.summary__content':attr({},'Example story')}
};
function parser(html){return {
 querySelector:(selector)=>docs[html]?.[selector]||null,
 querySelectorAll:(selector)=>lists[html]?.[selector]||[]
}}
const calls=[];
const http=async(u,opts)=>{
 calls.push([u,opts]);
 if(u.includes('/wp-admin/admin-ajax.php')) {
  if(opts.body.includes('vars%5Bs%5D=example')) return {ok:true,body:'AJAX_CATALOG'};
  if(opts.body.includes('madara_load_more')) return {ok:true,body:'AJAX_CATALOG'};
 }
 if(u.endsWith('/ajax/chapters/')) return {ok:true,body:'AJAX_CHAPTERS'};
 if(u.startsWith(chapter)) return {ok:true,body:'READER'};
 if(u===series) return {ok:true,body:'DETAIL'};
 if(u.includes('?s=')) return {ok:true,body:'EMPTY'};
 if(u.includes('/comics-new/')) return {ok:true,body:'CATALOG'};
 throw new Error('Unexpected URL '+u);
};
const plugin=vm.runInNewContext('(function(harbor){'+src+'\n})')({http,parseHtml:parser});
(async()=>{
  for(const k of ['popular','search','detail','chapters','pageUrls','tags']) assert.equal(typeof plugin[k],'function');
  assert.equal(plugin.id,'comicsvalley-all');
  const latest=await plugin.popular(0);
  assert.equal(latest.length,1);
  assert.equal(latest[0].id,series);
  assert.equal(latest[0].cover,'https://cdn.example/cover.jpg');
  await plugin.popular(24);
  const post=calls.find(([u,o])=>u.includes('admin-ajax.php')&&o.method==='POST');
  assert.ok(post,'Madara AJAX POST is required for pagination');
  assert.ok(post[1].body.includes('action=madara_load_more'));
  assert.ok(post[1].body.includes('page=1'));
  assert.equal((await plugin.search('example',0)).length,1);
  assert.equal((await plugin.detail(series)).title,'Example Series');
  const chapters=await plugin.chapters(series);
  assert.equal(chapters.length,1);
  assert.equal(chapters[0].id,chapter);
  assert.equal(chapters[0].language,'all');
  assert.deepEqual(Array.from(await plugin.pageUrls(chapter)),['https://cdn.example/page01.jpg','https://cdn.example/page02.jpg']);
  assert.ok(calls.some(([u,o])=>u.endsWith('/ajax/chapters/')&&o.method==='POST'));
  const manifest=JSON.parse(fs.readFileSync(__dirname+'/repo.json','utf8'));
  assert.equal(manifest.plugins.length,4);
  assert.equal(manifest.plugins.find(x=>x.id==='comicsvalley-all').nsfw,true);
  assert.ok(manifest.plugins.every(x=>fs.existsSync(__dirname+'/'+x.entry)));
  console.log('PASS 14 checks: contract, archive, pagination POST, search fallback, metadata, AJAX chapters, reader images, NSFW flag, preserved plugin files.');
  console.log('LIMIT: simulated HTML; website currently returned 403 to browsing, and Harbor HTTP not run.');
})().catch(e=>{console.error(e);process.exitCode=1});
