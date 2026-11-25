import {describe,it,expect} from 'vitest'
import {swapConfig,swapSessionExercise} from './session-swap.js'
import {sessionsFor} from './progression.js'
import {EXDB} from './exercises.js'

const state=()=>({unit:'kg',workouts:[],exWeights:{},routines:[{id:'day',ex:[{id:'original',sets:3,reps:12,weight:77}]}],
 active:{id:'today',cur:0,entries:[{id:'original',target:{sets:3,reps:12,weight:77},sg:'pair',plan:{kind:'up',weight:80},sets:[
  {w:77,r:12,done:false},{w:77,r:12,done:false},{w:77,r:12,done:false}]}]}})
const expected={workout:'today',exercise:'original'}
const config={sets:3,reps:10,weight:15,mode:'reps'}
describe('temporary workout substitutions',()=>{
 it('records a cardio replacement as cardio so it is not sent to strength analytics as missing reps',()=>{
  const s=state(),id=EXDB.find(ex=>ex.bp==='cardio').id
  const replacement=swapSessionExercise(s,0,id,{sets:1,min:15,speed:6},expected)
  expect(replacement.target.mode).toBe('cardio')
  expect(replacement.sets[0]).toMatchObject({min:15,speed:6,done:false})
 })
 it('replaces an unstarted exercise without editing any saved routine',()=>{
  const s=state(),plan=structuredClone(s.routines)
  const replacement=swapSessionExercise(s,0,'replacement',config,expected)
  expect(s.routines).toEqual(plan);expect(s.active.entries).toHaveLength(1)
  expect(replacement).toMatchObject({id:'replacement',sg:'pair',swap:{plannedId:'original'}})
  expect(replacement.sets).toEqual(Array.from({length:3},()=>({w:15,r:10,done:false,loadConfirmed:true})))
  expect(replacement.plan).toBeUndefined()
 })
 it('retains completed original sets with their technique evidence and starts a separate replacement entry',()=>{
  const s=state();s.active.entries[0].sets[0]={w:77,r:11,done:true,technique:{amplitude:4,force_control:4}}
  swapSessionExercise(s,0,'replacement',{...config,sets:2},expected)
  expect(s.active.entries).toHaveLength(2)
  expect(s.active.entries[0]).toMatchObject({id:'original',endedBySwap:true,sets:[{w:77,r:11,done:true,technique:{amplitude:4,force_control:4}}]})
  expect(s.active.entries[1].sets).toHaveLength(2);expect(s.active.cur).toBe(1)
  expect(s.active.entries[0].sg).toBeUndefined();expect(s.active.entries[1].sg).toBe('pair')
  expect(s.active.entries[1].sets.every(set=>!set.done&&!set.technique)).toBe(true)
 })
 it('uses the replacement’s own history rather than the original machine’s load',()=>{
  const s=state();s.active.entries[0].sets[0].done=true
  s.workouts=[{entries:[{id:'replacement',target:{mode:'reps',sets:4,reps:10,weight:17.5},sets:[{w:17.5,r:9,done:true}]}]}]
  expect(swapConfig(s,s.active.entries[0],'replacement')).toMatchObject({weight:17.5,reps:9,sets:2,prog:'off'})
  expect(swapConfig(s,s.active.entries[0],'unknown').weight).toBe(0)
 })
 it('does not overwrite the confirmed replacement load with an old best load',()=>{
  const s=state();s.exWeights.replacement={w:100}
  const replacement=swapSessionExercise(s,0,'replacement',config,expected)
  expect(replacement.sets[0].w).toBe(15)
 })
 it('rejects a picker left open for a different workout without changing state',()=>{
  const s=state(),before=structuredClone(s)
  expect(()=>swapSessionExercise(s,0,'replacement',config,{...expected,workout:'yesterday'})).toThrow('workout changed')
  expect(s).toEqual(before)
 })
 it('allows a swap to an existing exercise by adding sets to its card without losing checked work',()=>{
  const s=state(),plan=structuredClone(s.routines)
  const checked={w:20,r:8,done:true};s.active.entries.push({id:'replacement',target:{mode:'reps',sets:1},sets:[checked]})
  swapSessionExercise(s,0,'replacement',{...config,sets:2},expected)
  expect(s.active.entries).toHaveLength(1)
  expect(s.active.entries[0].sets).toEqual([checked,{w:15,r:10,done:false,loadConfirmed:true},{w:15,r:10,done:false,loadConfirmed:true}])
  expect(s.active.entries[0].addedSwaps[0]).toMatchObject({plannedId:'original',sets:2})
  expect(s.routines).toEqual(plan)
 })
 it('keeps the planned exercise identity when a replacement is swapped again',()=>{
  const s=state();swapSessionExercise(s,0,'replacement',config,expected)
  swapSessionExercise(s,0,'third',config,{workout:'today',exercise:'replacement'})
  expect(s.active.entries[0].swap).toMatchObject({plannedId:'original',replacedId:'replacement'})
  expect(s.routines[0].ex[0].id).toBe('original')
 })
 it('does not count deliberately swapped partial work as a failed progression session',()=>{
  const s=state();s.active.entries[0].sets[0].done=true
  swapSessionExercise(s,0,'replacement',config,expected)
  s.workouts=[{d:'2026-11-02',entries:s.active.entries}]
  expect(sessionsFor(s,'original',{})).toEqual([])
 })
})
