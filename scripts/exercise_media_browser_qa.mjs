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
let ws, originalState;
const headers={'Authorization':'Bearer '+secret,'Content-Type':'application/json'};
const api=async(path,options={})=>{const r=await fetch(base+path,{...options,headers});assert(r.ok,`${path}: HTTP ${r.status}`);return r.json()};
assert.equal((await api('/api/status')).demo,true,'Refusing to test writes on a personal workspace');
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
  const evaluate=async(expression)=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value;};
  const until=async(fn,label,timeout=60000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await delay(100)}throw Error(label+'; UI: '+await evaluate(`document.body.innerText.slice(0,1800)`)+'; runtime: '+JSON.stringify(errors))};
  const screenshot=async name=>{await mkdir('var/qa',{recursive:true});const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile('var/qa/'+name+'.png',Buffer.from(r.data,'base64'))};
  await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:402,height:874,deviceScaleFactor:1,mobile:true});
  await send('Page.navigate',{url:base});await delay(350);
  assert(await evaluate(`fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(secret)}})}).then(r=>r.ok)`));
  originalState=(await api('/api/data')).state;
  const before=(await api('/api/dashboard')).stats;
  await send('Page.reload');await until(()=>evaluate(`document.querySelectorAll('.card .list button.item').length===5`),'Home failed');
  await evaluate(`import('/analytics/offline.js').then(m=>m.prepareOffline())`);
  await until(()=>evaluate(`import('/analytics/offline.js').then(m=>m.offlineStatus()).then(s=>s.media.ready)`),'Offline exercise image download did not finish',120000);
  const ready=await evaluate(`import('/analytics/offline.js').then(m=>m.offlineStatus()).then(s=>({ready:s.media.ready,total:s.media.total,completed:s.media.completed}))`);
  assert(ready.ready&&ready.total>=390&&ready.completed===ready.total);
  const aliases=JSON.parse(await readFile('aesthetic_lab/data/exercise_media_aliases.json','utf8'));
  const extra={id:'qa-images',name:'Additional exercise image coverage',ex:Object.keys(aliases.legacy_ids).map(id=>({id,sets:1,reps:10,weight:0,mode:'reps',prog:'off'}))};
  const routines=[...originalState.routines,extra];let checked=0;
  const showRoutine=async routine=>{
   const state=structuredClone(originalState),now=Date.now();state.active={id:'qa-media-'+routine.id,name:routine.name,routineId:routine.id,cur:0,bw:null,d:new Date().toISOString().slice(0,10),start:now,entries:routine.ex.map(e=>({id:e.id,target:{...e},sets:[{w:0,r:10,done:false}]}))};
   const current=await api('/api/data');await api('/api/data',{method:'PUT',body:JSON.stringify({state,revision:current.revision})});
   await send('Page.reload');
   await until(()=>evaluate(`[...Object.keys(localStorage)].filter(k=>k.startsWith('aesthetic_opengym_state_v1_')).some(k=>JSON.parse(localStorage[k]).state?.active?.id===${JSON.stringify(state.active.id)})`),'Updated demo workout did not load');
   await evaluate(`location.hash='/workout'`);
   await until(()=>evaluate(`document.querySelectorAll('.session-exercise').length===${routine.ex.length}`),'Workout exercise list failed');
  };
  const checkImages=async count=>{
   assert.equal(await evaluate(`document.querySelectorAll('.session-exercise [data-exercise-media]').length`),count);
   assert(await evaluate(`[...document.querySelectorAll('.session-exercise [data-media-kind]')].every(e=>['illustration','diagram'].includes(e.dataset.mediaKind))`),'A routine exercise only has a fallback guide');
   for(let i=0;i<count;i++){
    await evaluate(`document.querySelectorAll('.session-exercise')[${i}].scrollIntoView({block:'center'})`);
    await until(()=>evaluate(`[...document.querySelectorAll('.session-exercise')[${i}].querySelectorAll('.exercise-heading img')].every(img=>img.complete&&img.naturalWidth>0&&!new URL(img.src).pathname.includes('/areas/'))`),'Image failed to load');
   }
   assert.equal(await evaluate(`document.querySelectorAll('.session-exercise .exercise-visual').length`),0,'Workout headers should not contain a large image gallery');
   const icons=await evaluate(`[...document.querySelectorAll('.exercise-heading img')].map(img=>({width:img.getBoundingClientRect().width,height:img.getBoundingClientRect().height}))`);
   assert(icons.every(r=>Math.abs(r.width-64)<1&&Math.abs(r.height-64)<1),'Exercise icons should stay compact: '+JSON.stringify(icons));
   assert(await evaluate(`document.documentElement.scrollWidth<=402`),'Images overflow phone width');
  };
  for(const routine of routines){console.log('Checking images:',routine.name);await showRoutine(routine);await checkImages(routine.ex.length);checked+=routine.ex.length}
  assert.equal(checked,58);
  await showRoutine(originalState.routines[0]);await checkImages(8);
  await evaluate(`document.querySelector('.session-exercise').scrollIntoView({block:'start'})`);await screenshot('exercise-images-iphone');
  await evaluate(`document.querySelector('.session-exercise .exercise-illustration-button').click()`);
  await until(()=>evaluate(`!!document.querySelector('.sheet .exercise-visual')`),'Tapping an exercise icon did not open details');
  await until(()=>evaluate(`[...document.querySelectorAll('.sheet .exercise-photo-pair img')].every(img=>img.complete&&img.naturalWidth>0)`),'Detailed illustrations did not load');
  assert.equal(await evaluate(`document.querySelectorAll('.session-exercise').length`),8,'Viewing details changed the exercise list');
  await screenshot('exercise-illustration-details-iphone');
  await evaluate(`document.querySelector('#modal-root .mback').click()`);
  await until(()=>evaluate(`!document.querySelector('.sheet')`),'Exercise details did not close');
  await send('Network.clearBrowserCache');await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await send('Page.reload');await until(()=>evaluate(`document.querySelectorAll('.session-exercise').length===8`),'Offline workout cold launch failed');await checkImages(8);
  await screenshot('exercise-images-offline-iphone');
  await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await evaluate(`location.hash='/library'`);await until(()=>evaluate(`document.querySelectorAll('[data-exercise-thumbnail]').length>0`),'Exercise library did not load');
  await until(()=>evaluate(`[...document.querySelectorAll('[data-exercise-thumbnail]')].slice(0,5).every(img=>img.complete&&img.naturalWidth>0)`),'Library thumbnail failed');
  await screenshot('exercise-library-images-iphone');
  assert.equal((await api('/api/dashboard')).stats.sessions,before.sessions,'Viewing images changed completed-workout analytics');
  assert.deepEqual(errors,[],'Browser runtime errors');
  console.log('Exercise image QA passed: all 58 routine entries, full image bundle, compact illustrated headers, tap-to-view details, library thumbnails, offline cold launch with HTTP cache cleared, no completed-workout changes.');

} finally {
  if(originalState){const latest=await api('/api/data');await api('/api/data',{method:'PUT',body:JSON.stringify({state:originalState,revision:latest.revision})});}
  if(ws)ws.close();browser.kill('SIGTERM');await delay(600);await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
