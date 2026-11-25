// Optional local browser smoke test: Node 22+ and installed macOS Google Chrome.
// Uses only the synthetic demo server, never the personal database.
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const base='http://127.0.0.1:8766';
const secret=(await readFile('.env','utf8')).split('\n').find(l=>l.startsWith('APP_TOKEN=')).slice('APP_TOKEN='.length);
const profile=await mkdtemp(join(tmpdir(),'aesthetic-qa-'));
const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:['ignore','ignore','pipe']});
let launchError='', launchStderr='';
browser.on('error',error=>{launchError=error.message;});
browser.stderr.on('data',chunk=>{launchStderr=(launchStderr+chunk.toString()).slice(-3000);});
let ws, originalState, originalLogIds;
const headers={'Authorization':'Bearer '+secret,'Content-Type':'application/json'};
const api=async(path,options={})=>{const r=await fetch(base+path,{...options,headers});assert(r.ok,`${path}: HTTP ${r.status}`);return r.json()};
assert.equal((await api('/api/status')).demo,true,'Refusing to test writes on a personal workspace');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try {
  let port;
  for(let i=0;i<100;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{if(launchError || browser.exitCode!==null)break;await delay(100);}}
  assert(port,`Chrome did not start: ${launchError || launchStderr || 'No debugging port became available.'}`);
  const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let id=0;const pending=new Map(),errors=[];
  ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async(expression)=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
  await send('Runtime.enable');await send('Page.enable');

  const until=async(fn,label,timeout=20000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await delay(150)}throw Error(label)};
  await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"Object.defineProperty(navigator,'standalone',{get:()=>true})"});
  await send('Emulation.setDeviceMetricsOverride',{width:402,height:874,deviceScaleFactor:1,mobile:true});
  await send('Page.navigate',{url:base});await delay(400);
  assert(await evaluate(`fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(secret)}})}).then(r=>r.ok)`));
  originalState=(await api('/api/data')).state;
  originalLogIds=(await api('/api/offline/snapshot')).logs.map(l=>l.request_id);
  const clean=structuredClone(originalState);clean.active=null;const version=await api('/api/data');await api('/api/data',{method:'PUT',body:JSON.stringify({state:clean,revision:version.revision})});
  await send('Page.reload');
  await until(()=>evaluate(`document.querySelectorAll('.card .list button.item').length===5`),'Home failed');
  await evaluate(`import('/analytics/offline.js').then(m=>m.prepareOffline())`);
  await evaluate(`navigator.serviceWorker.ready`);
  await until(()=>evaluate(`!!navigator.serviceWorker.controller`),'Service worker did not control app');
  assert(await evaluate(`import('/analytics/offline.js').then(m=>m.offlineStatus()).then(s=>!!s.prepared)`),'Food library not prepared');
  await evaluate(`document.querySelector('.card .list button.item').click()`);
  await until(()=>evaluate(`document.querySelectorAll('.session-exercise').length===8`),'Routine missing');
  // Wait for the initial online draft to finish before disconnecting.
  await until(async()=>!!(await api('/api/data')).state.active,'Online draft did not save');
  await delay(600);
  await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await evaluate(`document.querySelector('.setrow [role="checkbox"]').click()`);await delay(700);
  assert.equal((await api('/api/data')).state.active.entries[0].sets[0].done,false,'Offline set reached server unexpectedly');
  await evaluate(`[...document.querySelectorAll('.lab-links button')].find(b=>b.textContent==='Nutrition').click()`);
  const foodExpr=code=>evaluate(`(()=>{const d=document;if(!d.querySelector('.lab-native-page'))return false;${code}})()`);
  await until(()=>foodExpr(`return !!d.querySelector('#diary-add')`),'Offline food page failed to load');
  await until(()=>foodExpr(`return d.querySelector('#food-diary')?.children.length===4`),'Offline meal diary did not load');
  await foodExpr(`d.querySelector('#diary-add').click();return true`);await delay(200);
  await foodExpr(`const f=d.querySelector('#food-filter');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(f,'whole eggs raw');f.dispatchEvent(new Event('input',{bubbles:true}));return true`);
  await until(()=>foodExpr(`return [...d.querySelectorAll('[data-food-id]')].some(b=>b.textContent.includes('Eggs · whole, raw'))`),'Offline egg search failed');
  await foodExpr(`[...d.querySelectorAll('[data-food-id]')].find(b=>b.textContent.includes('Eggs · whole, raw')).click();return true`);
  await until(()=>foodExpr(`return !!d.querySelector('#log-form')`),'Weight form did not open');
  await foodExpr(`d.querySelector('#grams').value='100';d.querySelector('#log-form').elements.meal.value='Breakfast';d.querySelector('#log-form').requestSubmit();return true`);
  await until(()=>foodExpr(`return d.querySelector('#food-diary').textContent.includes('Eggs · whole, raw')`),'Offline food not saved');
  await foodExpr(`const row=[...d.querySelectorAll('.food-row')].find(r=>r.textContent.includes('Eggs · whole, raw'));row.querySelector('[data-edit-log]').click();return true`);await delay(250);
  await foodExpr(`d.querySelector('#grams').value='150';d.querySelector('#log-form').requestSubmit();return true`);
  await until(()=>foodExpr(`return [...d.querySelectorAll('.food-row')].some(r=>r.textContent.includes('Eggs · whole, raw')&&r.textContent.includes('150'))`),'Offline edit failed');
  await foodExpr(`[...d.querySelectorAll('.food-row')].find(r=>r.textContent.includes('Eggs · whole, raw')).querySelector('[data-repeat-log]').click();return true`);
  await until(()=>foodExpr(`return [...d.querySelectorAll('.food-row')].filter(r=>r.textContent.includes('Eggs · whole, raw')).length===2`),'Offline repeat failed');
  await foodExpr(`[...d.querySelectorAll('.food-row')].filter(r=>r.textContent.includes('Eggs · whole, raw')).at(-1).querySelector('[data-delete-log]').click();return true`);
  await until(()=>foodExpr(`return [...d.querySelectorAll('.food-row')].filter(r=>r.textContent.includes('Eggs · whole, raw')).length===1`),'Offline delete failed');
  assert.equal(await evaluate(`import('/analytics/offline.js').then(m=>m.offlineStatus()).then(s=>s.pending)`),4,'Food operations were not durable');
  assert(await evaluate(`document.documentElement.scrollWidth<=402`),'iPhone portrait overflow');
  // A new JavaScript session with the same installed-app storage must recover offline work.
  await evaluate(`sessionStorage.clear()`);await send('Page.reload');
  await until(()=>foodExpr(`return [...d.querySelectorAll('.food-row')].some(r=>r.textContent.includes('Eggs · whole, raw')&&r.textContent.includes('150'))`),'Offline cold launch lost food');
  await evaluate(`location.hash='/workout'`);
  await until(()=>evaluate(`document.querySelector('.setrow [role="checkbox"]')?.getAttribute('aria-checked')==='true'`),'Offline cold launch lost checked set');
  await send('Emulation.setDeviceMetricsOverride',{width:874,height:402,deviceScaleFactor:1,mobile:true});
  assert(await evaluate(`document.documentElement.scrollWidth<=874`),'iPhone landscape overflow');
  await send('Emulation.setDeviceMetricsOverride',{width:402,height:874,deviceScaleFactor:1,mobile:true});
  await evaluate(`document.querySelector('[aria-label="Finish"]').click()`);await delay(100);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Finish workout').click()`);await delay(300);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Nice!')?.click()`);
  const mac=await api('/api/data'),macId='offline-qa-mac-'+Date.now();
  mac.state.active=null;mac.state.workouts.push({id:macId,name:'QA independent Mac workout',start:Date.now()-60000,end:Date.now(),entries:[]});
  await api('/api/data',{method:'PUT',body:JSON.stringify(mac)});
  await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await until(async()=>{const s=(await api('/api/data')).state;return s.workouts.length===clean.workouts.length+2},'Independent phone and Mac workouts did not merge',30000);
  assert((await api('/api/data')).state.workouts.some(w=>w.id===macId),'Phone overwrote Mac session');
  await until(async()=>{const logs=(await api('/api/offline/snapshot')).logs.filter(l=>!originalLogIds.includes(l.request_id));return logs.length===1&&logs[0].grams===150},'Food queue failed to replay',30000);
  await until(()=>evaluate(`import('/analytics/offline.js').then(m=>m.offlineStatus()).then(s=>s.pending===0)`),'Pending queue not acknowledged');
  await evaluate(`import('/analytics/offline.js').then(async m=>{await m.syncOffline();await m.syncOffline()})`);
  let logs=(await api('/api/offline/snapshot')).logs.filter(l=>!originalLogIds.includes(l.request_id));assert.equal(logs.length,1,'Retry duplicated food');assert.equal(logs[0].kcal,214.5,'Offline label snapshot changed');
  // An independent Mac edit to this same food entry must be retained on conflict.
  await evaluate(`location.hash='/nutrition'`);
  await until(()=>foodExpr(`return [...d.querySelectorAll('.food-row')].some(r=>r.textContent.includes('Eggs · whole, raw'))`),'Reopened food diary missing');
  await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await foodExpr(`[...d.querySelectorAll('.food-row')].find(r=>r.textContent.includes('Eggs · whole, raw')).querySelector('[data-edit-log]').click();return true`);await delay(200);
  await foodExpr(`d.querySelector('#grams').value='175';d.querySelector('#log-form').requestSubmit();return true`);
  await until(()=>evaluate(`import('/analytics/offline.js').then(m=>m.offlineStatus()).then(s=>s.pending===1)`),'Second offline edit not queued');
  await api('/api/food-logs/'+logs[0].id,{method:'PATCH',body:JSON.stringify({grams:200,meal:'Breakfast',local_date:logs[0].local_date})});
  await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await until(()=>evaluate(`import('/analytics/offline.js').then(m=>m.offlineStatus()).then(s=>s.conflicts.length===1)`),'Mac food conflict not surfaced',30000);
  logs=(await api('/api/offline/snapshot')).logs.filter(l=>!originalLogIds.includes(l.request_id));assert.equal(logs[0].grams,200,'Stale phone edit overwrote Mac');
  assert(await foodExpr(`return [...d.querySelectorAll('.food-row')].some(r=>r.textContent.includes('Eggs · whole, raw')&&r.textContent.includes('175'))`),'Pending phone conflict was lost');
  await mkdir('var/qa',{recursive:true});const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile('var/qa/iphone-offline-sync.png',Buffer.from(shot.data,'base64'));
  assert.deepEqual(errors,[],'Browser runtime errors');
  console.log('Offline iPhone QA passed: 402×874/landscape, cached cold launch, set persistence, offline food search/log/edit/repeat/delete, independent-workout merge, duplicate-safe retries, and food conflict preservation.');
} finally {
  if(ws)ws.close();browser.kill('SIGTERM');await delay(600);
  if(originalState){const latest=await api('/api/data');await api('/api/data',{method:'PUT',body:JSON.stringify({state:originalState,revision:latest.revision})});}
  if(originalLogIds){for(const log of (await api('/api/offline/snapshot')).logs.filter(l=>!originalLogIds.includes(l.request_id)))await api('/api/food-logs/'+log.id,{method:'DELETE'});}
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
