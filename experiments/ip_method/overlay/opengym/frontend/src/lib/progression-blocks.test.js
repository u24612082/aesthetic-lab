import {describe,it,expect} from 'vitest'
import {createBlock,beginBlockWorkout,advanceBlock,blockSessions,compareAnchor,workedExample} from './progression-blocks.js'

const makeState=()=>({unit:'kg',techniqueGate:true,workouts:[],routines:[{id:'original',ex:[{id:'a',sets:3,reps:8,weight:30}]}],bodyweight:[],customEx:[
 {id:'a',n:'Incline Dumbbell Press',eq:'dumbbell'},{id:'a-other-day',n:'Incline DB Press',eq:'dumbbell'},
 {id:'b',n:'Incline Smith Press',eq:'smith machine'},{id:'c',n:'Machine Incline Press',eq:'machine'}]})
const input={title:'Upper chest',goal:'Upper Chest',phase:'Lean surplus',anchorId:'a',reinforceId:'b',transferId:'c',reason:'Test an explicitly stated hypothesis.',setup:'30 degree incline, same bench',rom:'Controlled full ROM',restSeconds:180}
const makeBlock=state=>createBlock(state,input,{id:'block',now:1})
function finish(state,block,stage,weight=30,reps=8){
 block.stage=stage
 const active=beginBlockWorkout(state,block.id,{id:stage+'-session',now:10000+stage.length})
 active.entries[0].sets[0]={done:true,w:weight,r:reps,rir:2}
 const finished={...structuredClone(active),end:20000+stage.length}
 state.workouts.push(finished);state.active=null
 return finished
}

describe('isolated IP progression blocks',()=>{
 it('creates a block without rewriting the routine, weights or technique gate',()=>{
  const state=makeState(),before=structuredClone(state);makeBlock(state)
  expect({...state,ipBlocks:undefined}).toEqual({...before,ipBlocks:undefined})
  expect(state.ipBlocks.block.stage).toBe('anchor')
 })
 it('rejects duplicate aliases, including across different routine IDs',()=>{
  expect(()=>createBlock(makeState(),{...input,reinforceId:'a-other-day'})).toThrow('distinct')
 })
 it('requires a reason, reproducible setup and bounded rest',()=>{
  for(const changes of [{reason:''},{setup:''},{restSeconds:0},{restSeconds:601},{restSeconds:90.5}])expect(()=>createBlock(makeState(),{...input,...changes})).toThrow()
 })
 it('uses the variation’s own load history and leaves the original routine intact',()=>{
  const state=makeState(),block=makeBlock(state),plan=structuredClone(state.routines)
  state.workouts=[{id:'other-day',d:'2026-10-01',end:100,entries:[{id:'b',target:{mode:'reps'},sets:[{done:true,w:22,r:10}]}]}]
  block.stage='reinforce';const active=beginBlockWorkout(state,block.id)
  expect(active.entries[0].sets[0].w).toBe(22)
  expect(active.entries[0].target.prog).toBe('off')
  expect(state.routines).toEqual(plan)
 })
 it('never copies the anchor’s weight to an unfamiliar variation',()=>{
  const state=makeState(),block=makeBlock(state);block.stage='reinforce'
  expect(beginBlockWorkout(state,block.id).entries[0].sets[0].w).toBe(0)
 })
 it('refuses to overwrite an active workout',()=>{
  const state=makeState();makeBlock(state);state.active={id:'already-active'}
  expect(()=>beginBlockWorkout(state,'block')).toThrow('Finish or discard')
  expect(state.active.id).toBe('already-active')
 })
 it('counts only finished, tagged sessions with real working sets for that stage',()=>{
  const state=makeState(),block=makeBlock(state);finish(state,block,'anchor')
  const ordinary=structuredClone(state.workouts[0]);delete ordinary.ipTrial;state.workouts.push(ordinary)
  const swapped=structuredClone(state.workouts[0]);swapped.entries[0].id='b';state.workouts.push(swapped)
  expect(blockSessions(state,block)).toHaveLength(1)
 })
 it('does not advance without a session or anchor-condition confirmation',()=>{
  const state=makeState(),block=makeBlock(state)
  expect(()=>advanceBlock(state,block.id,{})).toThrow('Complete a workout')
  finish(state,block,'anchor')
  expect(()=>advanceBlock(state,block.id,{})).toThrow('Confirm')
  expect(block.stage).toBe('anchor')
 })
 it('keeps deloads in the log without letting them establish the baseline',()=>{
  const state=makeState(),block=makeBlock(state);finish(state,block,'anchor')
  expect(()=>advanceBlock(state,block.id,{conditionsConfirmed:true,deload:true})).toThrow('deload')
  expect(state.workouts).toHaveLength(1);expect(block.stage).toBe('anchor')
 })
 it('runs the four stages without edits to the split or automatic weight progression',()=>{
  const state=makeState(),block=makeBlock(state),plan=structuredClone(state.routines)
  for(const stage of ['anchor','reinforce','transfer','retest']){finish(state,block,stage,30,stage==='retest'?10:8);advanceBlock(state,block.id,{conditionsConfirmed:true})}
  expect(block.stage).toBe('complete');expect(state.routines).toEqual(plan)
  expect(compareAnchor(state,block)).toMatchObject({kind:'improved',delta:2})
 })
 it('uses actual paired sets, excludes warmups, and compares the first working sets',()=>{
  const {state,block}=workedExample();state.workouts[0].entries[0].sets.unshift({done:true,w:99,r:1,rir:2,warmup:true})
  const result=compareAnchor(state,block)
  expect(result).toMatchObject({kind:'improved',delta:2})
  expect(result.before[0]).toMatchObject({w:30,r:7})
 })
 it('withholds a verdict when RIR is missing, different, or out of range',()=>{
  for(const effort of [undefined,0,8]){
   const {state,block}=workedExample();state.workouts[1].entries[0].sets[0].rir=effort
   expect(compareAnchor(state,block).kind).toBe('insufficient')
  }
 })
 it('accepts equivalent RPE as reported effort without fabricating a rating',()=>{
  const {state,block}=workedExample(),set=state.workouts[1].entries[0].sets[0];delete set.rir;set.rpe=8
  expect(compareAnchor(state,block).kind).toBe('improved')
 })
 it('does not judge transfer across different loads, protocols, nutrition phases or deloads',()=>{
  for(const change of [w=>{w.entries[0].sets[0].w=32},w=>{w.ipTrial.protocol={...w.ipTrial.protocol,restSeconds:240}},w=>{w.ipTrial.phase='Slow cut'},w=>{w.deload=true}]){
   const {state,block}=workedExample();change(state.workouts[1]);expect(compareAnchor(state,block).kind).toBe('insufficient')
  }
 })
 it('can report unchanged or lower matched performance without diagnosing fatigue',()=>{
  for(const [r,kind] of [[7,'unchanged'],[6,'lower']]){const {state,block}=workedExample();state.workouts[1].entries[0].sets[0].r=r;expect(compareAnchor(state,block).kind).toBe(kind)}
 })
 it('keeps block data and tagged sessions intact in a save/reload serialization',()=>{
  const state=makeState(),block=makeBlock(state);finish(state,block,'anchor');advanceBlock(state,block.id,{conditionsConfirmed:true})
  const restored=JSON.parse(JSON.stringify(state));expect(restored.ipBlocks.block.baselineId).toBe('anchor-session');expect(blockSessions(restored,restored.ipBlocks.block,'anchor')).toHaveLength(1)
 })
})
