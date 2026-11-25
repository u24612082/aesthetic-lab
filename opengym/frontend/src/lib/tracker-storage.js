// One durable device journal survives closed browser tabs and iPhone process
// restarts. Per-tab copies still isolate simultaneous edits and retain recovery.
export const JOURNAL='aesthetic_opengym_device_journal_v1'
export const LAST_CLEAN='aesthetic_opengym_last_clean'
const PREFIX='aesthetic_opengym_state_v1_'
const read=(storage,key)=>{try{return JSON.parse(storage.getItem(key))}catch{return null}}
const envelope=value=>value?.format===2&&value.state&&typeof value.state==='object'
export function loadTrackerSnapshot(storage,key,writer,allowRecovery=true){
 const current=read(storage,key),device=read(storage,JOURNAL)
 if(current){
  if(envelope(device)&&device.writer===writer&&(device.writtenAt||0)>=(current.writtenAt||0))return device
  return current
 }
 if(!allowRecovery)return null
 if(envelope(device))return device
 // Migrate existing pending drafts before considering the last Mac copy.
 const pending=[]
 for(let i=0;i<storage.length;i++){
  const k=storage.key(i);if(!k?.startsWith(PREFIX)||k.endsWith('_recovery'))continue
  const value=read(storage,k)
  if(envelope(value)&&value.dirty)pending.push(value)
 }
 pending.sort((a,b)=>(b.state._ts||0)-(a.state._ts||0))
 return pending[0]||read(storage,LAST_CLEAN)
}
export function saveTrackerSnapshot(storage,key,writer,snapshot){
 const previous=read(storage,JOURNAL)
 const saved={...snapshot,writer,writtenAt:Math.max(Date.now(),(previous?.writtenAt||0)+1)}
 // Save an immediate recovery copy; the store confirms durability separately
 // with IndexedDB. Failure of the secondary tab copy must not discard this one.
 const text=JSON.stringify(saved)
 storage.setItem(JOURNAL,text)
 try{storage.setItem(key,text)}catch{}
 return saved
}
