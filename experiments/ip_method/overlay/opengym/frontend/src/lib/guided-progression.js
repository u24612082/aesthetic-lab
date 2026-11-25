// Local experimental guidance. These rules never infer technique scores or approve loads.
import {allExercises,exOr} from './exercises.js'
import {exerciseKey,sameExercise} from './exercise-identity.js'
import {lastLoadFor,workoutTime,modeOf} from './history.js'
import {exerciseRecords} from './exercise-records.js'
import {rirOf} from './effort.js'
import {swapConfig,swapSessionExercise} from './session-swap.js'
import {createBlock} from './progression-blocks.js'

export const FOCUS_GOALS=[
 {id:'upper-chest',label:'Upper chest',target:'Upper Chest',match:/incline.*press|press.*incline/i,exclude:/decline|fly|neck|reverse.grip|close.grip/i},
 {id:'shoulder-width',label:'Shoulder width',target:'Lateral Deltoids',match:/lateral.*raise|cable lateral|machine lateral|lean.away.*lateral/i,exclude:/front|lying|raise.*leg/i},
 {id:'back-width',label:'Back width',target:'Lats',match:/pulldown|pull.down|pull.up|chin.up/i,exclude:/straight.arm|pullover|behind.neck|kipping|muscle.up|assisted/i},
]
export const SIMPLE_STAGES={anchor:'Build your main lift',reinforce:'Train your support lift',transfer:'Bring it together',retest:'Check your progress',complete:'Progress checked'}
export const REVIEW_EXPOSURES=4 // Conservative prototype heuristic, not a validated IP dosage.
const valid=set=>set.done===true&&!set.warmup&&Number.isFinite(set.w)&&set.w>=0&&Number.isInteger(set.r)&&set.r>0
const usableRir=set=>{const r=rirOf(set);return Number.isFinite(r)&&r>=0&&r<=4?r:null}
const sameLoad=(a,b)=>Math.abs(a-b)<0.001
export const focusExerciseId=(block,stage=block.stage)=>stage==='retest'?block.anchorId:block[stage+'Id']
export const phaseLabel=phase=>({lean_gain:'Lean surplus',slow_cut:'Slow cut',maintain:'Maintenance'}[phase]||'Unspecified')
const exercise=(state,id)=>(state.customEx||[]).find(ex=>ex.id===id)||exOr(id)

export function focusSuggestion(state,goalId){
 const goal=FOCUS_GOALS.find(goal=>goal.id===goalId)
 if(!goal)return {error:'Choose an aesthetic priority.'}
 const seen=new Set(),planned=(state.routines||[]).flatMap(r=>r.ex||[])
 const candidates=allExercises(state).filter(ex=>{
  if(!goal.match.test(ex.n)||goal.exclude.test(ex.n))return false
  const key=exerciseKey(state,ex.id);if(seen.has(key))return false;seen.add(key);return true
 }).map(ex=>{
  const records=exerciseRecords(state,ex.id),recent=records.recent[0]
  const inPlan=planned.some(entry=>sameExercise(state,entry.id,ex.id))
  const recentCount=records.recent.filter(row=>row.at>=Date.now()-42*86400000).length
  return {id:ex.id,name:ex.n,equipment:ex.eq||'Unspecified',recent,records,inPlan,
   score:Math.min(recentCount,12)*10+Math.min(records.recent.length,6)+(inPlan?70:0)+(ex.aestheticTarget===goal.target?5:0)}
 }).sort((a,b)=>b.score-a.score||(b.recent?.at||0)-(a.recent?.at||0)||a.name.localeCompare(b.name))
 if(candidates.length<3)return {error:'There are not enough related variations in this library yet.'}
 const anchor=candidates.find(row=>row.inPlan)||candidates[0]
 // Prefer familiar alternatives with a different apparatus. Preserve separate identities.
 const alternatives=candidates.filter(row=>row.id!==anchor.id).sort((a,b)=>
  (b.score+(b.equipment!==anchor.equipment?8:0))-(a.score+(a.equipment!==anchor.equipment?8:0)))
 const reinforce=alternatives[0],transfer=alternatives.find(row=>row.equipment!==reinforce.equipment)||alternatives[1]
 return {goal,anchor,reinforce,transfer,
  reason:`${anchor.name} is selected from your exercise history and routine. The alternatives stay within the same movement family and favour familiar equipment. This is an exploratory variation plan; no specific weakness has been measured.`}
}

export function sampleFor(state,workout,id){
 if(!workout)return null
 const entries=(workout.entries||[]).filter(entry=>modeOf({...entry.target,id:entry.id})==='reps'&&sameExercise(state,id,entry.id,'reps',entry.n))
 const sets=entries.flatMap(entry=>(entry.sets||[]).filter(valid))
 if(!sets.length)return null
 return {workoutId:workout.id,at:workoutTime(workout),d:workout.d,sets,first:sets[0],rir:usableRir(sets[0]),
  deload:!!(workout.deload||workout.ipTrial?.deload),phase:workout.ipTrial?.phase||null,
  rest:entries[0]?.target?.restSec??workout.ipTrial?.protocol?.restSeconds??null}
}

export function guidedSamples(state,block,stage=block.stage){
 const id=focusExerciseId(block,stage)
 const allowed=new Set(block.exposures?.[stage]||[])
 if(stage==='anchor')for(const wid of block.historyIds||[])allowed.add(wid)
 return (state.workouts||[]).filter(w=>allowed.has(w.id)).map(w=>sampleFor(state,w,id)).filter(Boolean).sort((a,b)=>a.at-b.at)
}

export function reviewEvidence(samples){
 const latest=samples.at(-1)
 if(!latest)return {kind:'collecting',count:0,message:'Log your normal working sets. I’ll review them after you finish.'}
 if(latest.deload)return {kind:'recovery',count:0,message:'Lighter session recorded. Keep the focus in place while you recover.'}
 if(latest.sets.length<2)return {kind:'collecting',count:0,message:'I need at least two completed working sets for a session review.'}
 if(latest.rir==null)return {kind:'effort',count:0,message:'Record how many reps you had left (RIR) on the first working set so I can compare effort.'}
 const previous=samples.slice(0,-1).reverse().find(sample=>!sample.deload&&sample.sets.length>=2&&sample.rir!=null)
 if(previous&&(latest.first.w<previous.first.w*.95||(sameLoad(latest.first.w,previous.first.w)&&latest.rir===previous.rir&&latest.first.r<previous.first.r)))
  return {kind:'recovery',count:0,message:'Logged performance dipped. Keep the movement and review recovery before rotating.'}
 const comparable=[]
 for(const sample of [...samples].reverse()){
  if(sample.deload||sample.sets.length<2||sample.rir==null)break
  if(!sameLoad(sample.first.w,latest.first.w)||sample.rir!==latest.rir)break
  if(sample.phase&&latest.phase&&sample.phase!==latest.phase)break
  if(sample.rest!=null&&latest.rest!=null&&sample.rest!==latest.rest)break
  comparable.unshift(sample);if(comparable.length===REVIEW_EXPOSURES)break
 }
 const count=comparable.length
 if(previous&&((sameLoad(latest.first.w,previous.first.w)&&latest.rir===previous.rir&&latest.first.r>previous.first.r)||latest.first.w>previous.first.w))
  return {kind:'progressing',count,message:'Your logged performance is moving up. Keep this lift while it is productive.'}
 if(count===REVIEW_EXPOSURES&&comparable.every(sample=>sample.first.r===latest.first.r))
  return {kind:'plateau',count,message:'Four completed exposures show the same first-set load, reps and reported effort. A variation review is ready.'}
 return {kind:'collecting',count,message:`Keep this lift. ${count} of ${REVIEW_EXPOSURES} comparable exposures collected for a plateau review.`}
}

function recoveryContext(state,phase,at=Date.now()){
 if(phase==='Slow cut')return 'Your current goal is a slow cut. Maintaining performance can be useful; automatic exercise rotation is held.'
 const points=(state.bodyweight||[]).filter(p=>Number.isFinite(p.w)).slice().sort((a,b)=>a.d.localeCompare(b.d))
 const last=points.at(-1);if(!last||Math.abs(at-Date.parse(last.d+'T12:00:00'))>14*86400000)return null
 const end=Date.parse(last.d+'T12:00:00'),recent=points.filter(p=>end-Date.parse(p.d+'T12:00:00')<7*86400000),previous=points.filter(p=>{const age=end-Date.parse(p.d+'T12:00:00');return age>=7*86400000&&age<14*86400000})
 if(recent.length>=3&&previous.length>=3){const mean=rows=>rows.reduce((n,p)=>n+p.w,0)/rows.length;if(mean(recent)<mean(previous)*.995)return 'Recent recorded weight is trending down. Keep the current lift and review your goal and recovery before rotating.'}
 return null
}

export function createGuidedBlock(state,goalId,{now=Date.now(),id=crypto.randomUUID()}={}){
 const existing=Object.values(state.ipBlocks||{}).find(b=>b.guided&&b.focusGoal===goalId&&b.stage!=='complete'&&!b.paused)
 if(existing)return existing
 const suggestion=focusSuggestion(state,goalId);if(suggestion.error)throw Error(suggestion.error)
 for(const block of Object.values(state.ipBlocks||{}))if(block.guided&&block.stage!=='complete')block.paused=true
 const {goal,anchor,reinforce,transfer}=suggestion
 const rest=state.restOverrides?.[anchor.id]||((state.routines||[]).flatMap(r=>r.ex||[]).find(e=>e.id===anchor.id)?.restSec)||(/lateral/i.test(anchor.name)?90:180)
 const block=createBlock(state,{title:goal.label+' focus',goal:goal.target,phase:state.ipContext?.phase||'Unspecified',
  anchorId:anchor.id,reinforceId:reinforce.id,transferId:transfer.id,reason:suggestion.reason,
  setup:'Repeat your usual '+anchor.name+' equipment and setup; setup has not been measured.',rom:'Repeat the same controlled range; range of motion has not been measured.',restSeconds:Math.max(30,Math.min(600,rest))},{now,id})
 Object.assign(block,{guided:1,focusGoal:goalId,paused:false,processed:{},exposures:{anchor:[],reinforce:[],transfer:[],retest:[]},
  historyIds:anchor.records.recent.slice(0,REVIEW_EXPOSURES).map(s=>s.id),
  baselineId:anchor.recent?.id||null,lastDecision:{kind:'created',message:state.active?'Your focus starts with the next workout. Finish your current session as usual.':'Your focus is ready. Start your usual workout; I’ll handle the exercise slots and session reviews.'}})
 return block
}

function moveStage(block,next,workout,message){
 const previous=block.stage;block.stage=next;block.stageStarted=workout.end||workout.start
 block.events.push({stage:next,from:previous,workoutId:workout.id,at:block.stageStarted,automatic:true})
 block.lastDecision={kind:'stage_changed',message,workoutId:workout.id}
}

export function reconcileGuidance(state){
 const blocks=Object.values(state.ipBlocks||{}).filter(b=>b.guided&&b.stage!=='complete')
 if(!blocks.length)return false
 let changed=false
 for(const block of blocks){
  if(block.paused)continue
  block.processed||={};block.exposures||={anchor:[],reinforce:[],transfer:[],retest:[]}
  for(const workout of [...(state.workouts||[])].sort((a,b)=>workoutTime(a)-workoutTime(b))){
   if(block.stage==='complete'||block.processed[workout.id]||!Number.isFinite(Number(workout.start))||Number(workout.start)<Math.max(block.createdAt,block.resumeAt||0))continue
   block.processed[workout.id]=true;changed=true
   if(workout.ipTrial&&workout.ipTrial.blockId!==block.id)continue
   const sample=sampleFor(state,workout,focusExerciseId(block));if(!sample)continue
   block.exposures[block.stage]||=[];block.exposures[block.stage].push(workout.id)
   if(!workout.ipTrial)workout.ipTrial={blockId:block.id,stage:block.stage,phase:state.ipContext?.phase||block.phase,protocol:null,automatic:true}
   if(sample.deload){block.lastDecision={kind:'recovery',message:'Deload recorded. Your focus stays in place.',workoutId:workout.id};continue}
   const evidence=reviewEvidence(guidedSamples(state,block));block.lastDecision={...evidence,workoutId:workout.id}
   if(block.stage==='retest'){
    if(sample.sets.length>=2&&sample.rir!=null){
     block.retestId=workout.id
     if(block.exposures.retest.filter(id=>{const w=state.workouts.find(w=>w.id===id),s=sampleFor(state,w,block.anchorId);return s&&!s.deload&&s.sets.length>=2&&s.rir!=null}).length>=2)
      moveStage(block,'complete',workout,'Your two return sessions are saved. The comparison is ready.')
     else block.lastDecision={kind:'collecting',message:'First return session saved. Repeat the original lift once more to check the result.',workoutId:workout.id}
    }
    continue
   }
   const hold=recoveryContext(state,workout.ipTrial?.phase||state.ipContext?.phase||block.phase,sample.at)
   if(evidence.kind==='plateau'&&hold){block.lastDecision={kind:'recovery',message:hold,workoutId:workout.id};continue}
   if(evidence.kind!=='plateau'||(block.exposures[block.stage]||[]).length<2)continue
   if(block.stage==='anchor'){
    block.baselineId=workout.id
    moveStage(block,'reinforce',workout,'Your main lift has repeated a stable result. The support variation is ready for your next workout.')
   }else if(block.stage==='reinforce')moveStage(block,'transfer',workout,'The support lift has reached a repeated stable result. Next time I’ll use the bridge variation.')
   else if(block.stage==='transfer')moveStage(block,'retest',workout,'The bridge lift has reached a repeated stable result. Next time you’ll return to your original lift to check carryover.')
  }
 }
 return decorateGuidedWorkout(state)||changed
}

export function decorateGuidedWorkout(state){
 const active=state.active;if(!active||active.ipGuidancePrepared)return false
 const block=Object.values(state.ipBlocks||{}).find(b=>b.guided&&!b.paused&&b.stage!=='complete')
 if(!block)return false
 if(Number.isFinite(active.start)&&active.start<block.createdAt)return false
 active.ipGuidancePrepared=true
 if(active.ipTrial&&active.ipTrial.blockId!==block.id)return true
 const wanted=focusExerciseId(block)
 let entry=active.entries.find(e=>sameExercise(state,wanted,e.id,'reps'))
 const index=active.entries.findIndex(e=>sameExercise(state,block.anchorId,e.id,'reps')&&!e.sets.some(s=>s.done)&&!e.swap)
 if(index>=0&&!sameExercise(state,wanted,block.anchorId)){
   const source=active.entries[index],config=swapConfig(state,source,wanted),load=lastLoadFor(state,wanted)
   config.weight=load??0;config.loadUnconfirmed=load==null
   entry=swapSessionExercise(state,index,wanted,config,{workout:active.id,exercise:source.id})
   if(load==null){entry.target.loadUnconfirmed=true;for(const set of entry.sets)if(!set.done)set.loadConfirmed=false}
 }
 if(!entry)return true
 active.ipTrial={blockId:block.id,stage:block.stage,phase:state.ipContext?.phase||block.phase,
  protocol:['anchor','retest'].includes(block.stage)?JSON.parse(JSON.stringify(block.anchorProtocol)):null,automatic:true}
 if(['anchor','retest'].includes(block.stage))entry.target={...entry.target,restSec:block.anchorProtocol.restSeconds}
 const ownLoad=lastLoadFor(state,wanted)
 if(ownLoad!=null&&!entry.sets.some(set=>set.done))for(const set of entry.sets)set.w=ownLoad
 entry.target={...entry.target,prog:'off'};entry.plan={kind:'off',policy:'off'}
 state.effort=state.effort==='rpe'?'rpe':'rir'
 return true
}

export function guidedComparison(state,block){
 const beforeWorkout=(state.workouts||[]).find(w=>w.id===block.baselineId),afterWorkout=(state.workouts||[]).find(w=>w.id===block.retestId)
 const before=beforeWorkout?sampleFor(state,beforeWorkout,block.anchorId):null,after=afterWorkout?sampleFor(state,afterWorkout,block.anchorId):null
 const base={before,after,kind:'waiting',message:'I’ll compare your recorded sets after the return sessions.'}
 if(!before||!after)return base
 if(before.deload||after.deload||before.rir==null||after.rir==null)return {...base,kind:'limited',message:'The sets are saved. Deloads or missing effort prevent a like-for-like comparison.'}
 if(!sameLoad(before.first.w,after.first.w)||before.rir!==after.rir)return {...base,kind:'limited',message:'Load or reported effort changed. Review the saved sets; there is no matched-rep verdict.'}
 if(before.phase&&after.phase&&before.phase!==after.phase)return {...base,kind:'limited',message:'Your recorded goal phase changed. The sets are shown with that context.'}
 const delta=after.first.r-before.first.r
 return {...base,kind:delta>0?'improved':delta<0?'lower':'unchanged',delta,
  message:delta>0?`${delta} more reps recorded at the same load and reported effort.`:delta<0?`${Math.abs(delta)} fewer reps recorded at the same load and reported effort.`:'Your recorded first working set matched the baseline.'}
}

export function guidedStatus(state,block){
 if(block.paused)return {kind:'paused',message:'Focus paused. Keep logging normally; no exercise slots will be changed.'}
 if(block.stage==='complete')return {kind:'complete',message:guidedComparison(state,block).message}
 if(block.lastDecision?.kind==='stage_changed'||block.lastDecision?.kind==='recovery')return block.lastDecision
 const review=reviewEvidence(guidedSamples(state,block))
 if(review.kind==='plateau'&&(block.exposures?.[block.stage]||[]).length<2)return {...review,kind:'collecting',message:'Your past log gives a starting point. I’ll check two fresh sessions before changing a lift.'}
 return review
}
