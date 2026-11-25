import {defaultConfig,lastEntryFor,lastLoadFor,modeOf,buildSets} from './history.js'
import {exOr} from './exercises.js'
import {sameExercise} from './exercise-identity.js'

// Only a session's entries change. A replacement never inherits the old
// machine's load, technique scores, or automatic progression prescription.
export function swapConfig(state,source,id){
 const previous=lastEntryFor(state,id)
 const planned=state.routines.flatMap(r=>r.ex).find(e=>sameExercise(state,e.id,id,modeOf(e)))
 const base={...defaultConfig(id),...(planned||{}),...(previous?.target||{}),id,prog:'off'}
 const last=previous?.sets.filter(s=>s.done).at(-1)
 base.sets=Math.max(1,source.sets.filter(s=>!s.done).length)
 if(last){
  if(modeOf(base)==='reps'){base.weight=lastLoadFor(state,id)??0;base.reps=last.r||base.reps}
  else if(modeOf(base)==='time'){base.weight=last.w??0;base.sec=last.sec||base.sec}
  else {base.min=last.min||base.min;base.speed=last.speed??base.speed}
 }else if(!planned)base.weight=0
 return base
}

export function swapSessionExercise(state,index,id,config,expected){
 const active=state.active,source=active?.entries[index]
 if(!source||active.id!==expected.workout||source.id!==expected.exercise)throw Error('The workout changed. Close this picker and try again.')
 if(id===source.id)throw Error('Choose a different exercise to swap.')
 const existing=active.entries.find((entry,i)=>i!==index&&sameExercise(state,entry.id,id,modeOf({...config,id})))
 const target={...config,id,mode:modeOf({...config,id}),prog:'off'}
 // The confirmation form supplies the replacement's actual targets. Do not
 // override those with history or copy checked sets from the original lift.
 const sets=buildSets({...state,workouts:[],exWeights:{}},target).map(set=>({...set,loadConfirmed:true}))
 const swap={plannedId:source.swap?.plannedId||source.id,plannedName:source.swap?.plannedName||exOr(source.id).n,replacedId:source.id,at:Date.now()}
 const replacement={id,target,sets,sg:source.sg,swap}
 const completed=source.sets.filter(set=>set.done)
 if(existing){
  if(modeOf({...existing.target,id})!==target.mode)throw Error('Keep the existing exercise card’s logging mode when combining sets.')
  existing.sets.push(...sets)
  existing.target={...existing.target,mode:target.mode,sets:existing.sets.length}
  existing.addedSwaps=[...(existing.addedSwaps||[]),{...swap,sets:sets.length}]
  if(completed.length){source.sets=completed;source.endedBySwap=true;delete source.sg}
  else active.entries.splice(index,1)
  active.cur=active.entries.indexOf(existing)
  return existing
 }
 if(completed.length){
  source.sets=completed;source.endedBySwap=true;delete source.sg
  active.entries.splice(index+1,0,replacement);active.cur=index+1
 }else{
  active.entries.splice(index,1,replacement);active.cur=index
 }
 return replacement
}
