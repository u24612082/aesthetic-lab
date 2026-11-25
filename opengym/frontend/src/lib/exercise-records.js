import {sameExercise} from './exercise-identity.js'
import {modeOf,workoutTime} from './history.js'

const valid=set=>set.done===true&&!set.warmup&&Number.isFinite(set.w)&&set.w>=0&&Number.isInteger(set.r)&&set.r>0
const heavier=(a,b)=>a.w-b.w||a.r-b.r||a.at-b.at
const moreReps=(a,b)=>a.r-b.r||a.w-b.w||a.at-b.at

// Keep the weight, reps and date from the same actual set. Combining separate
// maxima would invent a performance the athlete never logged.
export function exerciseRecords(state,id){
 const sessions=[],sets=[]
 const workouts=(state.workouts||[]).map(workout=>({workout,live:false}))
 if(state.active&&!workouts.some(row=>row.workout.id===state.active.id))workouts.push({workout:state.active,live:true})
 let loadOnly=null
 for(const [index,{workout,live}] of workouts.entries()){
  const working=[]
  for(const entry of workout.entries||[]){
   if(modeOf({...entry.target,id:entry.id})!=='reps'||!sameExercise(state,id,entry.id,'reps',entry.n))continue
   if(Number.isFinite(entry.topW)&&entry.topW>0&&(!loadOnly||entry.topW>loadOnly.w))loadOnly={w:entry.topW,d:workout.d||null}
   for(const set of entry.sets||[]){
    if(!valid(set))continue
    const record={...set,d:workout.d||null,at:set.performedAt||workoutTime(workout,index),workoutId:workout.id,workoutName:workout.name||'',live}
    working.push(record);sets.push(record)
   }
  }
  if(working.length)sessions.push({id:workout.id,d:workout.d||null,name:workout.name||'',at:Math.max(...working.map(set=>set.at)),sets:working,live})
 }
 const heaviest=sets.reduce((best,set)=>!best||heavier(set,best)>0?set:best,null)
 const mostReps=sets.reduce((best,set)=>!best||moreReps(set,best)>0?set:best,null)
 const perLoad=new Map()
 for(const set of sets){const previous=perLoad.get(set.w);if(!previous||set.r>previous.r||(set.r===previous.r&&set.at>previous.at))perLoad.set(set.w,set)}
 return {
  heaviest,mostReps,
  repBests:[...perLoad.values()].sort((a,b)=>b.w-a.w),
  peakSession:heaviest?sessions.find(session=>session.id===heaviest.workoutId):null,
  recent:sessions.filter(session=>!session.live).sort((a,b)=>b.at-a.at),
  loadOnly:loadOnly&&(!heaviest||loadOnly.w>heaviest.w)?loadOnly:null,
 }
}
