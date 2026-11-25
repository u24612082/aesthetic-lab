// Read-only startup failure checks against the synthetic demo workspace.
import {spawn} from 'node:child_process'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import assert from 'node:assert/strict'

const base='http://127.0.0.1:8766'
const secret=(await readFile('.env','utf8')).split('\n').find(line=>line.startsWith('APP_TOKEN=')).slice(10)
const api=async path=>{
 const response=await fetch(base+path,{headers:{Authorization:'Bearer '+secret}})
 assert(response.ok);return response.json()
}
assert.equal((await api('/api/status')).demo,true,'Startup QA requires the demo workspace')
const before=(await api('/api/data')).state
const profile=await mkdtemp(join(tmpdir(),'aesthetic-startup-qa-'))
const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'})
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
let ws
try{
 let port
 for(let i=0;i<200;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break}catch{await delay(100)}}
 assert(port,'Chrome did not start')
 const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()
 ws=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl)
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
 let id=0;const pending=new Map(),requests=[]
 const send=(method,params={})=>new Promise((resolve,reject)=>{const request=++id;pending.set(request,{resolve,reject});ws.send(JSON.stringify({id:request,method,params}))})
 ws.onmessage=event=>{
  const message=JSON.parse(event.data)
  if(message.method==='Network.requestWillBeSent')requests.push(message.params.request)
  if(message.method==='Fetch.requestPaused')void send('Fetch.failRequest',{requestId:message.params.requestId,errorReason:'Failed'}).catch(()=>{})
  if(message.id){const request=pending.get(message.id);pending.delete(message.id);message.error?request.reject(Error(message.error.message)):request.resolve(message.result)}
 }
 const evaluate=async expression=>{
  const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})
  assert(!result.exceptionDetails,result.exceptionDetails?.text);return result.result.value
 }
 const until=async(fn,label,timeout=20000)=>{
  const end=Date.now()+timeout
  while(Date.now()<end){if(await fn())return;await delay(100)}
  throw Error(label+': '+await evaluate('document.body.innerText'))
 }
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable')
 await send('Emulation.setDeviceMetricsOverride',{width:402,height:874,deviceScaleFactor:1,mobile:true})
 const journal={format:2,state:{...before,active:null},base:before,revision:7,writer:'test-phone',writtenAt:1,dirty:true}
 const injected=await send('Page.addScriptToEvaluateOnNewDocument',{source:`
  localStorage.setItem('aesthetic_opengym_user',JSON.stringify({id:'local',name:'Demo QA'}));
  localStorage.setItem('aesthetic_opengym_device_journal_v1',${JSON.stringify(JSON.stringify(journal))});
  indexedDB.open=function(){return {}};
 `})
 await send('Page.navigate',{url:base})
 await until(()=>evaluate(`document.body.innerText.includes('Phone storage did not respond')&&!![...document.querySelectorAll('button')].find(b=>b.textContent==='Reload app')`),'Stalled storage left the app blank')
 assert(await evaluate(`document.getElementById('app-startup').hidden`),'Recovery duplicated the initial splash')
 assert(!requests.some(request=>new URL(request.url).pathname==='/api/data'),'Startup fetched over an unread phone journal')
 assert(!requests.some(request=>request.method==='PUT'),'Startup uploaded unread pending data')
 assert(await evaluate(`!!JSON.parse(localStorage.getItem('aesthetic_opengym_device_journal_v1')).dirty`),'Recovery erased the pending journal')
 await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:injected.identifier})
 await send('Network.setBypassServiceWorker',{bypass:true});await send('Network.setCacheDisabled',{cacheDisabled:true})
 await send('Fetch.enable',{patterns:[{urlPattern:base+'/assets/index-*.js',requestStage:'Request'}]})
 await send('Page.reload')
 await until(()=>evaluate(`!!document.getElementById('app-startup-retry')&&!document.getElementById('app-startup-retry').hidden`),'Missing module left a black screen')
 assert(await evaluate(`document.getElementById('app-startup').getAttribute('role')==='alert'`),'Missing module had no visible recovery')
 assert.deepEqual((await api('/api/data')).state,before,'Read-only startup checks changed demo workouts')
 console.log('Startup QA passed: stalled phone storage and failed main script show recovery; pending logs are retained and never overwritten or uploaded before hydration.')
}finally{
 ws?.close()
 if(browser.exitCode===null)await new Promise(resolve=>{browser.once('exit',resolve);browser.kill('SIGTERM')})
 await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100})
}
