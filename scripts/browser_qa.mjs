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
  assert(await evaluate(`document.querySelector('#stats').children.length===4`),'Stats did not load');
  assert(await evaluate(`!document.querySelector('#demo-banner').hidden`),'Refusing to mutate an unlabelled workspace');
  await mkdir('var/qa',{recursive:true});
  let shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile('var/qa/desktop.png',Buffer.from(shot.data,'base64'));
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(200);
  assert(await evaluate(`document.documentElement.scrollWidth<=390`),'Mobile horizontal overflow');
  shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile('var/qa/iphone.png',Buffer.from(shot.data,'base64'));
  await evaluate(`document.querySelector('[data-view="coach"]').click()`);await delay(150);
  assert(await evaluate(`document.querySelector('#technique-gates').textContent.includes('AWAITING EVIDENCE')`),'Missing scores were not held');
  assert(await evaluate(`document.querySelector('#coach-connection-message').textContent.includes('Demo mode')`),'Coach setup state is missing');
  assert(await evaluate(`document.querySelector('#connect-coach').disabled`),'Demo must not alter the personal API connection');
  await evaluate(`document.querySelector('#generate-audit').click()`);await delay(400);
  assert(await evaluate(`document.querySelector('#coach-report').textContent.includes('Your training exposure review is ready.')`),'Local audit did not update');
  await evaluate(`document.querySelector('[data-view="nutrition"]').click()`);await delay(200);
  const before=await evaluate(`document.querySelectorAll('[data-delete-log]').length`);
  await evaluate(`document.querySelector('#diary-add').click()`);await delay(200);
  await evaluate(`document.querySelector('[data-food-id]').click();document.querySelector('#grams').value='125';document.querySelector('#log-form').requestSubmit()`);await delay(350);
  assert(await evaluate(`!document.querySelector('#food-dialog').open`),'Food dialog did not close after save');
  const after=await evaluate(`document.querySelectorAll('[data-delete-log]').length`);
  assert.equal(after,before+1,'Food write did not appear in diary');
  // Restore demo data to its original state.
  await evaluate(`document.querySelector('[data-delete-log]').click()`);await delay(250);
  assert.equal(await evaluate(`document.querySelectorAll('[data-delete-log]').length`),before);
  await evaluate(`document.querySelector('[data-view="training"]').click();document.querySelector('[data-session]').click()`);await delay(200);
  assert(await evaluate(`document.querySelector('#session-dialog').open && document.querySelectorAll('.set-table tbody tr').length>0`),'Session detail failed');
  assert.deepEqual(errors,[],'Browser runtime errors');
  console.log('Browser QA passed: desktop, iPhone layout, pairing, coach status/local audit refresh, demo credential isolation, technique holds, food save/remove and session details.');
  console.log('Screenshots: var/qa/desktop.png, var/qa/iphone.png');
} finally {
  if(ws)ws.close();browser.kill('SIGTERM');await delay(600);await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
