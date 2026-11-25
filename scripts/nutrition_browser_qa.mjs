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
let ws;
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
  const evaluate=async(expression)=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value;};
  await send('Runtime.enable');await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:base+'/analytics/'});await delay(700);
  // Secret passes in memory over a local debugging socket and is never printed or saved.
  const paired=await evaluate(`fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(secret)}})}).then(r=>r.ok)`);
  assert(paired,'Pairing failed');await send('Page.reload');await delay(800);
  for(let i=0;i<80;i++){if(await evaluate(`document.querySelector('#stats').children.length===4`))break;await delay(150)}
  assert(await evaluate(`document.querySelector('#stats').children.length===4`),'Stats did not load');
  assert(await evaluate(`!document.querySelector('#demo-banner').hidden`),'Refusing to mutate an unlabelled workspace');
  await mkdir('var/qa',{recursive:true});
  let shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile('var/qa/desktop.png',Buffer.from(shot.data,'base64'));
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(200);
  assert(await evaluate(`document.documentElement.scrollWidth<=390`),'Mobile horizontal overflow');
  shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile('var/qa/iphone.png',Buffer.from(shot.data,'base64'));
  await evaluate(`document.querySelector('[data-view="nutrition"]').click()`);await delay(300);
  const initial=await evaluate(`fetch('/api/nutrition/settings').then(r=>r.json())`);
  await evaluate(`document.querySelector('#nutrition-goals').click()`);await delay(100);
  await evaluate(`document.querySelector('#nutrition-target-form').elements.kcal.value='2700';document.querySelector('#nutrition-target-form').requestSubmit()`);await delay(300);
  assert(await evaluate(`document.querySelector('#diary-stats').textContent.replace(/[^0-9]/g,'').includes('2700')`),'Calorie target was not displayed');
  await evaluate(`document.querySelector('#diary-add').click()`);await delay(250);
  await evaluate(`const f=document.querySelector('#food-filter');f.value='whole eggs raw';f.dispatchEvent(new Event('input',{bubbles:true}))`);await delay(450);
  assert(await evaluate(`document.querySelector('#food-options').textContent.includes('Eggs · whole, raw')`),'Basic whole eggs missing from search');
  await evaluate(`[...document.querySelectorAll('[data-food-id]')].find(b=>b.textContent.includes('Eggs · whole, raw')).click()`);await delay(100);
  await evaluate(`document.querySelector('#portion-select').value='0';document.querySelector('#portion-select').dispatchEvent(new Event('change'));document.querySelector('#portion-count').value='2';document.querySelector('#portion-count').dispatchEvent(new Event('input'))`);
  assert.equal(await evaluate(`document.querySelector('#grams').value`),'100','Two large eggs should convert to 100 g edible portion');
  assert(await evaluate(`document.querySelector('#food-preview').textContent.includes('143 kcal')`),'Egg macro preview incorrect');
  const before=await evaluate(`fetch('/api/dashboard?days=7').then(r=>r.json()).then(d=>d.food_logs.map(l=>l.id))`);
  await evaluate(`document.querySelector('#log-form').elements.meal.value='Breakfast';document.querySelector('#log-form').requestSubmit()`);await delay(500);
  assert(await evaluate(`document.querySelector('#food-diary').textContent.includes('Eggs · whole, raw')`),'Saved eggs missing from meal diary');
  await evaluate(`document.querySelector('[data-edit-log]').click()`);await delay(300);
  await evaluate(`document.querySelector('#grams').value='150';document.querySelector('#log-form').requestSubmit()`);await delay(400);
  assert(await evaluate(`document.querySelector('#food-diary').textContent.includes('150')`),'Editing diary weight failed');
  await evaluate(`document.querySelector('[data-repeat-log]').click()`);await delay(400);
  assert(await evaluate(`document.documentElement.scrollWidth<=390`),'Nutrition page horizontal overflow');
  shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile('var/qa/nutrition-iphone.png',Buffer.from(shot.data,'base64'));
  await evaluate(`Promise.all([fetch('/api/dashboard?days=7').then(r=>r.json()).then(d=>Promise.all(d.food_logs.filter(l=>!${JSON.stringify(before)}.includes(l.id)).map(l=>fetch('/api/food-logs/'+l.id,{method:'DELETE'})))),fetch('/api/nutrition/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(initial.targets))}})])`);
  assert.deepEqual(errors,[],'Browser runtime errors');
  console.log('Nutrition browser QA passed: targets, common-food search, two-egg portions, macro preview, saving, editing, repeat and mobile layout. Demo changes restored.');

} finally {
  if(ws)ws.close();browser.kill('SIGTERM');await delay(600);await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
