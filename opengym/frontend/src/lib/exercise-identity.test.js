import {describe,it,expect} from 'vitest'
import {exerciseKey} from './exercise-identity.js'
import {buildSets,lastEntryFor,bestWeightFor,lastLoadFor,rememberLoad} from './history.js'
import {EXDB} from './exercises.js'
import {sessionsFor,nextPrescription} from './progression.js'

function state(){return {unit:'kg',exWeights:{push:{w:38}},customEx:[
 {id:'push',n:'DB Bench Press',eq:'dumbbell'},
 {id:'pull',n:'Dumbbell Bench Press',eq:'dumbbells'},
 {id:'incline',n:'Incline Dumbbell Press',eq:'dumbbell'},
 {id:'barbell',n:'Barbell Bench Press',eq:'barbell'},
 ],workouts:[
 {end:100,d:'2026-01-01',routineId:'push-day',entries:[{id:'push',target:{sets:1,reps:8,mode:'reps'},sets:[{w:38,r:8,done:true}]}]},
 {end:200,d:'2026-01-02',routineId:'pull-day',entries:[{id:'pull',target:{sets:1,reps:8,mode:'reps'},sets:[{w:36,r:8,done:true}]}]},
 ]}}
describe('one exercise history across all routines',()=>{
 it('unifies the supplied program’s Machine Laterals and Machine Lateral Raises names',()=>{
  const s=state();s.customEx.push({id:'day1',n:'Machine Lateral Raises',eq:'Machine'},{id:'day4',n:'Machine Laterals',eq:'machine'})
  expect(exerciseKey(s,'day1')).toBe(exerciseKey(s,'day4'))
 })
 it('uses 36 kg next on both push and pull after a newer 36 kg session, retaining the 38 kg PR',()=>{
  const s=state()
  for(const id of ['push','pull']){
   expect(buildSets(s,{id,sets:3,reps:10,weight:20}).map(set=>set.w)).toEqual([36,36,36])
   expect(bestWeightFor(s,id)).toBe(38)
   expect(lastEntryFor(s,id).d).toBe('2026-01-02')
   expect(sessionsFor(s,id,{})).toHaveLength(2)
  }
 })
 it('shares the standard-library exercise with matching custom names while keeping incline and barbell separate',()=>{
  const s=state(),standard=EXDB.find(ex=>ex.n==='dumbbell bench press')
  expect(exerciseKey(s,'push')).toBe(exerciseKey(s,standard.id))
  expect(lastLoadFor(s,standard.id)).toBe(36)
  expect(exerciseKey(s,'push')).not.toBe(exerciseKey(s,'incline'))
  expect(exerciseKey(s,'push')).not.toBe(exerciseKey(s,'barbell'))
 })
 it('sorts actual session times rather than trusting import or sync array order',()=>{
  const s=state();s.workouts.reverse();expect(lastLoadFor(s,'push')).toBe(36)
 })
 it('remembers the last checked working set, including zero, rather than an unchecked set or warmup',()=>{
  const s=state();s.workouts[1].entries[0].sets=[{w:36,r:8,done:true,performedAt:220},{w:0,r:10,done:true,performedAt:230},{w:40,r:5,done:false},{w:10,r:10,done:true,warmup:true}]
  expect(lastLoadFor(s,'push')).toBe(0)
  expect(buildSets(s,{id:'push',sets:1,reps:8,weight:38})[0].w).toBe(0)
 })
 it('allows an explicitly confirmed working weight to override history and share across IDs',()=>{
  const s=state();rememberLoad(s,'push',34,{confirmed:true,at:300})
  expect(lastLoadFor(s,'pull')).toBe(34)
 })
 it('uses the latest working weight when a progression rule holds the load',()=>{
  const s=state();s.workouts[1].entries[0].sets=[{w:38,r:7,done:true},{w:36,r:7,done:true}]
  expect(nextPrescription(s,{id:'push',sets:2,reps:8,weight:38,prog:'linear'},null)).toMatchObject({kind:'hold',weight:36})
 })
})
