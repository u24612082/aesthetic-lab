// Three-way merge: independent completed workouts combine; overlapping edits stay local for review.
const same=(a,b)=>{
 if(a===b)return true
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false
 const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]))
}
export class SyncConflict extends Error{}
export function mergeState(base,local,remote){
 const merge=(b,l,r,path)=>{
  if(path==='_ts')return Math.max(l||0,r||0)
  if(same(l,b))return r
  if(same(r,b)||same(l,r))return l
  // This is a default-load cache, not the workout log. Independent sessions
  // keep all sets and let the most recent timestamp supply the next load.
  if(path.startsWith('exWeights.')&&Number.isFinite(l?.at)&&Number.isFinite(r?.at))return l.at>=r.at?l:r
  if(['workouts','routines','customEx','bodyweight'].includes(path)&&[b,l,r].every(Array.isArray)){
   const key=path==='bodyweight'?'d':'id'
   if([b,l,r].some(rows=>rows.some(row=>!row||row[key]==null)||new Set(rows.map(row=>String(row[key]))).size!==rows.length))throw new SyncConflict('Both devices changed '+path+'. Your phone copy is retained.')
   const maps=[b,l,r].map(rows=>new Map(rows.map(row=>[String(row[key]),row])))
   const existingOrder=rows=>rows.map(row=>String(row[key])).filter(id=>maps[0].has(id))
   const bo=existingOrder(b),lo=existingOrder(l),ro=existingOrder(r)
   if(!same(lo,bo)&&!same(ro,bo)&&!same(lo,ro))throw new SyncConflict('Both devices reordered '+path+'. Your phone copy is retained.')
   const order=same(lo,bo)?[...r,...l]:[...l,...r],ids=[...new Set(order.map(row=>String(row[key])))]
   return ids.map(id=>merge(maps[0].get(id),maps[1].get(id),maps[2].get(id),path+'.'+id)).filter(row=>row!==undefined)
  }
  if([b,l,r].every(v=>v&&typeof v==='object'&&!Array.isArray(v))){
   const result={}
   for(const k of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])){
    const v=merge(b[k],l[k],r[k],path?path+'.'+k:k);if(v!==undefined)result[k]=v
   }return result
  }
  throw new SyncConflict('Both devices changed '+(path||'this session')+'. Your phone copy is retained. Review the conflict before replacing either copy.')
 }
 if(!base)throw new SyncConflict('This pending draft predates offline sync. Your phone copy is retained for review.')
 const result=merge(base,local,remote,'')
 const finished=result.active&&(result.workouts||[]).find(workout=>workout.id===result.active.id)
 if(finished){
  // An older open tab may deliver the draft after another device finished it.
  // It must not reopen that session; extra checked sets still require review.
  const covered=result.active.entries.every(entry=>{
   const draft=entry.sets.filter(set=>set.done)
   const logged=finished.entries.find(row=>row.id===entry.id)?.sets.filter(set=>set.done)||[]
   return draft.length<=logged.length&&draft.every((set,index)=>same(set,logged[index]))
  })
  if(!covered)throw new SyncConflict('This session is finished on another device, but its draft has different checked sets. Your phone copy is retained for review.')
  return {...result,active:null}
 }
 return result
}
