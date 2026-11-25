import {describe,it,expect} from 'vitest'
import {focusSuggestion,createGuidedBlock,reconcileGuidance,reviewEvidence,decorateGuidedWorkout,guidedComparison,focusExerciseId,phaseLabel} from './guided-progression.js'

const state=()=>({unit:'kg',effort:'rir',techniqueGate:true,workouts:[],customEx:[
 {id:'db',n:'Incline Dumbbell Press',eq:'dumbbell',aestheticTarget:'Upper Chest'},
 {id:'db-other',n:'Incline DB Press',eq:'dumbbell',aestheticTarget:'Upper Chest'},
 {id:'smith',n:'Incline Smith Press',eq:'smith machine',aestheticTarget:'Upper Chest'},
 {id:'machine',n:'Machine Incline Press',eq:'machine',aestheticTarget:'Upper Chest'}],
 routines:[{id:'push',ex:[{id:'db',sets:2,reps:8,weight:30,mode:'reps'},{id:'smith',sets:2,reps:8,weight:20,mode:'reps'}]}],bodyweight:[],exWeights:{},ipContext:{phase:'Lean surplus'}})
const session=(id,exercise,w=30,r=8,rir=2,at=100)=>({id,name:'Normal workout',start:at,end:at+1,d:new Date(at).toISOString().slice(0,10),routineId:'push',entries:[{id:exercise,target:{mode:'reps'},sets:[{done:true,w,r,rir},{done:true,w,r,rir}]}]})
const block=s=>createGuidedBlock(s,'upper-chest',{id:'focus',now:10})
function add(s,b,{reps=8,weight=30,rir=2,deload=false,at}={}){
 const n=s.workouts.length,w=session('session-'+n,focusExerciseId(b),weight,reps,rir,at??100+n*100)
 if(deload)w.deload=true
 s.workouts.push(w);reconcileGuidance(s);return w
}

describe('automatic focus planning and progression',()=>{
 it('selects three related variations using routine familiarity and shared history',()=>{
  const s=state();s.workouts.push(session('old','db-other',38,9,2,1))
  const suggestion=focusSuggestion(s,'upper-chest')
  expect(suggestion.anchor.id).toBe('db');expect(new Set([suggestion.anchor.id,suggestion.reinforce.id,suggestion.transfer.id]).size).toBe(3)
  expect(suggestion.reason).toContain('no specific weakness')
 })
 it('supports the three offered aesthetic goals with the local catalogue',()=>{
  for(const goal of ['upper-chest','shoulder-width','back-width'])expect(focusSuggestion(state(),goal).error).toBeUndefined()
 })
 it('one choice creates a complete plan without altering routines or the technique gate',()=>{
  const s=state(),before=structuredClone(s);const b=block(s)
  expect(b.guided).toBe(1);expect(b.stage).toBe('anchor');expect(s.routines).toEqual(before.routines);expect(s.techniqueGate).toBe(true)
  expect(createGuidedBlock(s,'upper-chest').id).toBe(b.id)
 })
 it('chooses a main lift from the current plan even when an older outside lift has more history',()=>{
  const s=state();for(let i=0;i<12;i++)s.workouts.push(session('old-machine-'+i,'machine',40,8,2,i))
  expect(['db','smith']).toContain(focusSuggestion(s,'upper-chest').anchor.id)
 })
 it('does not change a workout that was already underway when the focus was selected',()=>{
  const s=state();s.active={id:'in-progress',start:1,entries:[{id:'db',target:{mode:'reps'},sets:[{done:false,w:30,r:8}]}]}
  const before=structuredClone(s.active);const b=block(s);b.stage='reinforce'
  expect(decorateGuidedWorkout(s)).toBe(false);expect(s.active).toEqual(before)
 })
 it('starting another goal pauses the earlier focus instead of deleting records',()=>{
  const s=state(),b=block(s);createGuidedBlock(s,'shoulder-width',{id:'delts',now:20})
  expect(b.paused).toBe(true);expect(s.ipBlocks.focus).toBe(b)
 })
 it('counts an ordinary finished workout, including an alias from another routine',()=>{
  const s=state(),b=block(s);s.workouts.push(session('normal','db-other'));reconcileGuidance(s)
  expect(b.exposures.anchor).toEqual(['normal']);expect(s.workouts[0].ipTrial.automatic).toBe(true)
 })
 it('does not count old, unfinished, missing-time or unrelated exercise logs',()=>{
  const s=state(),b=block(s);s.workouts.push(session('old','db',30,8,2,1),session('unrelated','smith'))
  const bad=session('missing-time','db');delete bad.start;s.workouts.push(bad)
  s.active={id:'unfinished',entries:[{id:'db',target:{mode:'reps'},sets:[{done:true,w:30,r:8,rir:2}]}]}
  reconcileGuidance(s);expect(b.exposures.anchor).toEqual([])
 })
 it('rotates after repeated comparable stalls and reviews automatically',()=>{
  const s=state(),b=block(s),plan=structuredClone(s.routines)
  for(let i=0;i<3;i++)add(s,b)
  expect(b.stage).toBe('anchor');add(s,b)
  expect(b.stage).toBe('reinforce');expect(b.events.at(-1).automatic).toBe(true)
  expect(s.routines).toEqual(plan);expect(s.techniqueGate).toBe(true)
 })
 it('keeps a productive lift instead of rotating on a calendar',()=>{
  const s=state(),b=block(s)
  for(let reps=7;reps<=12;reps++)add(s,b,{reps})
  expect(b.stage).toBe('anchor');expect(b.lastDecision.kind).toBe('progressing')
 })
 it('holds rotation when effort is unknown or different, even with flat reps',()=>{
  for(const ratings of [[null,null,null,null],[1,2,1,2]]){
   const s=state(),b=block(s);for(const rir of ratings)add(s,b,{rir})
   expect(b.stage).toBe('anchor')
  }
 })
 it('requires full enough working sessions, excluding warmups',()=>{
  const s=state(),b=block(s)
  for(let i=0;i<5;i++){const w=session('short-'+i,'db',30,8,2,100+i);w.entries[0].sets[1].warmup=true;s.workouts.push(w);reconcileGuidance(s)}
  expect(b.stage).toBe('anchor');expect(b.lastDecision.message).toContain('at least two')
 })
 it('holds on falling performance, explicit deloads and a slow-cut phase',()=>{
  const s=state(),b=block(s);add(s,b);add(s,b,{reps:7});expect(b.lastDecision.kind).toBe('recovery');expect(b.stage).toBe('anchor')
  add(s,b,{deload:true});expect(b.stage).toBe('anchor')
  const cut=state();cut.ipContext.phase='Slow cut';const cb=block(cut)
  for(let i=0;i<5;i++)add(cut,cb)
  expect(cb.stage).toBe('anchor');expect(cb.lastDecision.message).toContain('slow cut')
 })
 it('completed normal workouts progress through support, bridge and two return checks',()=>{
  const s=state(),b=block(s)
  for(let i=0;i<4;i++)add(s,b)
  expect(b.stage).toBe('reinforce')
  for(let i=0;i<4;i++)add(s,b,{weight:20})
  expect(b.stage).toBe('transfer')
  for(let i=0;i<4;i++)add(s,b,{weight:25})
  expect(b.stage).toBe('retest')
  add(s,b,{reps:10});expect(b.stage).toBe('retest')
  add(s,b,{reps:10});expect(b.stage).toBe('complete')
  expect(guidedComparison(s,b)).toMatchObject({kind:'improved',delta:2})
 })
 it('reconciliation is idempotent and survives offline serialization/reload',()=>{
  const s=state(),b=block(s);add(s,b);const reloaded=JSON.parse(JSON.stringify(s)),before=JSON.stringify(reloaded)
  expect(reconcileGuidance(reloaded)).toBe(false);expect(JSON.stringify(reloaded)).toBe(before)
 })
 it('does not re-use a workout belonging to a different explicit block',()=>{
  const s=state(),b=block(s),w=session('other-block','db');w.ipTrial={blockId:'another',stage:'anchor'};s.workouts.push(w);reconcileGuidance(s)
  expect(b.exposures.anchor).toHaveLength(0)
 })
 it('replaces only a session slot and uses the replacement’s own last load',()=>{
  const s=state();s.workouts.push(session('old','db',30,8,2,1),session('own','smith',22,9,2,2));const b=block(s);b.anchorId='db';b.stage='reinforce';b.reinforceId='smith'
  const original=structuredClone(s.routines);s.active={id:'live',entries:[{id:'db-other',target:{sets:2,reps:8,mode:'reps'},sets:[{w:30,r:8,done:false},{w:30,r:8,done:false}]}]}
  expect(decorateGuidedWorkout(s)).toBe(true);expect(s.active.entries[0].id).toBe('smith');expect(s.active.entries[0].sets[0].w).toBe(22)
  expect(s.routines).toEqual(original);expect(s.active.ipTrial.automatic).toBe(true)
 })
 it('requires a chosen starting load for an unfamiliar variation',()=>{
  const s=state(),b=block(s);b.stage='reinforce'
  s.active={id:'live',entries:[{id:'db',target:{mode:'reps'},sets:[{w:38,r:8,done:false},{w:38,r:8,done:false}]}]};decorateGuidedWorkout(s)
  expect(s.active.entries[0].sets[0]).toMatchObject({w:0,loadConfirmed:false})
 })
 it('does not overwrite checked sets or undo a temporary manual swap',()=>{
  const s=state(),b=block(s);b.stage='reinforce'
  s.active={id:'live',entries:[{id:'db',target:{mode:'reps'},sets:[{w:30,r:8,done:true},{w:30,r:8,done:false}]}]};decorateGuidedWorkout(s)
  expect(s.active.entries[0].id).toBe('db');expect(s.active.entries[0].sets[0].done).toBe(true)
  s.active.entries[0].id='machine';expect(decorateGuidedWorkout(s)).toBe(false);expect(s.active.entries[0].id).toBe('machine')
 })
 it('does not duplicate a variation already present in the normal routine',()=>{
  const s=state(),b=block(s);b.stage='reinforce';b.reinforceId='smith'
  s.active={id:'live',entries:[{id:'db',sets:[{done:false,w:30,r:8}],target:{mode:'reps'}},{id:'smith',sets:[{done:false,w:20,r:8}],target:{mode:'reps'}}]}
  decorateGuidedWorkout(s);expect(s.active.entries.filter(e=>e.id==='smith')).toHaveLength(1)
  expect(s.active.entries.reduce((n,e)=>n+e.sets.length,0)).toBe(2)
 })
 it('preserves explicit load choices and never applies an automatic policy increase',()=>{
  const s=state();s.workouts.push(session('old','db',38,8,2,1));const b=block(s)
  s.active={id:'live',entries:[{id:b.anchorId,target:{mode:'reps',prog:'linear'},plan:{kind:'up'},sets:[{w:40,r:8,done:false}]}]}
  decorateGuidedWorkout(s);expect(s.active.entries[0].sets[0].w).toBe(38);expect(s.active.entries[0].plan.kind).toBe('off')
 })
 it('pause preserves history and resume skips sessions logged while paused',()=>{
  const s=state(),b=block(s);b.paused=true;add(s,b);expect(b.exposures.anchor).toHaveLength(0)
  b.paused=false;b.resumeAt=1000;reconcileGuidance(s);expect(b.exposures.anchor).toHaveLength(0)
 })
 it('accepts RPE equivalence without assigning missing effort',()=>{
  const s=state(),b=block(s)
  for(let i=0;i<4;i++){const w=session('rpe-'+i,'db',30,8,2,100+i);for(const set of w.entries[0].sets){delete set.rir;set.rpe=8}s.workouts.push(w);reconcileGuidance(s)}
  expect(b.stage).toBe('reinforce');expect(s.workouts[0].entries[0].sets[0].rir).toBeUndefined()
  expect(phaseLabel('slow_cut')).toBe('Slow cut');expect(phaseLabel(null)).toBe('Unspecified')
 })
})
