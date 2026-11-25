// End-to-end checks write only to the identified, separately cloned IP trial.
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
const profile=await mkdtemp(join(tmpdir(),'aesthetic-ip-trial-qa-'))
const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','about:blank'],{stdio:['ignore','ignore','pipe']})
let stderr='';browser.stderr.on('data',data=>{stderr=(stderr+data).slice(-1800)})
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
let ws,send,evaluate
const exceptions=[],journal=`JSON.parse(localStorage.getItem('aesthetic_opengym_device_journal_v1'))`
const until=async(fn,message)=>{const end=Date.now()+25000;while(Date.now()<end){if(await fn())return;await delay(100)}throw Error(message+'; '+await evaluate('location.href+" "+document.body.innerText.slice(-2200)'))}
const click=async(text,selector='button')=>{await evaluate(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Button missing: '+${JSON.stringify(text)});b.click()})()`);await delay(100)}
const input=async(selector,value)=>{await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Input missing');const prototype=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await delay(90)}
const shot=async(name)=>{const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(workspace+'/'+name+'.png',Buffer.from(r.data,'base64'))}
try{
 let port
 for(let i=0;i<120;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break}catch{if(browser.exitCode!==null)break;await delay(100)}}
 assert(port,'Chrome failed to start: '+stderr)
 const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()
 ws=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl)
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
 let id=0;const pending=new Map()
 ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);if(message.id){const request=pending.get(message.id);pending.delete(message.id);message.error?request.reject(Error(message.error.message)):request.resolve(message.result)}}
 send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}))})
 evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable')
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:950,deviceScaleFactor:1,mobile:false})
 await send('Emulation.setTimezoneOverride',{timezoneId:'Africa/Johannesburg'})
 const clean=structuredClone(originalTrial);clean.active=null;clean.ipBlocks={};clean.bodyweight=[];clean.effort='rir';clean.ipContext={phase:'Unspecified'}
 await api('/api/data',{method:'PUT',body:JSON.stringify({state:clean,revision:(await api('/api/data')).revision})})
 await send('Page.navigate',{url:base});await delay(300)
 assert(await evaluate(`fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(manifest.token)}})}).then(r=>r.ok)`))
 await send('Page.reload');await until(()=>evaluate(`!!document.querySelector('.lab-top')`),'Authenticated trial did not load')
 await evaluate(`document.querySelector('.ip-trial-banner a').click()`)
 await until(()=>evaluate(`!!document.querySelector('.focus-chooser')`),'One-choice focus setup did not open')
 assert.equal(await evaluate(`document.querySelectorAll('.focus-chooser input,.focus-chooser textarea').length`),0,'Technical setup forms are still required')
 for(const goal of ['shoulder-width','back-width','upper-chest']){
  await evaluate(`document.querySelector('[data-focus-goal="${goal}"]').click()`);await delay(100)
  assert(await evaluate(`!!document.querySelector('.focus-anchor h3')`),'Priority did not generate a related plan')
 }
 await shot('guided-setup-desktop')
 await click('Show a quick preview')
 assert.equal((await api('/api/data')).state.workouts.length,clean.workouts.length,'Preview contaminated history')
 await click('Hide preview');await click('Use this focus')
 await until(()=>evaluate(`!!document.querySelector('.focus-card')`),'Focus did not activate')
 assert.equal(await evaluate(`document.querySelectorAll('.ip-review,.ip-form').length`),0,'Manual stage controls remain in the primary flow')
 const block=await evaluate(`Object.values(${journal}.state.ipBlocks).find(b=>b.guided)`)
 const routine=clean.routines.find(r=>r.ex.some(e=>e.id===block.anchorId));assert(routine,'Suggested focus has no routine slot')
 const openRoutine=async()=>{
  await evaluate(`location.hash='/home'`)
  await until(()=>evaluate(`[...document.querySelectorAll('button.item')].some(b=>b.querySelector('.tt')?.textContent===${JSON.stringify(routine.name)})`),'Normal routine picker did not open')
  await evaluate(`[...document.querySelectorAll('button.item')].find(b=>b.querySelector('.tt')?.textContent===${JSON.stringify(routine.name)}).click()`)
  await until(()=>evaluate(`!!document.querySelector('.session-exercise')`),'Ordinary routine did not start')
 }
 await openRoutine()
 assert.equal(await evaluate(`${journal}.state.active.ipTrial.blockId`),block.id,'Normal workout was not linked automatically')
 await until(()=>evaluate(`!!document.querySelector('[data-workout-offline-ready="true"]')`),'Offline download not ready')
 const entryIndex=await evaluate(`${journal}.state.active.entries.findIndex(e=>e.id===${JSON.stringify(block.anchorId)})`)
 assert(entryIndex>=0)
 const prefix=`[data-exercise-index="${entryIndex}"]`
 const weight=await evaluate(`${journal}.state.active.entries[${entryIndex}].sets[0].w`)
 const reps=await evaluate(`${journal}.state.active.entries[${entryIndex}].sets[0].r`)
 await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0})
 for(const position of [1,2]){
  await input(`${prefix} .setrow:nth-child(${position+1}) .w input`,String(weight))
  await input(`${prefix} .setrow:nth-child(${position+1}) .r input`,String(reps))
  await input(`${prefix} .setrow:nth-child(${position+1}) .eff input`,'2')
  await evaluate(`document.querySelectorAll(${JSON.stringify(prefix+' .setrow [role="checkbox"]')})[${position-1}].click()`)
 }
 await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('Finish workout early')).click()`)
 await until(()=>evaluate(`[...document.querySelectorAll('#modal-root button')].some(b=>b.textContent.trim()==='Finish workout')`),'Finish confirmation missing')
 await click('Finish workout','#modal-root button')
 await until(()=>evaluate(`[...document.querySelectorAll('#modal-root button')].some(b=>b.textContent.trim()==='Nice!')`),'Normal workout failed to save')
 await click('Nice!','#modal-root button')
 await evaluate(`location.hash='/progression-blocks'`)
 await until(()=>evaluate(`${journal}.state.ipBlocks[${JSON.stringify(block.id)}].exposures.anchor.length===1`),'Completed routine was not reviewed automatically')
 assert.equal((await api('/api/data')).state.workouts.length,clean.workouts.length,'Offline log reached server prematurely')
 await send('Page.reload');await until(()=>evaluate(`document.querySelector('.focus-card')?.textContent.includes('1 new sessions')`),'Offline restart lost automatic guidance')
 await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1})
 await evaluate(`window.dispatchEvent(new Event('online'))`)
 await until(()=>evaluate(`${journal}?.dirty===false`),'Guidance failed to sync after reconnect')
 let saved=(await api('/api/data')).state
 assert.deepEqual(saved.routines,clean.routines)
 const baseWorkout=saved.workouts.at(-1),now=Date.now()
 for(let i=1;i<=3;i++){
  const w=structuredClone(baseWorkout);w.id='GUIDANCE-QA-'+i;w.start=now+i*100;w.end=w.start+50
  for(const e of w.entries)for(const set of e.sets)if(set.done){set.w=weight;set.r=reps;set.rir=2}
  saved.workouts.push(w)
 }
 await api('/api/data',{method:'PUT',body:JSON.stringify({state:saved,revision:(await api('/api/data')).revision})})
 await send('Page.reload')
 await until(()=>evaluate(`${journal}.state.ipBlocks[${JSON.stringify(block.id)}].stage==='reinforce'`),'Repeated comparable sessions did not advance automatically')
 await shot('guided-decision-desktop')
 await openRoutine()
 const current=await evaluate(`${journal}.state.active`)
 assert.equal(current.ipTrial.stage,'reinforce')
 assert(current.entries.some(e=>e.id===block.reinforceId),'Support variation was not put into the normal workout')
 assert.deepEqual(await evaluate(`${journal}.state.routines`),clean.routines,'Session overlay modified a routine template')
 const plannedSets=clean.routines.find(r=>r.id===routine.id).ex.reduce((n,e)=>n+Math.max(1,e.sets||1),0)
 assert.equal(current.entries.reduce((n,e)=>n+e.sets.length,0),plannedSets,'Automatic selection changed the planned set budget')
 await evaluate(`document.querySelector('.ip-trial-banner a').click()`)
 await send('Emulation.setDeviceMetricsOverride',{width:402,height:874,deviceScaleFactor:1,mobile:true})
 await evaluate('window.scrollTo(0,0)');await delay(150)
 assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Guided screen overflows phone width')
 await shot('guided-focus-phone-width')
 assert.equal(exceptions.length,0,exceptions.join('\n'))
 console.log('PASS: one-choice setup, all three priorities, normal-routine integration, automatic plateau rotation, per-session exercise replacement, unchanged routine/set budget, offline restart/sync and phone-width layout.')
}finally{
 if(ws)ws.close()
 if(browser.exitCode===null)await new Promise(resolve=>{browser.once('exit',resolve);browser.kill('SIGTERM')})
 await api('/api/data',{method:'PUT',body:JSON.stringify({state:originalTrial,revision:(await api('/api/data')).revision})})
 await rm(profile,{recursive:true,force:true})
 assert.deepEqual(personalDigest(),originalPersonal,'Personal data changed during the trial check; never restore it from a test.')
 for(const [path,digest]of Object.entries(manifest.protected_files))assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),digest,'Personal application file changed: '+path)
 console.log('PASS: personal application files and training/nutrition data unchanged. Trial QA records removed from the copy.')
}
