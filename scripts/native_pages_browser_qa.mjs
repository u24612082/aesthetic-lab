// Optional local browser smoke test: Node 22+ and installed macOS Google Chrome.
// Uses only the synthetic demo server, never the personal database.
import {spawn,execFileSync} from 'node:child_process';
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
let ws, originalLogs, originalTargets, originalPlanRows;
const headers={'Authorization':'Bearer '+secret,'Content-Type':'application/json'};
const api=async(path,options={})=>{const r=await fetch(base+path,{...options,headers});assert(r.ok,`${path}: HTTP ${r.status}`);return r.json()};
assert.equal((await api('/api/status')).demo,true,'Refusing to test writes on a personal workspace');
originalPlanRows=execFileSync('.venv/bin/python',['-c',`import sqlite3,json
c=sqlite3.connect('var/demo.sqlite3');c.row_factory=sqlite3.Row
print(json.dumps({t:[dict(r) for r in c.execute('SELECT * FROM '+t)] for t in ('nutrition_plan','nutrition_plan_history','nutrition_days','nutrition_settings')}))`],{encoding:'utf8'});

const delay=ms=>new Promise(r=>setTimeout(r,ms));
try {
  let port;
  for(let i=0;i<300;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{if(launchError || browser.exitCode!==null)break;await delay(100);}}
  assert(port,`Chrome did not start: ${launchError || launchStderr || 'No debugging port became available.'}`);
  const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let id=0;const pending=new Map(),errors=[];
  ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async(expression)=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
  await send('Runtime.enable');await send('Page.enable');

  const until=async(fn,label,timeout=20000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await delay(120)}throw Error(label+'; UI error: '+await evaluate(`document.querySelector('dialog [role="alert"]')?.textContent||''`))};
  const input=async(selector,value,select=false)=>{
    await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${select?'HTMLSelectElement':'HTMLInputElement'}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(${JSON.stringify(select?'change':'input')},{bubbles:true}))})()`);await delay(100);
  };
  const screenshot=async name=>{const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile('var/qa/'+name+'.png',Buffer.from(shot.data,'base64'))};
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:base});await delay(350);
  assert(await evaluate(`fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(secret)}})}).then(r=>r.ok)`));
  originalLogs=(await api('/api/offline/snapshot')).logs.map(l=>l.request_id);
  originalTargets=(await api('/api/nutrition/settings')).targets;
  await send('Page.reload');
  await until(()=>evaluate(`document.querySelectorAll('.card .list button.item').length===5`),'Home did not load');
  await evaluate(`import('/analytics/offline.js').then(m=>m.prepareOffline())`);
  await mkdir('var/qa',{recursive:true});
  for(const [route,title,selector] of [['analytics','Analytics','#stats .lab-stat'],['coach','Aesthetic coach','#coach-connection-message'],['nutrition','Nutrition','#food-diary']]){
    await evaluate(`location.hash='/${route}'`);
    await until(()=>evaluate(`!!document.querySelector(${JSON.stringify(selector)})`),route+' did not load');
    assert(await evaluate(`!document.querySelector('iframe') && document.querySelector('.lab-native-page h1').textContent===${JSON.stringify(title)} && document.querySelector('.lab-native-page').getBoundingClientRect().width>900`),route+' is still boxed into a subwindow');
    await screenshot('native-'+route+'-desktop');
  }
  await send('Emulation.setDeviceMetricsOverride',{width:402,height:874,deviceScaleFactor:1,mobile:true});await delay(150);
  assert(await evaluate(`document.documentElement.scrollWidth<=402`),'Nutrition horizontal overflow');
  await screenshot('native-nutrition-iphone');
  // Open a meal's button from farther down the page with a real pointer click.
  const before=await evaluate(`(()=>{const b=document.querySelector('[data-add-meal="Dinner"]');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,scroll:window.scrollY}})()`);
  assert(before.scroll>200,'Test must begin away from the top of the diary');
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:before.x,y:before.y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:before.x,y:before.y,button:'left',clickCount:1});
  await until(()=>evaluate(`!!document.querySelector('#food-filter')`),'Food dialog did not open');
  assert(await evaluate(`!document.querySelector('iframe') && document.body.style.position==='fixed' && Math.abs(parseFloat(document.body.style.top)+${before.scroll})<2`),'Opening food search moved the page');
  assert(await evaluate(`document.querySelector('#food-dialog').getBoundingClientRect().width===402`),'Phone food dialog is not full screen');
  await until(()=>evaluate(`document.querySelectorAll('[data-plan-food="true"]').length===32`),'Plan food collection did not load');
  assert(await evaluate(`document.querySelector('[data-food-scope="plan"]').classList.contains('on')`),'Plan foods should be easy to reach on opening');
  assert(await evaluate(`[...document.querySelectorAll('[data-plan-food="true"] strong')].some(e=>e.textContent.includes('Clover'))&&[...document.querySelectorAll('[data-plan-food="true"] strong')].some(e=>e.textContent.includes('PnP'))&&[...document.querySelectorAll('[data-plan-food="true"] strong')].some(e=>e.textContent.includes('NutriTech'))`),'Personal brands are missing from plan foods');
  await screenshot('native-plan-foods-iphone');
  await evaluate(`[...document.querySelectorAll('[data-food-id]')].find(b=>b.querySelector('strong').textContent==='Rice · cooked, long grain').click()`);
  await until(()=>evaluate(`!!document.querySelector('[data-plan-grams="250"]')`),'Cooked rice quick weights missing');
  await evaluate(`document.querySelector('[data-plan-grams="250"]').click()`);
  assert(await evaluate(`document.querySelector('#grams').value==='250'&&document.querySelector('#food-preview').textContent.includes('325 kcal')`),'Cooked rice weight or nutrient preview incorrect');
  await screenshot('native-plan-rice-iphone');
  await evaluate(`[...document.querySelectorAll('#food-dialog button')].find(b=>b.textContent==='Change food').click()`);
  await until(()=>evaluate(`document.querySelectorAll('[data-plan-food="true"]').length===32`),'Returning to plan foods failed');
  await evaluate(`[...document.querySelectorAll('[data-food-id]')].find(b=>b.querySelector('strong').textContent.startsWith('Clover Greek-style')).click()`);
  await until(()=>evaluate(`!!document.querySelector('[data-plan-grams="250"]')`),'Clover yoghurt quick weight missing');
  await evaluate(`document.querySelector('[data-plan-grams="250"]').click()`);
  await until(()=>evaluate(`document.querySelector('#food-preview>div:nth-child(2) strong').textContent===new Intl.NumberFormat('en-ZA',{maximumFractionDigits:1}).format(13.75)+' g'`),'Clover yoghurt must use its actual reference protein, not generic strained Greek yoghurt');
  await screenshot('native-plan-clover-iphone');
  await evaluate(`[...document.querySelectorAll('#food-dialog button')].find(b=>b.textContent==='Change food').click()`);
  await until(()=>evaluate(`document.querySelectorAll('[data-plan-food="true"]').length===32`),'Returning from Clover yoghurt failed');
  // A full-width button once squeezed this input to a tiny box on phones.
  for(const width of [375,393,402,440]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:874,deviceScaleFactor:1,mobile:true});await delay(100);
    const search=await evaluate(`(()=>{const input=document.querySelector('#food-filter'),box=document.querySelector('.lab-food-searchbox'),button=box.querySelector('button');return {input:input.getBoundingClientRect().width,box:box.getBoundingClientRect().width,button:button.getBoundingClientRect().width,height:input.getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
    assert(search.input>=search.box*.75&&search.button===44&&search.height>=48&&!search.overflow,`Food search is squeezed at ${width}px: ${JSON.stringify(search)}`);
  }
  await send('Emulation.setDeviceMetricsOverride',{width:402,height:874,deviceScaleFactor:1,mobile:true});
  await evaluate(`document.querySelector('#food-filter').focus({preventScroll:true})`);
  await input('#food-filter','whole eggs raw');
  await until(()=>evaluate(`[...document.querySelectorAll('[data-food-id]')].some(b=>b.textContent.includes('Eggs · whole, raw'))`),'Native food search failed');
  // A reduced visual viewport approximates the keyboard taking screen space.
  await send('Emulation.setDeviceMetricsOverride',{width:402,height:480,deviceScaleFactor:1,mobile:true});await delay(180);
  await until(()=>evaluate(`document.querySelector('.lab-dialog-head').getBoundingClientRect().top>=-1 && document.querySelector('#food-dialog').getBoundingClientRect().height<=481 && Math.abs(parseFloat(document.body.style.top)+${before.scroll})<2`),'Keyboard resize lost dialog or page position');
  await send('Emulation.setDeviceMetricsOverride',{width:402,height:874,deviceScaleFactor:1,mobile:true});await delay(180);
  await screenshot('native-food-search-iphone');
  await evaluate(`document.querySelector('#food-dialog [aria-label="Close Log food"]').click()`);await delay(250);
  assert(await evaluate(`Math.abs(window.scrollY-${before.scroll})<2 && document.body.style.position!=='fixed'`),'Closing search failed to restore diary position');
  // Search, portion weights and a queued save should preserve that same position.
  await evaluate(`document.querySelector('[data-add-meal="Dinner"]').click()`);await until(()=>evaluate(`!!document.querySelector('#food-filter')`),'Reopening search failed');
  await input('#food-filter','whole eggs raw');await until(()=>evaluate(`[...document.querySelectorAll('[data-food-id]')].some(b=>b.textContent.includes('Eggs · whole, raw'))`),'Egg search failed');
  await evaluate(`[...document.querySelectorAll('[data-food-id]')].find(b=>b.textContent.includes('Eggs · whole, raw')).click()`);await until(()=>evaluate(`!!document.querySelector('#log-form')`),'Weight form failed');
  await input('#portion-select','0',true);await input('#portion-count','2');
  assert.equal(await evaluate(`document.querySelector('#grams').value`),'100');
  assert(await evaluate(`document.querySelector('#food-preview').textContent.includes('143 kcal')`),'Egg nutrient preview changed');
  await screenshot('native-food-weight-iphone');
  await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await evaluate(`document.querySelector('#log-form').requestSubmit()`);
  await until(()=>evaluate(`!document.querySelector('#food-dialog')`),'Food save did not close dialog');
  assert(await evaluate(`Math.abs(window.scrollY-${before.scroll})<2`),'Saving food jumped the diary');
  await until(()=>evaluate(`[...document.querySelectorAll('.food-row')].some(r=>r.textContent.includes('Eggs · whole, raw'))`),'Saved food row did not render');
  const row=await evaluate(`[...document.querySelectorAll('.food-row')].find(r=>r.textContent.includes('Eggs · whole, raw')).querySelector('[data-edit-log]').dataset.editLog`);
  await evaluate(`document.querySelector('[data-edit-log="${row}"]').click()`);await until(()=>evaluate(`!!document.querySelector('#grams')`),'Edit form failed');
  assert(Number(row)<0,'New offline entry must have a temporary ID');
  await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await evaluate(`import('/analytics/offline.js').then(m=>m.syncOffline())`);
  await until(()=>evaluate(`import('/analytics/offline.js').then(m=>m.offlineStatus()).then(s=>s.pending===0)`),'Initial food acknowledgment did not finish');
  // The editor still holds the temporary ID, while the diary now has its Mac ID.
  await input('#grams','150');await evaluate(`document.querySelector('#log-form').requestSubmit()`);await until(()=>evaluate(`!document.querySelector('#food-dialog')`),'Edit did not save');
  await until(()=>evaluate(`[...document.querySelectorAll('.food-row')].some(r=>r.textContent.includes('Eggs · whole, raw')&&r.textContent.includes('150'))`),'Edited weight missing');
  assert(await evaluate(`Math.abs(window.scrollY-${before.scroll})<2`),'Editing food jumped the diary');
  // Targets use the same scroll-safe dialog.
  await evaluate(`document.querySelector('#nutrition-goals').click()`);await until(()=>evaluate(`!!document.querySelector('#nutrition-target-form')`),'Targets dialog failed');
  await input('#nutrition-target-form input[name="kcal"]','2700');await evaluate(`document.querySelector('#nutrition-target-form').requestSubmit()`);await until(()=>evaluate(`!document.querySelector('#nutrition-goal-dialog')`),'Targets did not close');
  assert(await evaluate(`Math.abs(window.scrollY-${before.scroll})<2`),'Targets dialog jumped the diary');
  await evaluate(`import('/analytics/offline.js').then(m=>m.syncOffline())`);
  await until(async()=>{const logs=(await api('/api/offline/snapshot')).logs.filter(l=>!originalLogs.includes(l.request_id));return logs.length===1&&logs[0].grams===150},'Native log did not reach demo server');
  // Configure through the real phone form and switch phase with history preserved.
  await evaluate(`document.querySelector('#macro-plan-edit').click()`);await until(()=>evaluate(`!!document.querySelector('#macro-plan-form')`),'Macro setup dialog failed');
  assert(await evaluate(`document.querySelector('#macro-plan-dialog').getBoundingClientRect().width===402`),'Macro setup is not full screen on phone');
  await input('#macro-plan-form [name="phase"]','lean_gain',true);
  await input('#macro-plan-form [name="age"]','30');await input('#macro-plan-form [name="height_cm"]','180');
  await input('#macro-plan-form [name="equation_sex"]','male',true);await input('#macro-plan-form [name="activity"]','1.55',true);
  await input('#macro-plan-form [name="starting_weight_kg"]','80');
  await screenshot('native-macro-setup-iphone');await evaluate(`document.querySelector('#macro-plan-form').requestSubmit()`);
  await until(()=>evaluate(`!document.querySelector('#macro-plan-dialog')&&document.querySelector('#macro-plan').textContent.includes('Slow lean surplus')`),'Macro setup did not save');
  const gain=await api('/api/nutrition/plan');assert(gain.configured&&gain.targets.protein>0);
  assert.equal((await api('/api/nutrition/settings')).targets.kcal,gain.targets.kcal,'Calculated targets did not reach diary settings');
  await evaluate(`document.querySelector('#macro-plan-edit').click()`);await until(()=>evaluate(`!!document.querySelector('#macro-plan-form')`),'Phase dialog failed');
  await input('#macro-plan-form [name="phase"]','slow_cut',true);await evaluate(`document.querySelector('#macro-plan-form').requestSubmit()`);
  await until(()=>evaluate(`!document.querySelector('#macro-plan-dialog')&&document.querySelector('#macro-plan').textContent.includes('Slow cut')`),'Cut phase did not save');
  const cut=await api('/api/nutrition/plan');assert(cut.targets.kcal<gain.targets.kcal&&cut.history.length>=2&&cut.assessment.state==='holding');
  assert(await evaluate(`document.documentElement.scrollWidth<=402`),'Macro card overflows phone');
  await evaluate(`window.scrollTo(0,0)`);await screenshot('native-macro-plan-iphone');
  // Complete-day confirmations survive offline reload and sync through the outbox.
  await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await evaluate(`document.querySelector('#nutrition-day-complete').click()`);
  await until(()=>evaluate(`document.querySelector('#nutrition-day-complete').checked`),'Offline complete-day flag did not save');
  await send('Page.reload');await until(()=>evaluate(`document.querySelector('#nutrition-day-complete')?.checked`),'Complete-day confirmation did not survive offline reload');
  await evaluate(`document.querySelector('#diary-add').click()`);
  await until(()=>evaluate(`document.querySelectorAll('[data-plan-food="true"]').length===32`),'All plan foods should remain available after an offline cold launch');
  await evaluate(`[...document.querySelectorAll('[data-food-id]')].find(b=>b.querySelector('strong').textContent==='Coco Pops · dry').click()`);
  await until(()=>evaluate(`!!document.querySelector('[data-plan-grams="70"]')`),'Coco Pops quick weight missing offline');
  await evaluate(`document.querySelector('[data-plan-grams="70"]').click()`);
  await until(()=>evaluate(`document.querySelector('#grams').value==='70'&&document.querySelector('#food-preview').textContent.includes(new Intl.NumberFormat('en-ZA',{maximumFractionDigits:1}).format(232.4)+' kcal')`),'Offline cereal preview incorrect');
  await screenshot('native-plan-food-offline-iphone');
  await evaluate(`document.querySelector('#food-dialog [aria-label="Close Log food"]').click()`);
  await until(()=>evaluate(`!document.querySelector('#food-dialog')`),'Offline food dialog did not close');
  await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await evaluate(`import('/analytics/offline.js').then(m=>m.syncOffline())`);
  await until(async()=>(await api('/api/offline/diary')).nutrition_days.some(d=>d.complete),'Complete food day did not sync',40000);
  // Every destination has a single, ordinary page scroll on the phone.
  for(const route of ['coach','analytics']){
    await evaluate(`location.hash='/${route}'`);
    await until(()=>evaluate(`!!document.querySelector(${JSON.stringify(route==='coach'?'#coach-report':'#volume-chart')})`),'Native '+route+' missing');
    assert(await evaluate(`!document.querySelector('iframe') && document.documentElement.scrollWidth<=402`),route+' phone overflow');
    await screenshot('native-'+route+'-iphone');
  }
  await input('#period','28',true);await until(()=>evaluate(`document.querySelector('#stats').textContent.includes('/28')`),'Analytics period did not refresh');
  assert.deepEqual(errors,[],'Browser runtime errors');
  console.log('Native page QA passed: no iframes, desktop/phone layouts, full-screen food dialog, keyboard resize, opening/cancel/save/edit/targets scroll recovery, 32 plan foods, quick gram weights online/offline, portions, nutrients, phase switching, offline complete-day persistence and sync.');
} finally {
  if(ws)ws.close();browser.kill('SIGTERM');await delay(600);
  if(originalLogs){for(const l of (await api('/api/offline/snapshot')).logs.filter(l=>!originalLogs.includes(l.request_id)))await api('/api/food-logs/'+l.id,{method:'DELETE'});}
  if(originalTargets)await api('/api/nutrition/settings',{method:'PUT',body:JSON.stringify(originalTargets)});
  if(originalPlanRows)execFileSync('.venv/bin/python',['-c',`import sqlite3,json,sys
rows=json.load(sys.stdin);c=sqlite3.connect('var/demo.sqlite3',timeout=10)
with c:
 for t in ('nutrition_plan','nutrition_plan_history','nutrition_days','nutrition_settings'):
  c.execute('DELETE FROM '+t)
  for r in rows[t]:c.execute('INSERT INTO '+t+'('+','.join(r)+') VALUES('+','.join('?' for _ in r)+')',tuple(r.values()))`],{input:originalPlanRows,encoding:'utf8'});
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
