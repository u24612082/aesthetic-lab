// End-to-end checks write only to the identified, separately cloned IP trial.
import {spawn,execFileSync} from 'node:child_process'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'

const base='http://127.0.0.1:8767',workspace='var/ip-method-trial'
const manifest=JSON.parse(await readFile(workspace+'/manifest.json','utf8'))
assert.equal((await(await fetch(base+'/api/health')).json()).trial_id,manifest.id,'Refusing to touch another workspace')
const headers={'Authorization':'Bearer '+manifest.token,'Content-Type':'application/json'}
const api=async(path,options={})=>{const r=await fetch(base+path,{...options,headers});assert(r.ok,`${path}: ${r.status}`);return r.json()}
assert.equal((await api('/api/status')).demo,true)
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
 const clean=structuredClone(originalTrial);clean.active=null;clean.ipBlocks={}
 await api('/api/data',{method:'PUT',body:JSON.stringify({state:clean,revision:(await api('/api/data')).revision})})
 await send('Page.navigate',{url:base});await delay(250)
 assert(await evaluate(`fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(manifest.token)}})}).then(r=>r.ok)`))
 await send('Page.navigate',{url:base+'/#/progression-blocks'})
 await send('Page.reload')
 await until(()=>evaluate(`!!document.querySelector('.lab-top')`),'Authenticated trial did not finish loading')
 await evaluate(`document.querySelector('.ip-trial-banner a').click()`)
 await until(()=>evaluate(`!!document.querySelector('.ip-intro')`),'Block planner did not open')
 assert(await evaluate(`!!document.querySelector('.ip-trial-banner')`))
 await click('Show worked example')
 await until(()=>evaluate(`document.querySelector('.ip-example')?.textContent.includes('2 more reps')`),'Worked example is not displaying the paired-set comparison')
 assert.deepEqual((await api('/api/data')).state.workouts,originalTrial.workouts,'Worked example contaminated history')
 await shot('planner-desktop')
 await click('Hide worked example');await click('New progression block')
 const pick=async(label,query,exact)=>{
  const selector=`[aria-label="${label}"]`
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);await input(selector,query)
  await until(()=>evaluate(`[...document.querySelectorAll('.ip-options [role="option"]')].some(b=>b.querySelector('span')?.textContent.toLowerCase()===${JSON.stringify(exact.toLowerCase())})`),'Exercise option missing: '+exact)
  await evaluate(`[...document.querySelectorAll('.ip-options [role="option"]')].find(b=>b.querySelector('span')?.textContent.toLowerCase()===${JSON.stringify(exact.toLowerCase())}).click()`)
 }
 await pick('Anchor exercise','incline dumbbell press','Incline Dumbbell Press')
 await pick('Reinforce variation','incline smith press','Incline Smith Press')
 await pick('Transfer variation','barbell incline bench press','barbell incline bench press')
 await input('.ip-form textarea','QA experiment: explore a hypothesis without inferring a weak muscle.')
 await input('[placeholder^="Bench angle"]','30 degree incline, same bench and dumbbells')
 await click('Create trial block')
 await until(()=>evaluate(`document.querySelectorAll('[data-ip-block]').length===1`),'Block did not save')
 const blockId=await evaluate(`Object.keys(${journal}.state.ipBlocks)[0]`)
 assert.deepEqual(await evaluate(`${journal}.state.routines`),clean.routines)
 await until(()=>evaluate(`!!document.querySelector('[data-workout-offline-ready="true"]')`),'Trial offline cache not ready')
 for(const [stage,reps,next] of [['anchor',7,'reinforce'],['reinforce',8,'transfer'],['transfer',8,'retest'],['retest',9,'complete']]){
  await click('Log '+stage+' workout')
  await until(()=>evaluate(`!!document.querySelector('.session-exercise')`),'Trial workout did not open')
  assert.equal(await evaluate(`${journal}.state.active.ipTrial.stage`),stage)
  if(stage==='anchor')await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0})
  await input('.session-exercise .setrow .w input','30')
  await input('.session-exercise .setrow .r input',String(reps))
  await input('.session-exercise .setrow .eff input','2')
  await evaluate(`document.querySelector('.session-exercise .setrow [role="checkbox"]').click()`)
  await until(()=>evaluate(`${journal}.state.active.entries[0].sets[0].done`),'Working set not saved')
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('Finish workout early')).click()`)
  await until(()=>evaluate(`[...document.querySelectorAll('#modal-root button')].some(b=>b.textContent.trim()==='Finish workout')`),'Finish confirmation did not open')
  await click('Finish workout','#modal-root button')
  await until(()=>evaluate(`[...document.querySelectorAll('#modal-root button')].some(b=>b.textContent.trim()==='Nice!')`),'Workout did not finish')
  await click('Nice!','#modal-root button')
  await evaluate(`location.hash='/progression-blocks'`)
  await until(()=>evaluate(`!!document.querySelector('.ip-review')`),'Tagged completed session missing from stage review')
  if(stage==='anchor'||stage==='retest')await evaluate(`document.querySelector('.ip-review input[type="checkbox"]').click()`)
  await input('.ip-review textarea','QA: completed with observed conditions recorded.')
  await evaluate(`document.querySelector('.ip-review button').click()`)
  await until(()=>evaluate(`${journal}.state.ipBlocks[${JSON.stringify(blockId)}].stage===${JSON.stringify(next)}`),'Stage did not advance: '+stage)
  if(stage==='anchor'){
   assert.equal((await api('/api/data')).state.workouts.length,clean.workouts.length,'Offline workout reached server before sync')
   await send('Page.reload')
   await until(()=>evaluate(`document.querySelector('[data-ip-block] .tag.acc')?.textContent==='Reinforce'`),'Offline reload lost the block stage')
   await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1})
   await evaluate(`window.dispatchEvent(new Event('online'))`)
   await until(()=>evaluate(`${journal}?.dirty===false`),'Trial changes did not sync after reconnect')
  }
 }
 await until(()=>evaluate(`document.querySelector('.ip-block .ip-comparison')?.textContent.includes('2 more reps')`),'Full block did not produce a matched return-test comparison')
 await until(()=>evaluate(`${journal}?.dirty===false`),'Final trial block did not persist')
 const saved=(await api('/api/data')).state
 assert.equal(saved.workouts.length,clean.workouts.length+4)
 assert.equal(saved.ipBlocks[blockId].stage,'complete')
 assert.deepEqual(saved.routines,clean.routines,'IP block changed the routine')
 assert.equal(saved.techniqueGate,clean.techniqueGate)
 await shot('completed-block-desktop')
 await send('Emulation.setDeviceMetricsOverride',{width:402,height:874,deviceScaleFactor:1,mobile:true})
 await evaluate('window.scrollTo(0,0)');await delay(180)
 assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Trial overflows a phone-width screen')
 await shot('planner-mobile-width')
 const login=await fetch(base+'/api/login',{method:'POST',headers,body:JSON.stringify({token:manifest.token})})
 assert(login.headers.get('set-cookie').startsWith('lab_ip_trial_session='),'Trial can overwrite the personal login cookie')
 assert.equal((await fetch(base+'/api/coach/run',{method:'POST',headers,body:'{}'})).status,409,'Trial can launch external coaching')
 assert.equal((await fetch(base+'/api/phone/pairing-code',{method:'POST',headers,body:'{}'})).status,409,'Trial can reconfigure phone pairing')
 assert.equal(exceptions.length,0,exceptions.join('\n'))
 console.log('PASS: worked example, full four-stage logging flow, offline save/reload/reconnect, paired-set comparison, desktop/mobile layout, separate cookie and blocked external connections.')
}finally{
 if(ws)ws.close()
 if(browser.exitCode===null)await new Promise(resolve=>{browser.once('exit',resolve);browser.kill('SIGTERM')})
 await api('/api/data',{method:'PUT',body:JSON.stringify({state:originalTrial,revision:(await api('/api/data')).revision})})
 await rm(profile,{recursive:true,force:true})
 assert.deepEqual(personalDigest(),originalPersonal,'Personal data changed during the trial check; never restore it from a test.')
 for(const [path,digest]of Object.entries(manifest.protected_files))assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),digest,'Personal application file changed: '+path)
 console.log('PASS: personal application files and training/nutrition data unchanged. Trial QA records removed from the copy.')
}
