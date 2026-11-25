// Optional local browser smoke test: Node 22+ and installed macOS Google Chrome.
// Uses only the synthetic demo server, never the personal database.
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const base='http://127.0.0.1:8766';
const testSharedLoads=process.argv.includes('--shared-loads');
const testSwaps=process.argv.includes('--swaps')||testSharedLoads;
const secret=(await readFile('.env','utf8')).split('\n').find(l=>l.startsWith('APP_TOKEN=')).slice('APP_TOKEN='.length);
const profile=await mkdtemp(join(tmpdir(),'aesthetic-qa-'));
let browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:['ignore','ignore','pipe']});
let launchError='', launchStderr='';
browser.on('error',error=>{launchError=error.message;});
browser.stderr.on('data',chunk=>{launchStderr=(launchStderr+chunk.toString()).slice(-3000);});
let ws,originalState;
const headers={'Authorization':'Bearer '+secret,'Content-Type':'application/json'};
const api=async(path,options={})=>{const r=await fetch(base+path,{...options,headers});assert(r.ok,`${path}: HTTP ${r.status}`);return r.json()};
assert.equal((await api('/api/status')).demo,true,'Refusing to test writes on a personal workspace');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const journal=`JSON.parse(localStorage.getItem('aesthetic_opengym_device_journal_v1'))`;
let send,evaluate,until;
const errors=[];
async function connect(){
 let port;
 for(let i=0;i<300;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break}catch{if(launchError||browser.exitCode!==null)break;await delay(100)}}
 assert(port,'Chrome did not start: '+(launchError||launchStderr));
 const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 let id=0;const pending=new Map();
 ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
 send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
 evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
 until=async(fn,label,timeout=30000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await delay(120)}throw Error(label+'; UI: '+await evaluate(`document.body.innerText.slice(0,1600)`))};
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:402,height:874,deviceScaleFactor:1,mobile:true});
}
const input=async(selector,value)=>{await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await delay(120)};
const shot=async name=>{await mkdir('var/qa',{recursive:true});const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile('var/qa/'+name+'.png',Buffer.from(r.data,'base64'))};
async function closeBrowser(){if(ws)ws.close();if(browser.exitCode===null)await new Promise(resolve=>{browser.once('exit',resolve);browser.kill('SIGTERM')})}
try{
 await connect();await send('Page.navigate',{url:base});await delay(250);
 assert(await evaluate(`fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(secret)}})}).then(r=>r.ok)`));
 originalState=(await api('/api/data')).state;
 const clean=structuredClone(originalState);clean.active=null;const current=await api('/api/data');await api('/api/data',{method:'PUT',body:JSON.stringify({state:clean,revision:current.revision})});
 await send('Page.reload');await until(()=>evaluate(`document.querySelectorAll('.card .list button.item').length===5`),'Routine download failed');
 await until(()=>evaluate(`document.querySelector('[data-workout-offline-ready="true"]')!==null`),'Offline app was not confirmed ready',60000);
 // This is a genuinely new Stats screen: it was not opened online to warm its lazy code.
 await send('Network.clearBrowserCache');await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 await evaluate(`location.hash='/stats'`);await until(()=>evaluate(`!!document.querySelector('[aria-label="Log body weight"]')`),'Stats could not open offline');
 await evaluate(`document.querySelector('[aria-label="Log body weight"]').click()`);await until(()=>evaluate(`!!document.querySelector('[aria-label="Body weight (kg)"]')`),'Weigh-in form failed offline');
 await input('[aria-label="Body weight (kg)"]','81,7');await evaluate(`[...document.querySelectorAll('.sheet button')].find(b=>b.textContent.trim()==='Save').click()`);
 await until(()=>evaluate(`${journal}?.state.bodyweight.some(b=>b.w===81.7)`),'Body weight was not durably saved');
 const weightDate=await evaluate(`${journal}.state.bodyweight.at(-1).d`);
 assert.deepEqual((await api('/api/data')).state.bodyweight,clean.bodyweight,'Offline weigh-in reached the Mac unexpectedly');
 await evaluate(`location.hash='/home'`);await until(()=>evaluate(`document.querySelectorAll('.card .list button.item').length===5`),'Offline home did not open');
 await evaluate(`document.querySelector('.card .list button.item').click()`);await until(()=>evaluate(`document.querySelectorAll('.session-exercise').length===8`),'Cannot start a new workout offline');
 await input('.session-exercise .setrow .w input','82,5');await input('.session-exercise .setrow .r input','9');
 await evaluate(`document.querySelector('.session-exercise .setrow [role="checkbox"]').click()`);
 await until(()=>evaluate(`${journal}.state.active.entries[0].sets[0].done`),'Checked set was not saved');
 assert(await evaluate(`${journal}.state.active.entries[0].sets[0].w===82.5&&${journal}.state.active.entries[0].sets[0].r===9&&${journal}.dirty`));
 assert(await evaluate(`!!document.querySelector('.exercise-heading .lab-swap-button')`),'Swap is missing from the exercise header');
 await evaluate(`window.scrollTo(0,1500)`);await delay(150);
 assert(await evaluate(`(()=>{const r=document.querySelector('.timer-dock').getBoundingClientRect();return r.top>=-1&&r.top<20&&r.bottom<innerHeight/2})()`),'Rest timer did not stay pinned at the top while scrolling');
 await evaluate(`window.scrollTo(0,0)`);
 const plannedId=await evaluate(`${journal}.state.active.entries[0].id`);
 if(testSwaps){
  await evaluate(`document.querySelector('.session-exercise .lab-swap-button').click()`);
  await until(()=>evaluate(`!!document.querySelector('.sheet .search input')`),'Swap picker failed offline');
  await input('.sheet .search input','dumbbell lateral raise');
  await evaluate(`[...document.querySelectorAll('.sheet .list .item')].find(e=>e.querySelector('.tt')?.textContent.trim().toLowerCase()==='dumbbell lateral raise').click()`);
  await until(()=>evaluate(`!![...document.querySelectorAll('.sheet button')].find(b=>b.textContent==='Swap for this workout')`),'Replacement confirmation missing');
  await input('.sheet .cfgrow .stp-w:nth-child(3) input','15');
  await evaluate(`[...document.querySelectorAll('.sheet button')].find(b=>b.textContent==='Swap for this workout').click()`);
  await until(()=>evaluate(`${journal}.state.active.entries[1]?.id==='0334'`),'Replacement was not saved offline');
  assert(await evaluate(`${journal}.state.active.entries[0].endedBySwap&&${journal}.state.active.entries[0].sets.length===1&&${journal}.state.active.entries[1].sets.length===2`),'Swapping lost completed sets or remaining targets');
  assert.deepEqual(await evaluate(`${journal}.state.routines`),clean.routines,'Swap modified the saved routine');
  assert.equal(await evaluate(`document.querySelector('[data-exercise-index="1"] .setrow .w input').value`),'15','Original machine load leaked into replacement');
  await evaluate(`document.querySelector('[data-exercise-index="1"] .setrow [role="checkbox"]').click()`);
  await until(()=>evaluate(`${journal}.state.active.entries[1].sets[0].done`),'Replacement set was not tracked');
 }
 await until(()=>evaluate(`!!document.querySelector('[data-workout-offline-ready="true"]')`),'Device transaction did not confirm the save');
 await shot('workout-offline-iphone');
 // A browser process restart loses sessionStorage/tab IDs. Cache Storage and the
 // canonical journal must recover work even outside standalone Home Screen mode.
 await closeBrowser();await rm(join(profile,'DevToolsActivePort'),{force:true});
 browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:['ignore','ignore','pipe']});
 browser.stderr.on('data',()=>{});await connect();await send('Network.clearBrowserCache');await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 const began=Date.now();await send('Page.navigate',{url:base+'/#/workout'});
 await until(()=>evaluate(`document.querySelector('.setrow [role="checkbox"]')?.getAttribute('aria-checked')==='true'`),'Closing and reopening lost the offline lift',15000);
 assert(Date.now()-began<15000,'Offline startup waited for the Mac');
 assert(await evaluate(`${journal}.state.bodyweight.some(b=>b.w===81.7)&&document.querySelector('.setrow .w input').value==='82.5'`),'Cold launch lost the actual recorded weights');
 assert(await evaluate(`document.getElementById('app-startup').hidden`),'Startup fallback obscured the recovered workout');
 if(testSwaps)assert(await evaluate(`${journal}.state.active.entries[1].id==='0334'&&${journal}.state.active.entries[1].sets[0].done`),'Restart lost the temporary swap');
 await send('Page.setWebLifecycleState',{state:'frozen'});await delay(150);await send('Page.setWebLifecycleState',{state:'active'});
 assert(await evaluate(`document.querySelector('.setrow [role="checkbox"]').getAttribute('aria-checked')==='true'`),'Background/resume lost the gym log');
 await evaluate(`document.querySelector('[aria-label="Finish"]').click()`);await delay(100);
 await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Finish workout').click()`);
 await until(()=>evaluate(`${journal}.state.workouts.length===${clean.workouts.length+1}`),'Finishing offline did not persist the workout');
 const workoutId=await evaluate(`${journal}.state.workouts.at(-1).id`);
 await until(()=>evaluate(`!!document.querySelector('[data-workout-offline-ready="true"]')`),'Finished workout save was not confirmed');
 // Expired pairing must not hide the saved local log. Server writes still
 // require real authentication and resume only after a successful pairing.
 await send('Network.clearBrowserCookies');await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 await send('Page.reload');await until(()=>evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent==='Pair to sync')`),'Expired pairing did not preserve offline access');
 assert(await evaluate(`!document.querySelector('#pair-token')&&${journal}.state.workouts.some(w=>w.id===${JSON.stringify(workoutId)})`),'Pairing expiry replaced the log with a login screen');
 await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Pair to sync').click()`);await until(()=>evaluate(`!!document.querySelector('#pair-token')`),'Reconnect form missing');
 await input('#pair-token',secret);await evaluate(`document.querySelector('#pair-token').closest('form').requestSubmit()`);
 await until(async()=>{const s=(await api('/api/data')).state;return s.workouts.some(w=>w.id===workoutId)&&s.bodyweight.some(b=>b.d===weightDate&&b.w===81.7)},'Recorded lift and weigh-in did not sync after pairing',30000);
 await until(()=>evaluate(`${journal}.dirty===false`),'Mac acknowledgement did not clear the pending journal');
 const saved=(await api('/api/data')).state;
 assert.equal(saved.workouts.filter(w=>w.id===workoutId).length,1,'Retry duplicated the workout');
 const logged=saved.workouts.find(w=>w.id===workoutId).entries[0].sets[0];assert(logged.w===82.5&&logged.r===9);
 if(testSwaps){
  assert.equal(saved.active,null,'Finished session remained active after reconnect');
  const replacement=saved.workouts.find(w=>w.id===workoutId).entries.find(e=>e.id==='0334');
  assert.equal(replacement.n,'dumbbell lateral raise');assert.equal(replacement.sets[0].w,15);assert.equal(replacement.swap.plannedId,plannedId);
  assert.deepEqual(saved.routines,clean.routines,'Sync changed the general workout plan');
  await evaluate(`location.hash='/home'`);await until(()=>evaluate(`document.querySelectorAll('.card .list button.item').length===5`),'Home did not reopen');
  await evaluate(`document.querySelector('.card .list button.item').click()`);
  await until(()=>evaluate(`${journal}.state.active?.id!==${JSON.stringify(workoutId)}&&${journal}.state.active?.entries[0].id===${JSON.stringify(plannedId)}&&!!document.querySelector('[aria-label="Discard"]')`),'Next workout did not restore the original exercise');
  assert(await evaluate(`${journal}.state.active.entries.every(e=>!e.swap)`),'Temporary swap leaked into the next planned workout');
 }
 if(testSharedLoads){
  // The supplied program deliberately gave these matching machine lateral
  // raises different IDs on Days 1 and 4. Test the user's real data structure.
  await evaluate(`document.querySelector('[aria-label="Discard"]').click()`);await delay(100);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Discard').click()`);
  await until(()=>evaluate(`document.querySelectorAll('.card .list button.item').length===5`),'Discard did not return home');
  await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await evaluate(`document.querySelectorAll('.card .list button.item')[3].click()`);
  await until(()=>evaluate(`!!document.querySelector('[data-exercise-index="4"] .setrow .w input')`),'Day 4 did not start offline');
  assert.equal(await evaluate(`document.querySelector('[data-exercise-index="4"] .setrow .w input').value`),'82.5','Different routine lost the shared last weight');
  await input('[data-exercise-index="4"] .setrow .w input','36');await input('[data-exercise-index="4"] .setrow .r input','9');
  await evaluate(`document.querySelector('[data-exercise-index="4"] .setrow [role="checkbox"]').click()`);
  await evaluate(`document.querySelector('[aria-label="Finish"]').click()`);await delay(100);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Finish workout').click()`);
  await until(()=>evaluate(`document.body.innerText.includes('Workout complete!')`),'Second offline workout did not finish');
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Nice!').click()`);
  await until(()=>evaluate(`document.querySelectorAll('.card .list button.item').length===5`),'Home did not return');
  await evaluate(`document.querySelector('.card .list button.item').click()`);
  await until(()=>evaluate(`!!document.querySelector('.session-exercise .setrow .w input')`),'Day 1 did not reopen');
  assert.equal(await evaluate(`document.querySelector('.session-exercise .setrow .w input').value`),'36','Latest lighter weight did not carry back to the original routine');
  assert(await evaluate(`document.querySelector('.session-exercise').innerText.includes('Best: 82.5')`),'Shared weight memory overwrote the actual PR');
  assert(await evaluate(`document.querySelector('.session-exercise .exercise-records summary').innerText.includes('82.5 kg × 9 reps')`),'Deload replaced the historical weight/reps record');
  await evaluate(`document.querySelector('.session-exercise .exercise-records summary').click()`);
  assert(await evaluate(`document.querySelector('.session-exercise .exercise-record-highlights strong').textContent==='82.5 kg × 9 reps'`),'Records combined unrelated weight and rep maxima');
  assert(await evaluate(`[...document.querySelectorAll('.session-exercise:first-of-type .exercise-record-table tbody tr')].some(row=>row.cells[0].textContent==='82.5 kg'&&row.cells[1].textContent==='9')`),'Best reps at the old working load were unavailable offline');
  assert(await evaluate(`document.querySelector('.session-exercise .exercise-records').innerText.includes('Previous working sets')`),'Prior working sessions are missing');
  await evaluate(`document.querySelector('.session-exercise .exercise-records').scrollIntoView({block:'center'})`);
  await shot('exercise-records-deload-iphone');
  await evaluate(`document.querySelector('.session-exercise [aria-label="Details"]').click()`);
  await until(()=>evaluate(`!!document.querySelector('.sheet section.exercise-records .exercise-record-highlights strong')`),'Exercise info did not show its working-set records offline');
  assert.equal(await evaluate(`document.querySelector('.sheet section.exercise-records .exercise-record-highlights strong').textContent`),'82.5 kg × 9 reps','Exercise info lost the old working-set peak');
  await evaluate(`document.querySelector('.mback').click()`);
  assert.deepEqual(await evaluate(`${journal}.state.routines`),clean.routines,'Shared memory changed routine templates');
  console.log('Shared load QA passed: Day 1 → Day 4 → Day 1 uses the latest lighter working load across distinct IDs, retains the PR, works offline, and keeps the timer pinned at the top.');
  console.log('Deload records QA passed: actual peak weight/reps, rep bests by load, previous working sets and exercise info stay available offline while the next-session load remains lighter.');
 }
 assert(await evaluate(`document.documentElement.scrollWidth<=402`),'Phone layout overflows');
 assert.deepEqual(errors,[],'Browser runtime errors');
 console.log('Offline weight QA passed: new offline Stats screen, typed body weight and lift/reps, immediate durable save, full browser restart with fresh tab, offline finish, pairing-expiry access, authenticated resync and exactly-once workout delivery.');
 if(testSwaps)console.log('Temporary swap QA passed: offline search/configuration, completed original sets retained, replacement logged under its own identity, restart recovery, sync, and original plan restored next session.');
}finally{
 await closeBrowser();
 if(originalState){const latest=await api('/api/data');await api('/api/data',{method:'PUT',body:JSON.stringify({state:originalState,revision:latest.revision})})}
 await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
