const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const graphql = 'https://www.instagram.com/api/graphql';
async function fixture(page) {
  const delivered = [];
  await page.route('**/*', route => {
    const request=route.request();
    if (request.isNavigationRequest()) return route.fulfill({contentType:'text/html',body:'<!doctype html><body><button id="original">Original focus</button></body>'});
    delivered.push({url:request.url(),body:request.postData()});
    return route.fulfill({contentType:'application/json',body:'{"fixture":true}'});
  });
  await page.goto('https://www.instagram.com/');
  await page.addScriptTag({path:path.join(__dirname,'../core.js')});
  await page.addScriptTag({path:path.join(__dirname,'../content.js')});
  return delivered;
}
async function start(page, body='fb_api_req_friendly_name=SaveMutation') {
  await page.evaluate(({url,body}) => { window.result='pending'; fetch(url,{method:'POST',body}).then(()=>window.result='sent',e=>window.result=e.name); },{url:graphql,body});
  await expect(page.getByRole('dialog')).toBeVisible();
}
test('cancel rejects honestly, defaults focus and restores previous focus', async ({page}) => {
  const delivered=await fixture(page); await page.locator('#original').focus(); await start(page);
  await expect(page.getByRole('button',{name:'Cancel action'})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect.poll(()=>page.evaluate(()=>window.result)).toBe('AbortError');
  expect(delivered).toHaveLength(0); await expect(page.locator('#original')).toBeFocused();
});
test('approval sends original Request body once and only once', async ({page}) => {
  const delivered=await fixture(page);
  await page.evaluate(url=>{ const r=new Request(url,{method:'POST',body:new URLSearchParams({fb_api_req_friendly_name:'SaveMutation',variables:'{"input":{"id":123}}'})}); window.result='pending'; fetch(r).then(()=>window.result='sent'); },graphql);
  await page.getByRole('button',{name:'Allow once'}).click();
  await expect.poll(()=>page.evaluate(()=>window.result)).toBe('sent');
  expect(delivered).toHaveLength(1); expect(delivered[0].body).toContain('id%22%3A123');
});
test('queries pass through; FormData mutation and hostile label are safely reviewed', async ({page}) => {
  const delivered=await fixture(page);
  await page.evaluate(async url=>{await fetch(url,{method:'POST',body:'fb_api_req_friendly_name=FeedQuery'}); const f=new FormData(); f.set('fb_api_req_friendly_name','<img src=x onerror=alert(1)>Mutation'); window.result='pending'; fetch(url,{method:'POST',body:f}).catch(e=>window.result=e.name);},graphql);
  await expect(page.getByRole('heading')).toHaveText('<img src=x onerror=alert(1)>Mutation');
  await expect(page.locator('#instaconfirm-dialog img')).toHaveCount(0); expect(delivered).toHaveLength(1);
  await page.getByRole('button',{name:'Cancel action'}).click();
});
test('concurrent actions are serialized and a queued abort never sends',async({page})=>{
  const delivered=await fixture(page);
  await page.evaluate(url=>{window.a=new AbortController(); window.results=[]; ['FirstMutation','SecondMutation'].forEach((name,i)=>fetch(url,{method:'POST',body:'fb_api_req_friendly_name='+name,signal:i?window.a.signal:undefined}).then(()=>window.results.push('sent'),e=>window.results.push(e.name)));},graphql);
  await expect(page.getByRole('heading')).toHaveText('FirstMutation');
  await page.evaluate(()=>window.a.abort()); await page.getByRole('button',{name:'Allow once'}).click();
  await expect.poll(()=>page.evaluate(()=>window.results.length)).toBe(2);
  expect(delivered).toHaveLength(1); await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('visible and pre-aborted fetches never reach transport',async({page})=>{
  const delivered=await fixture(page);
  await page.evaluate(url=>{window.a=new AbortController(); window.result='pending';fetch(url,{method:'POST',signal:window.a.signal}).catch(e=>window.result=e.name);},graphql);
  await expect(page.getByRole('dialog')).toBeVisible(); await page.evaluate(()=>window.a.abort());
  await expect.poll(()=>page.evaluate(()=>window.result)).toBe('AbortError');
  expect(await page.evaluate(async url=>{const c=new AbortController();c.abort();try{await fetch(url,{method:'POST',signal:c.signal})}catch(e){return e.name}},graphql)).toBe('AbortError');
  expect(delivered).toHaveLength(0);
});
test('XHR cancellation uses abort and status zero; approval retains response',async({page})=>{
  const delivered=await fixture(page);
  await page.evaluate(url=>{window.x=new XMLHttpRequest();window.events=[];x.open('POST',url);x.onabort=()=>events.push('abort');x.onload=()=>events.push('load');x.onloadend=()=>events.push('end');x.send('fb_api_req_friendly_name=SaveMutation');},graphql);
  await page.getByRole('button',{name:'Cancel action'}).click();
  await expect.poll(()=>page.evaluate(()=>window.events)).toEqual(['abort','end']);
  expect(await page.evaluate(()=>x.status)).toBe(0); expect(delivered).toHaveLength(0);
  await page.evaluate(url=>{x.open('POST',url);x.send('fb_api_req_friendly_name=SaveMutation');},graphql);
  await page.getByRole('button',{name:'Allow once'}).click();
  await expect.poll(()=>page.evaluate(()=>x.status)).toBe(200); expect(delivered).toHaveLength(1);
});
test('XHR abort, reuse, duplicate send and synchronous guards preserve request boundaries',async({page})=>{
  const delivered=await fixture(page);
  const errors=await page.evaluate(url=>{window.x=new XMLHttpRequest();x.open('POST',url);x.send('fb_api_req_friendly_name=OldMutation');const errors=[];try{x.send('new')}catch(e){errors.push(e.name)}try{x.setRequestHeader('X-Test','new')}catch(e){errors.push(e.name)}x.open('POST',url);x.send('fb_api_req_friendly_name=NewMutation');return errors},graphql);
  expect(errors).toEqual(['InvalidStateError','InvalidStateError']);
  await expect(page.getByRole('heading')).toHaveText('NewMutation'); await page.evaluate(()=>x.abort());
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(delivered).toHaveLength(0);
  expect(await page.evaluate(url=>{const r=new XMLHttpRequest();r.open('POST',url,false);try{r.send('')}catch(e){return e.name}},graphql)).toBe('NotSupportedError');
});
test('pending timeout fails closed',async({page})=>{
  await page.clock.install(); const delivered=await fixture(page); await start(page);
  await page.clock.fastForward(31000); await expect.poll(()=>page.evaluate(()=>window.result)).toBe('AbortError'); expect(delivered).toHaveLength(0);
});
test('offline bench exports real decisions and fits narrow and wide screens',async({page})=>{
  await page.goto('http://127.0.0.1:8830/demo.html');
  await page.getByRole('button',{name:'Like a fictional post'}).click(); await page.getByRole('button',{name:'Cancel action'}).click();
  await page.getByRole('button',{name:'Read the fictional feed'}).click();
  await expect(page.locator('#delivered')).toHaveText('1'); await expect(page.locator('#cancelled')).toHaveText('1');
  const downloadPromise=page.waitForEvent('download'); await page.getByRole('button',{name:'Export session JSON'}).click();
  const download=await downloadPromise; const report=JSON.parse(fs.readFileSync(await download.path(),'utf8')); expect(report.fictional).toBe(true);expect(report.stats.cancelled).toBe(1);expect(report.deliveries).toBe(1);
  for(const width of [390,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  await page.screenshot({path:'docs/test-bench.png',fullPage:true});
});
