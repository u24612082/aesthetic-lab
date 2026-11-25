// Shared by the tracker and food diary. Credentials are never stored here.
import {rankFoods} from './food-search.js'
import {cacheExerciseImages} from './exercise-image-cache.js'
const DB='aesthetic-phone-v1', listeners=new Set()
let opening, syncing, preparing, preparingImages
const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('aesthetic-phone'):null
function notify(){for(const f of listeners)f()}
if(channel)channel.onmessage=notify
function changed(){notify();channel?.postMessage('changed')}
export function subscribeOffline(fn){listeners.add(fn);return()=>listeners.delete(fn)}
const uid=()=>crypto.randomUUID()
const localId=()=>{const n=crypto.getRandomValues(new Uint32Array(2));return -(n[0]*2097152+(n[1]>>>11)+1)}
const nutrients=['kcal','protein','carbs','fat']
function database(){
 if(!opening)opening=new Promise((resolve,reject)=>{
  const r=indexedDB.open(DB,1)
  r.onupgradeneeded=()=>{for(const name of ['kv','foods','logs','outbox','recovery'])if(!r.result.objectStoreNames.contains(name))r.result.createObjectStore(name,name==='outbox'?{keyPath:'seq',autoIncrement:true}:undefined)}
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Phone storage is unavailable. Your entry has not been saved.'))
 })
 return opening
}
async function read(store,key,all=false){const db=await database();return new Promise((resolve,reject)=>{const r=all?db.transaction(store).objectStore(store).getAll():db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function write(stores,fn,strict=false){const db=await database();return new Promise((resolve,reject)=>{let tx;try{tx=db.transaction(stores,'readwrite',strict?{durability:'strict'}:{})}catch{tx=db.transaction(stores,'readwrite')}tx.oncomplete=resolve;tx.onerror=()=>reject(Error('Could not save on this device. Check available storage before leaving this screen.'));tx.onabort=tx.onerror;try{fn(tx)}catch(e){tx.abort();reject(e)}})}
// A completed strict transaction is the workout's device-save acknowledgement.
// localStorage alone can lose recent writes when a phone/browser process exits.
export async function saveTrackerJournal(snapshot){
 const db=await database()
 return new Promise((resolve,reject)=>{
  let tx;try{tx=db.transaction('kv','readwrite',{durability:'strict'})}catch{tx=db.transaction('kv','readwrite')}
  tx.oncomplete=resolve;tx.onerror=()=>reject(Error('Could not confirm the workout save on this iPhone. Free device storage and try again.'));tx.onabort=tx.onerror
  const store=tx.objectStore('kv'),r=store.get('workout_journal_device')
  r.onsuccess=()=>{
   if(!r.result||(r.result.writtenAt||0)<=(snapshot.writtenAt||0))store.put(snapshot,'workout_journal_device')
   store.put(snapshot,'workout_journal_tab:'+snapshot.writer)
  }
 })
}
export async function readTrackerJournal(writer){
 const [device,own]=await Promise.all([read('kv','workout_journal_device'),read('kv','workout_journal_tab:'+writer)])
 if(device?.signedOut)return device
 if(own&&device?.writer!==writer)return own
 return device||own
}
export async function clearTrackerJournal(){
 await write(['kv'],tx=>{const s=tx.objectStore('kv');s.put({signedOut:true,writtenAt:Date.now()},'workout_journal_device');s.delete('api:/api/me')},true)
}
export async function networkRequest(path,options={}){
 let r
 try{r=await fetch(path,{...options,credentials:'same-origin',headers:{'Content-Type':'application/json',...options.headers},signal:options.signal||AbortSignal.timeout(path.startsWith('/api/foods/discover')||path.startsWith('/api/foods/barcode/')?18000:5000)})}
 catch{const e=Error('Mac unavailable. Saved changes will sync when you reconnect.');e.network=true;throw e}
 const data=await r.json().catch(()=>({}))
 if(!r.ok){const e=Error(typeof data.detail==='string'?data.detail:data.error||'HTTP '+r.status);e.status=r.status;throw e}
 return data
}
async function cache(path,data){await write(['kv'],tx=>tx.objectStore('kv').put({data,at:Date.now()},'api:'+path))}
const foodFields=f=>Object.fromEntries(['name','brand','basis',...nutrients].map(k=>[k,f[k]]))
function apply(state,op,result={}){
 const p=op.payload, fid=id=>state.ids[id]||id
 if(op.kind==='food.create'){
  const id=result.id||p.local_id;if(result.id)state.ids[p.local_id]=result.id
  state.foods.set(id,{...p,id,favorite:false,portions:[],category:'Custom',verified:1,provenance:'User supplied pack label'})
 }else if(op.kind==='food.edit'||op.kind==='food.favorite'){
  const id=fid(p.food_id);state.foods.set(id,{...state.foods.get(id),...p,id,...(op.kind==='food.edit'?{plan_name:p.name,verified:1,provenance:'User supplied pack label'}:{})})
 }else if(op.kind==='log.create'){
  const food=state.foods.get(fid(p.food_id)),basis=op.base||food
  state.logs.set(p.request_id,{...p,id:result.id||op.local_id,food_id:fid(p.food_id),food_name:basis.name,...Object.fromEntries(nutrients.map(k=>[k,basis[k]*p.grams/100]))})
 }else if(op.kind==='log.edit'){
  const current=state.logs.get(p.request_id),old=op.base||current
  if(old)state.logs.set(p.request_id,{...old,...p,id:current?.id??old.id,...Object.fromEntries(nutrients.map(k=>[k,old[k]*p.grams/old.grams]))})
 }else if(op.kind==='log.delete')state.logs.delete(p.request_id)
 else if(op.kind==='targets')state.settings.targets={...p}
 else if(op.kind==='day.complete')state.days[p.local_date]=p.complete
}
async function state(project=true){
 const [foods,logs,settings,ids,days,ops]=await Promise.all([read('foods',null,true),read('logs',null,true),read('kv','settings'),read('kv','ids'),read('kv','nutrition_days'),project?read('outbox',null,true):[]])
 if(!settings)throw Error('Connect to your Mac once and prepare this device for offline logging.')
 const value={foods:new Map(foods.map(f=>[f.id,f])),logs:new Map(logs.map(l=>[l.request_id,l])),settings,ids:ids||{},days:days||{}}
 for(const op of ops)apply(value,op)
 return value
}
export async function prepareOffline(force=false){
 if(preparing)return preparing
 const run=async()=>{
  const last=await read('kv','prepared')
  if(!force&&last&&Date.now()-last<6*60*60*1000&&(await read('kv','catalogue_version'))==='diet-plan-foods-v4')return
  const snapshot=await networkRequest('/api/offline/snapshot',{signal:AbortSignal.timeout(45000)})
  await write(['foods','logs','kv'],tx=>{
   const f=tx.objectStore('foods'),l=tx.objectStore('logs'),k=tx.objectStore('kv');f.clear();l.clear()
   for(const row of snapshot.foods)f.put(row,row.id)
   for(const row of snapshot.logs)l.put(row,row.request_id)
   k.put(snapshot.settings,'settings');k.put(Date.now(),'prepared');k.put('diet-plan-foods-v4','catalogue_version')
   k.put(Object.fromEntries((snapshot.nutrition_days||[]).map(d=>[d.local_date,!!d.complete])),'nutrition_days')
   if(snapshot.nutrition_plan)k.put({data:snapshot.nutrition_plan,at:Date.now()},'api:/api/nutrition/plan')
   if(snapshot.coach_status)k.put({data:snapshot.coach_status,at:Date.now()},'api:/api/coach/status')
   k.put({data:snapshot.dashboard,at:Date.now()},'api:/api/dashboard?days=7')
   k.put({data:snapshot.status,at:Date.now()},'api:/api/status')
  });changed()
 };preparing=(navigator.locks?navigator.locks.request('aesthetic-food-sync',run):run()).then(()=>prepareExerciseImages()).finally(()=>{preparing=null})
 return preparing
}
export async function offlineStatus(){
 const [ops,prepared,lastSync,media]=await Promise.all([read('outbox',null,true),read('kv','prepared'),read('kv','lastSync'),read('kv','exercise_media')])
 return {pending:ops.length,prepared,lastSync,media:media||{ready:false},conflicts:ops.filter(o=>o.error).map(o=>({id:o.id,message:o.error,kind:o.kind}))}
}
export async function prepareExerciseImages(){
 if(preparingImages)return preparingImages
 const run=async()=>cacheExerciseImages({previous:await read('kv','exercise_media')||{},request:networkRequest,
  save:state=>write(['kv'],tx=>tx.objectStore('kv').put(state,'exercise_media')),notify:changed})
 preparingImages=(navigator.locks?navigator.locks.request('aesthetic-exercise-images',{ifAvailable:true},lock=>lock?run():undefined):run()).finally(()=>{preparingImages=null})
 return preparingImages
}
export async function exportPending(){return {version:1,exported_at:new Date().toISOString(),changes:await read('outbox',null,true)}}
export async function keepMacFoodChanges(){
 await prepareOffline(true)
 const ops=await read('outbox',null,true)
 if(!ops.length)return
 await write(['recovery','outbox'],tx=>{tx.objectStore('recovery').put(ops,uid());tx.objectStore('outbox').clear()})
 changed()
}
async function enqueue(op){
 op.id=uid();op.created_at=Date.now()
 await write(['outbox'],tx=>tx.objectStore('outbox').add(op));changed()
 // The durable write completes before the UI reports success. Network delivery is separate.
 void syncOffline().catch(()=>{})
 return {queued:true,id:op.local_id,saved:true}
}
async function refreshDiary(){
 if(!await read('kv','prepared'))return
 const remote=await networkRequest('/api/offline/diary'),local=await read('foods',null,true),favorites=new Set(remote.favorites)
 await write(['foods','logs','kv'],tx=>{
  const logs=tx.objectStore('logs'),foods=tx.objectStore('foods');logs.clear()
  for(const row of remote.logs)logs.put(row,row.request_id)
  for(const row of local)if(!!row.favorite!==favorites.has(row.id))foods.put({...row,favorite:favorites.has(row.id)},row.id)
  for(const row of remote.foods)foods.put(row,row.id)
  tx.objectStore('kv').put(remote.settings,'settings');tx.objectStore('kv').put(Date.now(),'lastSync')
  tx.objectStore('kv').put(Object.fromEntries((remote.nutrition_days||[]).map(d=>[d.local_date,!!d.complete])),'nutrition_days')
 });changed()
}
export async function syncOffline(){
 if(syncing)return syncing
 const run=async()=>{
  for(;;){
   const op=(await read('outbox',null,true))[0];if(!op||op.error)break
   try{
    const result=await networkRequest('/api/offline/changes/'+op.id,{method:'PUT',body:JSON.stringify({kind:op.kind,payload:op.payload,base:op.base||null})})
    const next=await state(false);apply(next,op,result)
    await write(['foods','logs','kv','outbox'],tx=>{
     const p=op.payload,id=next.ids[p.food_id]||p.food_id
     if(op.kind.startsWith('food.')){const f=next.foods.get(result.id||id);tx.objectStore('foods').put(f,f.id)}
     if(op.kind==='log.delete')tx.objectStore('logs').delete(p.request_id)
     if(op.kind==='log.create'||op.kind==='log.edit'){const row=next.logs.get(p.request_id);tx.objectStore('logs').put(row,row.request_id)}
     const kv=tx.objectStore('kv');kv.put(next.ids,'ids');kv.put(next.settings,'settings');kv.put(next.days,'nutrition_days');kv.put(Date.now(),'lastSync');tx.objectStore('outbox').delete(op.seq)
    });changed()
   }catch(e){
    if(e.status&&e.status!==401&&e.status!==429&&e.status<500){op.error=e.message;await write(['outbox'],tx=>tx.objectStore('outbox').put(op));changed()}
    break
   }
  }
  await refreshDiary().catch(()=>{})
 }
 syncing=(navigator.locks?navigator.locks.request('aesthetic-food-sync',{ifAvailable:true},lock=>lock?run():undefined):run()).finally(()=>{syncing=null})
 return syncing
}
export async function diaryFor(day){
 let s;try{s=await state()}catch{await prepareOffline();s=await state()}
 const logs=[...s.logs.values()].filter(l=>l.local_date===day)
 return {logs,totals:Object.fromEntries(nutrients.map(k=>[k,logs.reduce((n,l)=>n+l[k],0)])),settings:s.settings,complete:!!s.days[day]}
}
async function localRead(path){
 const url=new URL(path,location.origin),s=await state()
 if(url.pathname==='/api/nutrition/settings')return {...s.settings,food_count:s.foods.size}
 if(/^\/api\/foods\/-?\d+$/.test(url.pathname)){const id=Number(url.pathname.split('/').at(-1));return s.foods.get(s.ids[id]||id)}
 if(url.pathname==='/api/foods'){
  const view=url.searchParams.get('view'),category=url.searchParams.get('category'),recent=new Map()
  for(const l of s.logs.values())recent.set(l.food_id,Math.max(recent.get(l.food_id)||0,new Date(l.local_date).getTime()))
  return rankFoods([...s.foods.values()],url.searchParams.get('q')||'',view,category,recent)
 }
 throw Error('No downloaded copy is available for this page yet.')
}
export async function offlineRequest(path,options={}){
 const method=options.method||'GET',body=options.body?JSON.parse(options.body):{},url=new URL(path,location.origin),p=url.pathname
 if(method==='GET'&&(p==='/api/nutrition/settings'||p==='/api/foods'||/^\/api\/foods\/-?\d+$/.test(p))){
  try{return await localRead(path)}catch(e){if(await read('kv','prepared'))throw e}
 }
 const isMutation=method!=='GET'&&((p==='/api/food-logs'||/^\/api\/food-logs\/-?\d+$/.test(p))||(p==='/api/foods'||/^\/api\/foods\/-?\d+(\/favorite)?$/.test(p))||p==='/api/nutrition/settings'||p==='/api/nutrition/day')
 if(isMutation){
  let s;try{s=await state()}catch{await prepareOffline();s=await state()}
  const id=Number(p.split('/')[3]),fid=s.ids[id]||id
  if(p==='/api/nutrition/day')return enqueue({kind:'day.complete',payload:body,base:{complete:!!s.days[body.local_date]}})
  if(p==='/api/food-logs'&&method==='POST'){
   const f=s.foods.get(s.ids[body.food_id]||body.food_id)
   if(!f||!(body.grams>0&&body.grams<=10000))throw Error('Choose a food and a weight between 0 and 10,000 g.')
   return enqueue({kind:'log.create',payload:body,base:foodFields(f),local_id:localId()})
  }
  if(p.startsWith('/api/food-logs/')){
   // A queued entry gets a new numeric ID when the Mac acknowledges it.
   // An open editor keeps its stable request ID and the snapshot the user saw.
   const old=options.entryRequestId
    ? [...s.logs.values()].find(l=>l.request_id===options.entryRequestId)||(options.entryBase?.request_id===options.entryRequestId?options.entryBase:null)
    : [...s.logs.values()].find(l=>l.id===id)
   if(!old)throw Error('This food entry is no longer available. Refresh the diary.')
   return enqueue({kind:method==='DELETE'?'log.delete':'log.edit',payload:{...(method==='DELETE'?{}:body),request_id:old.request_id},base:options.entryBase||old})
  }
  if(p==='/api/foods'&&method==='POST'){const lid=localId();return enqueue({kind:'food.create',payload:{...body,local_id:lid},local_id:lid})}
  if(p.startsWith('/api/foods/')){
   const old=s.foods.get(fid);if(!old)throw Error('Food is no longer available.')
   return enqueue({kind:p.endsWith('/favorite')?'food.favorite':'food.edit',payload:{...body,food_id:id},base:p.endsWith('/favorite')?{favorite:!!old.favorite}:foodFields(old),local_id:id})
  }
  return enqueue({kind:'targets',payload:body,base:s.settings.targets})
 }
 if(p==='/api/logout'&&(await offlineStatus()).pending)throw Error('Sync pending food entries before unpairing this device.')
 try{
  const data=await networkRequest(path,options)
  if(method==='GET'&&!['/api/me','/api/phone/pairing-code','/api/source'].includes(p))await cache(path,data)
  if(p.startsWith('/api/foods/barcode/')&&data.id){await write(['foods'],tx=>tx.objectStore('foods').put(data,data.id));changed()}
  if(p==='/api/nutrition/plan'&&method==='PUT'){await cache(path,data);await refreshDiary();changed()}
  return data
 }catch(e){
  if(e.network&&method==='GET'&&p==='/api/foods/discover')return {foods:await localRead('/api/foods?q='+encodeURIComponent(url.searchParams.get('q')||'')),online:false,message:'Mac unavailable. Showing downloaded foods; online brands and barcodes will return when you reconnect.'}
  if(e.network&&method==='GET'&&!['/api/data','/api/me'].includes(p)){const stored=await read('kv','api:'+path);if(stored)return stored.data}
  throw e
 }
}
export function startOfflineSync(){
 const retry=()=>{if(!document.hidden)void syncOffline().catch(()=>{})}
 window.addEventListener('online',retry);window.addEventListener('focus',retry);document.addEventListener('visibilitychange',retry)
 const timer=setInterval(retry,20000);retry()
 return()=>{clearInterval(timer);window.removeEventListener('online',retry);window.removeEventListener('focus',retry);document.removeEventListener('visibilitychange',retry)}
}
