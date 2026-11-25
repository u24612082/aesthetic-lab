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
  await send('Runtime.enable');await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:base});await delay(500);
  assert(await evaluate(`fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(secret)}})}).then(r=>r.ok)`),'Pairing failed');
  originalState=(await api('/api/data')).state;
  const before=(await api('/api/dashboard')).stats;
  await send('Page.reload');await delay(1100);
  assert.equal(await evaluate(`document.querySelectorAll('.card .list button.item').length`),5,'Missing five routine templates');
  assert(await evaluate(`document.body.textContent.includes('SYNTHETIC DEMO WORKSPACE')`),'Demo must be clearly labelled');
  await mkdir('var/qa',{recursive:true});
  const screenshot=async(name)=>{const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile('var/qa/'+name+'.png',Buffer.from(shot.data,'base64'))};
  await screenshot('tracker-desktop');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(250);
  assert(await evaluate(`document.documentElement.scrollWidth<=390`),'Mobile home horizontal overflow');
  await screenshot('tracker-iphone');
  await evaluate(`document.querySelector('.card .list button.item').click()`);await delay(700);
  assert.equal(await evaluate(`document.querySelectorAll('.session-exercise').length`),8,'All eight exercises must be visible in the session');
  assert(await evaluate(`document.querySelectorAll('.setrow').length===21`),'All planned set rows must be present');
  for(let i=0;i<3;i++){await evaluate(`[...document.querySelectorAll('.session-exercise')].at(-1).querySelectorAll('[role="checkbox"]')[${i}].click()`);await delay(100)}await delay(600);
  assert(await evaluate(`document.querySelectorAll('.session-exercise').length===8 && !document.body.textContent.includes('Save & next exercise') && !document.body.textContent.includes("That’s the whole workout!")`),'Completing the last exercise should not hide other exercises or finish an incomplete session');
  for(let i=0;i<3;i++){await evaluate(`[...document.querySelectorAll('.session-exercise')].at(-1).querySelectorAll('[role="checkbox"]')[${i}].click()`);await delay(100)}await delay(600);
  assert(await evaluate(`document.querySelector('.setrow input').value==='77'`),'Kilogram reference load was lost');
  await evaluate(`document.querySelector('.setrow [role="checkbox"]').click()`);await delay(900);
  assert(await evaluate(`document.querySelector('#timer .lbl')?.textContent.includes('Machine Lateral Raises')`),'Exercise rest timer did not start');
  let draft;
  for(let attempt=0;attempt<100;attempt++){
    draft=(await api('/api/data')).state;
    if(draft.active?.restTimer?.total===90&&draft.active.entries[0].sets[0].done)break;
    await delay(100);
  }
  assert.equal(draft.active?.restTimer?.total,90,'Lateral raise should persist its isolation rest baseline: '+await evaluate(`document.querySelector('.lab-save').textContent`));
  assert.equal(draft.active.entries[0].sets[0].done,true,'Checked set did not persist in draft');
  assert.equal((await api('/api/dashboard')).stats.working_sets,before.working_sets,'Unfinished draft leaked into completed analytics');
  await send('Page.reload');await delay(1000);
  assert(await evaluate(`document.querySelector('.setrow [role="checkbox"]').getAttribute('aria-checked')==='true'`),'Reload did not resume checked sets');
  assert(await evaluate(`!!document.querySelector('#timer')`),'Rest timer did not resume after reload');
  assert(await evaluate(`document.documentElement.scrollWidth<=390`),'Mobile workout horizontal overflow');
  await screenshot('tracker-active');
  const remote=await api('/api/data');remote.state.active.entries[0].sets[1].r=11;await api('/api/data',{method:'PUT',body:JSON.stringify(remote)});
  await evaluate(`document.querySelectorAll('.setrow [role="checkbox"]')[1].click()`);await delay(800);
  for(let i=0;i<80;i++){if(await evaluate(`!!document.querySelector('.lab-save-error')`))break;await delay(100)}
  assert(await evaluate(`document.querySelector('.lab-save-error')?.textContent.includes('Load Mac version')`),'Stale save was not surfaced');
  assert.equal((await api('/api/data')).state.active.entries[0].sets[1].done,false,'Stale draft overwrote Mac state');
  const reload=evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Load Mac version').click()`);
  await delay(100);await send('Page.handleJavaScriptDialog',{accept:true});await reload;await delay(500);
  assert(await evaluate(`document.querySelectorAll('.setrow [role="checkbox"]')[1].getAttribute('aria-checked')==='false'`),'Loading the saved Mac copy did not recover from the conflict');

  await evaluate(`document.querySelector('[aria-label="Finish"]').click()`);await delay(150);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Finish workout').click()`);await delay(800);
  for(let attempt=0;attempt<40;attempt++){if((await api('/api/data')).state.workouts.length===originalState.workouts.length+1)break;await delay(100)}
  assert.equal((await api('/api/data')).state.workouts.length,originalState.workouts.length+1,'Finished session was not saved: '+await evaluate(`document.querySelector('.lab-save').textContent`));
  assert.equal((await api('/api/data')).state.workouts.at(-1).entries[0].n,'Machine Lateral Raises','Completed exercises must retain their human names');
  const after=(await api('/api/dashboard')).stats;
  assert.equal(after.working_sets,before.working_sets+1,'Unchecked sets entered completed totals');
  assert.equal(after.tonnage_kg,before.tonnage_kg+77*12,'Completed load/reps were not mapped correctly');
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Nice!').click()`);await delay(150);
  await evaluate(`[...document.querySelectorAll('.lab-links button')].find(b=>b.textContent==='Coach').click()`);await delay(800);
  assert(await evaluate(`!document.querySelector('iframe') && document.querySelector('#coach-connection-message')?.textContent.includes('Demo mode')`),'Native coach failed to load');
  assert(await evaluate(`!!document.querySelector('#subscription-coach')`),'Subscription coach setup must replace the API key form');
  await evaluate(`[...document.querySelectorAll('.lab-links button')].find(b=>b.textContent==='Nutrition').click()`);await delay(800);
  assert(await evaluate(`!document.querySelector('iframe') && document.querySelector('#diary-add')!==null`),'Native food diary failed to load');
  assert(await evaluate(`document.documentElement.scrollWidth<=390`),'Native pages overflow mobile width');
  assert.deepEqual(errors,[],'Browser runtime errors');
  console.log('OpenGym browser QA passed: five templates, all exercises at once, out-of-order completion, kg loads, mobile layout, checked-set persistence, reload recovery, draft exclusion, completion-to-analytics mapping, conflict recovery, and native coach/nutrition.');
  console.log('Screenshots: var/qa/tracker-{desktop,iphone,active}.png');
} finally {
  if(originalState){const latest=await api('/api/data');await api('/api/data',{method:'PUT',body:JSON.stringify({state:originalState,revision:latest.revision})});}
  if(ws)ws.close();browser.kill('SIGTERM');await delay(600);await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
