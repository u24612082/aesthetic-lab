// End-to-end checks write only to the identified, disposable QA clone.
import {spawn,execFileSync} from 'node:child_process'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'

const base='http://127.0.0.1:8768',workspace='var/ip-guidance-qa'
const manifest=JSON.parse(await readFile(workspace+'/manifest.json','utf8'))
assert.equal((await(await fetch(base+'/api/health')).json()).trial_id,manifest.id,'Refusing to touch another workspace')
const headers={'Authorization':'Bearer '+manifest.token,'Content-Type':'application/json'}
const api=async(path,options={})=>{const r=await fetch(base+path,{...options,headers});assert(r.ok,`${path}: ${r.status}`);return r.json()}
assert.equal((await api('/api/status')).demo,true)
assert.equal(manifest.qa,true,'Refusing to test a user workspace')
const personalDigest=()=>JSON.parse(execFileSync('.venv/bin/python',['-c',`
import hashlib,json,sqlite3
from pathlib import Path
from dotenv import dotenv_values
p=Path(dotenv_values('.env').get('APP_DB') or 'var/aesthetic.sqlite3').expanduser().resolve()
c=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True)
tables=['tracker_state','workouts','exercise_sets','food_logs','nutrition_settings','nutrition_plan','nutrition_days']
print(json.dumps({t:hashlib.sha256(json.dumps(c.execute('SELECT * FROM '+t+' ORDER BY 1').fetchall()).encode()).hexdigest() for t in tables}))
c.close()
`],{encoding:'utf8'}))
const originalPersonal=personalDigest(),originalTrial=(await api('/api/data')).state
const profile=await mkdtemp(join(tmpdir(),'aesthetic-workout-controls-qa-'))
let browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','about:blank'],{stdio:['ignore','ignore','pipe']})
let stderr='';browser.stderr.on('data',data=>{stderr=(stderr+data).slice(-1800)})
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
let ws,send,evaluate
const exceptions=[],journal=`JSON.parse(localStorage.getItem('aesthetic_opengym_device_journal_v1'))`
const until=async(fn,message)=>{const end=Date.now()+55000;while(Date.now()<end){if(await fn())return;await delay(100)}throw Error(message+'; '+await evaluate('location.href+" "+document.body.innerText.slice(-2200)'))}
const click=async(text,selector='button')=>{await evaluate(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Button missing: '+${JSON.stringify(text)});b.click()})()`);await delay(100)}
const input=async(selector,value)=>{await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Input missing');const prototype=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await delay(90)}
const shot=async(name)=>{const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(workspace+'/'+name+'.png',Buffer.from(r.data,'base64'))}
const sourceBefore=new Map((await Promise.all(Object.keys(manifest.protected_files).map(async path=>{try{return [path,createHash('sha256').update(await readFile(path)).digest('hex')]}catch(error){if(error.code==='ENOENT')return null;throw error}}))).filter(Boolean));

async function connect(){
 let port
 for(let i=0;i<150;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break}catch{if(browser.exitCode!==null)break;await delay(100)}}
 assert(port,'Chrome failed to start: '+stderr)
 const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()
 ws=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl)
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
 let id=0;const pending=new Map()
 ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}}
 send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}))})
 evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable')
 await send('Emulation.setDeviceMetricsOverride',{width:402,height:874,deviceScaleFactor:1,mobile:true})
 await send('Emulation.setTimezoneOverride',{timezoneId:'Africa/Johannesburg'})
}
async function closeBrowser(){if(ws)ws.close();if(browser.exitCode===null)await new Promise(resolve=>{browser.once('exit',resolve);browser.kill('SIGTERM')})}
const row=(id,sets)=>({id,target:{mode:'reps'},sets:sets.map(([w,r])=>({w,r,done:true,rir:2}))})
const history=(id,d,entries)=>({id,name:'Synthetic record fixture',d,start:Date.parse(d+'T10:00:00Z'),end:Date.parse(d+'T11:00:00Z'),entries})
try{
 await connect()
 const clean=structuredClone(originalTrial);clean.active=null;clean.ipBlocks={};clean.bodyweight=[];clean.effort='rir';clean.lang='en';clean.week={};clean.dayPlan={};clean.exWeights={}
 clean.customEx.push({id:'controls-a',n:'DB Bench Press',eq:'dumbbell',bp:'chest',tg:'pectorals',sm:[],st:[]},{id:'controls-b',n:'Dumbbell Bench Press',eq:'dumbbells',bp:'chest',tg:'pectorals',sm:[],st:[]},{id:'controls-empty',n:'Unlogged Cable Raise',eq:'cable',bp:'shoulders',tg:'delts',sm:[],st:[]})
 clean.routines=[{id:'controls-routine-a',name:'Controls workout A',prog:'off',ex:[{id:'controls-a',sets:3,reps:10,weight:38,mode:'reps',prog:'off'},{id:'controls-empty',sets:2,reps:12,weight:0,mode:'reps',prog:'off'}]},{id:'controls-routine-b',name:'Controls workout B',prog:'off',ex:[{id:'controls-b',sets:3,reps:10,weight:36,mode:'reps',prog:'off'}]}]
 clean.workouts=[history('controls-heavy','2026-10-01',[row('controls-a',[[38,8]])]),history('controls-reps','2026-10-08',[row('controls-b',[[20,15]])]),history('controls-deload','2026-11-02',[row('controls-b',[[36,9]])])]
 await api('/api/data',{method:'PUT',body:JSON.stringify({state:clean,revision:(await api('/api/data')).revision})})
 await send('Page.navigate',{url:base});await delay(250)
 assert(await evaluate(`fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(manifest.token)}})}).then(r=>r.ok)`))
 await send('Page.reload');await until(()=>evaluate(`document.querySelectorAll('button.item .tt').length>=2`),'Old app did not hydrate')
 await until(()=>evaluate(`!!document.querySelector('[data-workout-offline-ready="true"]')`),'Old shell not prepared')
 const oldBuild=await evaluate(`document.querySelector('meta[name="aesthetic-build"]').content`)
 await send('Network.setBlockedURLs',{urls:['*://127.0.0.1:8768/api/data*']})
 await evaluate(`[...document.querySelectorAll('button.item')].find(b=>b.querySelector('.tt')?.textContent==='Controls workout A').click()`)
 await until(()=>evaluate(`!!document.querySelector('.session-exercise')`),'Old workout did not open')
 await input('.session-exercise .setrow .w input','36,5');await input('.session-exercise .setrow .r input','9')
 await evaluate(`document.querySelector('.session-exercise .setrow [role="checkbox"]').click()`)
 await until(()=>evaluate(`${journal}.state.active.entries[0].sets[0].done&&${journal}.dirty`),'Pending set was not journaled')
 execFileSync('.venv/bin/python',['-c',`from pathlib import Path\nfrom scripts.build_tracker import publish_assets\npublish_assets(Path('opengym/frontend/dist'),Path('var/ip-guidance-qa/app/aesthetic_lab/opengym_static'))`])
 await evaluate(`navigator.serviceWorker.getRegistration('/').then(r=>r.update())`)
 // Exercise the existing Settings update action: an old client can itself
 // contain the missed-notification bug fixed in the new build.
 await evaluate(`location.hash='/settings'`)
 await until(()=>evaluate(`[...document.querySelectorAll('.lrow-t')].some(b=>b.textContent==='Update app')`),'Settings update action missing')
 await evaluate(`[...document.querySelectorAll('button')].find(b=>b.querySelector('.lrow-t')?.textContent==='Update app').click()`)
 // The previous worker can remain installed/waiting because its navigation
 // event waits on an update job. Recover the already-downloaded build with a
 // full process restart; do not remove caches, storage, cookies or the journal.
 const newBuild=JSON.parse(await readFile('opengym/frontend/dist/offline-assets.json','utf8')).version
 await until(()=>evaluate(`(async()=>{const c=await caches.open('aesthetic-opengym-offline-gym-'+${JSON.stringify(newBuild)});return !!(await c.match(location.origin+'/offline-assets.json'))})()`),'New shell was not downloaded')
 await until(()=>evaluate(`!!document.querySelector('[data-workout-offline-ready="true"]')`),'Pending device save not confirmed before recovery')
 await closeBrowser();await rm(join(profile,'DevToolsActivePort'),{force:true})
 browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:['ignore','ignore','pipe']});browser.stderr.on('data',()=>{})
 await connect();await send('Network.setBlockedURLs',{urls:['*://127.0.0.1:8768/api/data*']})
 await send('Page.navigate',{url:base+'/#/workout'})
 await until(()=>evaluate(`document.querySelector('meta[name="aesthetic-build"]')?.content===${JSON.stringify(newBuild)}`),'Downloaded app did not activate after full close/reopen')
 console.log('PASS: older waiting update recovered by close/reopen, with device storage preserved.')
 await evaluate(`location.hash='/workout'`)
 await until(()=>evaluate(`!!document.querySelector('.lab-replace-button')`),'Updated workout did not reopen')
 assert(await evaluate(`${journal}.state.active.entries[0].sets[0].w===36.5&&${journal}.state.active.entries[0].sets[0].r===9&&${journal}.state.active.entries[0].sets[0].done&&${journal}.dirty`),'Upgrade lost the pending workout')
 const originalCard='[data-exercise-index="0"]'
 assert(await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(originalCard+' .lab-replace-button')});const r=b.getBoundingClientRect();return b.textContent==='Replace exercise'&&r.width>250&&r.height>=44})()`),'Replace is not a full-width touch target')
 assert(await evaluate(`document.querySelector(${JSON.stringify(originalCard+' .exercise-record-highlights')}).textContent.includes('All-time max38 kg × 8 reps')`),'Actual paired maximum not visible')
 assert(await evaluate(`document.querySelector(${JSON.stringify(originalCard+' .exercise-record-highlights')}).textContent.includes('15 reps at 20 kg')`),'Rep record is missing or combined with a different load')
 assert(await evaluate(`!document.querySelector(${JSON.stringify(originalCard+' .exercise-record-highlights')}).closest('details')`),'Records are still hidden in a collapsed panel')
 assert(await evaluate(`document.querySelector('[data-exercise-index="1"] [data-record-highlights]').textContent.includes('No logged sets yet')`),'New exercises have no visible records placeholder')
 await shot('workout-controls-updated-iphone')
 await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0})
 await evaluate(`document.querySelector('.lab-replace-button').click()`)
 await until(()=>evaluate(`!!document.querySelector('.sheet .search input')`),'Offline replacement picker missing')
 await input('.sheet .search input','dumbbell lateral raise')
 await evaluate(`[...document.querySelectorAll('.sheet .list .item')].find(b=>b.querySelector('.tt')?.textContent.trim().toLowerCase()==='dumbbell lateral raise').click()`)
 await until(()=>evaluate(`[...document.querySelectorAll('.sheet button')].some(b=>b.textContent==='Swap for this workout')`),'Replacement confirmation missing')
 await input('.sheet .cfgrow .stp-w:nth-child(3) input','15')
 await click('Swap for this workout','.sheet button')
 await until(()=>evaluate(`${journal}.state.active.entries[1].id==='0334'`),'Replacement not saved offline')
 assert(await evaluate(`document.querySelector('[data-exercise-index="0"] .lab-replace-button').disabled&&document.querySelector('[data-exercise-index="0"] .lab-replace-button').textContent==='Replaced for this workout'`),'Original card loses the replacement control status')
 assert(await evaluate(`!document.querySelector('[data-exercise-index="1"] .lab-replace-button').disabled`),'Replacement card has no working replacement button')
 await input('[data-exercise-index="1"] .setrow .w input','15');await input('[data-exercise-index="1"] .setrow .r input','12')
 await evaluate(`document.querySelector('[data-exercise-index="1"] .setrow [role="checkbox"]').click()`)
 await until(()=>evaluate(`document.querySelector('[data-exercise-index="1"] [data-record-highlights]').textContent.includes('15 kg × 12 reps')`),'Live replacement records did not appear')
 assert.deepEqual(await evaluate(`${journal}.state.routines`),clean.routines)
 await until(()=>evaluate(`!!document.querySelector('[data-workout-offline-ready="true"]')`),'Phone save not confirmed')
 await closeBrowser();await rm(join(profile,'DevToolsActivePort'),{force:true})
 browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:['ignore','ignore','pipe']});browser.stderr.on('data',()=>{})
 await connect();await send('Network.clearBrowserCache');await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0})
 await send('Page.navigate',{url:base+'/#/workout'})
 await until(()=>evaluate(`document.querySelectorAll('.lab-replace-button').length===3`),'Cold offline launch lost replacement controls')
 assert(await evaluate(`${journal}.state.active.entries[0].sets[0].w===36.5&&${journal}.state.active.entries[1].sets[0].w===15&&${journal}.state.active.entries[1].sets[0].r===12&&${journal}.state.active.entries[1].sets[0].done`),'Offline restart lost logged sets')
 assert(await evaluate(`document.querySelector('[data-exercise-index="0"] [data-record-highlights]').textContent.includes('38 kg × 8 reps')`),'All-time record disappeared after offline restart')
 assert(await evaluate(`document.documentElement.scrollWidth<=402`),'Phone workout overflows')
 await shot('workout-controls-offline-iphone')
 // A subsequent update from the repaired worker must activate directly,
 // without a process restart, and preserve the still-unsynced workout.
 await send('Network.setBlockedURLs',{urls:['*://127.0.0.1:8768/api/data*']})
 await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1})
 execFileSync('.venv/bin/python',['-c',`import json,shutil
from pathlib import Path
from scripts.build_tracker import publish_assets
p=Path('var/ip-guidance-qa/next-shell')
shutil.copytree('opengym/frontend/dist',p,dirs_exist_ok=True)
m=json.loads((p/'offline-assets.json').read_text());old=m['version'];m['version']=old+'-qa-next'
(p/'offline-assets.json').write_text(json.dumps(m))
for name in ['index.html','sw.js']:
 f=p/name;f.write_text(f.read_text().replace(old,m['version']))
publish_assets(p,Path('var/ip-guidance-qa/app/aesthetic_lab/opengym_static'))`])
 await evaluate(`window.dispatchEvent(new Event('online'));location.hash='/settings'`)
 await until(()=>evaluate(`[...document.querySelectorAll('.lrow-t')].some(b=>b.textContent==='Update app')`),'Updated Settings action missing')
 await evaluate(`[...document.querySelectorAll('button')].find(b=>b.querySelector('.lrow-t')?.textContent==='Update app').click()`)
 await until(()=>evaluate(`document.querySelector('meta[name="aesthetic-build"]')?.content===${JSON.stringify(newBuild+'-qa-next')}`),'Repaired worker did not apply the next update directly')
 await evaluate(`location.hash='/workout'`)
 await until(()=>evaluate(`document.querySelectorAll('.lab-replace-button').length===3`),'Next update lost replacement controls')
 assert(await evaluate(`${journal}.dirty&&${journal}.state.active.entries[0].sets[0].w===36.5&&${journal}.state.active.entries[1].sets[0].w===15&&${journal}.state.active.entries[1].sets[0].r===12&&${journal}.state.active.entries[1].sets[0].done`),'Follow-up update lost the unsynced workout')
 console.log('PASS: the repaired worker applies a subsequent update directly and preserves unsynced sets.')
 await send('Network.setBlockedURLs',{urls:[]})
 await evaluate(`window.dispatchEvent(new Event('online'))`)
 await until(()=>evaluate(`${journal}?.dirty===false`),'Pending session failed to sync after upgrade and offline restart')
 const saved=(await api('/api/data')).state
 assert.deepEqual(saved.routines,clean.routines)
 assert.equal(saved.active.entries[0].sets[0].w,36.5);assert.equal(saved.active.entries[1].sets[0].w,15)
 assert.equal(exceptions.length,0,exceptions.join('\n'))
 console.log('PASS: cached app upgrade preserves unsynced sets; full-width Replace on every exercise; visible all-time max and rep records; offline replacement; cold offline restart and sync; saved routines unchanged.')
}finally{
 if(ws)ws.close()
 if(browser.exitCode===null)await new Promise(resolve=>{browser.once('exit',resolve);browser.kill('SIGTERM')})
 await api('/api/data',{method:'PUT',body:JSON.stringify({state:originalTrial,revision:(await api('/api/data')).revision})})
 await rm(profile,{recursive:true,force:true})
 assert.deepEqual(personalDigest(),originalPersonal,'Personal data changed during the trial check; never restore it from a test.')
 for(const [path,digest]of sourceBefore.entries())assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),digest,'Personal application file changed: '+path)
 console.log('PASS: personal application files and training/nutrition data unchanged. Disposable QA records removed from the copy.')
}
