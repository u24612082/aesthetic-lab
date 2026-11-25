import {describe,it,expect} from 'vitest'
import {exerciseRecords} from './exercise-records.js'
import {lastLoadFor} from './history.js'

const entry=(id,sets,extra={})=>({id,target:{mode:'reps'},sets:sets.map(([w,r,flags={}])=>({w,r,done:true,...flags})),...extra})
const workout=(id,d,entries)=>({id,d,name:id,start:Date.parse(d+'T10:00:00Z'),end:Date.parse(d+'T11:00:00Z'),entries})
function state(){return {unit:'kg',exWeights:{},customEx:[{id:'push',n:'DB Bench Press',eq:'dumbbell'},{id:'pull',n:'Dumbbell Bench Press',eq:'dumbbells'},{id:'incline',n:'Incline Dumbbell Press',eq:'dumbbell'}],workouts:[
 workout('heavy','2026-10-01',[entry('push',[[38,6],[38,8],[36,10]])]),
 workout('high-reps','2026-10-08',[entry('pull',[[20,15]])]),
 workout('deload','2026-11-02',[entry('pull',[[30,10],[30,10]])]),
 ],active:null}}
describe('actual exercise records for deload reference',()=>{
 it('keeps weight and reps from the same set rather than combining separate maxima',()=>{
  const records=exerciseRecords(state(),'pull')
  expect(records.heaviest).toMatchObject({w:38,r:8,d:'2026-10-01'})
  expect(records.mostReps).toMatchObject({w:20,r:15,d:'2026-10-08'})
  expect(records.repBests.find(set=>set.w===38).r).toBe(8)
 })
 it('retains the old peak and all its working sets while the latest default follows the deload',()=>{
  const s=state(),before=structuredClone(s),records=exerciseRecords(s,'push')
  expect(lastLoadFor(s,'push')).toBe(30)
  expect(records.heaviest.w).toBe(38)
  expect(records.peakSession.sets.map(set=>[set.w,set.r])).toEqual([[38,6],[38,8],[36,10]])
  expect(records.recent.map(session=>session.id)).toEqual(['deload','high-reps','heavy'])
  expect(s).toEqual(before)
 })
 it('shares records across routines and aliases while separating incline movements',()=>{
  const s=state();s.workouts.push(workout('incline','2026-11-02',[entry('incline',[[100,5]])]))
  expect(exerciseRecords(s,'push').heaviest.w).toBe(38)
  expect(exerciseRecords(s,'pull').heaviest.w).toBe(38)
  expect(exerciseRecords(s,'incline').heaviest.w).toBe(100)
 })
 it('excludes warmups, unchecked sets, invalid values and timed sets from rep records',()=>{
  const s=state();s.workouts.push(workout('noise','2026-11-02',[
   entry('pull',[[200,20,{warmup:true}],[300,30,{done:false}],[null,50],[50,2.5]]),
   entry('pull',[[400,100]],{target:{mode:'time'}}),
  ]))
  expect(exerciseRecords(s,'pull').heaviest).toMatchObject({w:38,r:8})
 })
 it('tracks a new checked live set immediately and keeps past-session references separate',()=>{
  const s=state();s.active=workout('today','2026-11-02',[entry('pull',[[40,5]])])
  const records=exerciseRecords(s,'push')
  expect(records.heaviest).toMatchObject({w:40,r:5,live:true})
  expect(records.peakSession.live).toBe(true)
  expect(records.recent).toHaveLength(3)
 })
 it('labels a load-only entry separately instead of inventing its rep count',()=>{
  const s=state();s.workouts[0].entries[0].topW=50
  const records=exerciseRecords(s,'push')
  expect(records.heaviest).toMatchObject({w:38,r:8})
  expect(records.loadOnly).toMatchObject({w:50})
 })
 it('keeps bodyweight rep records and reports no record when there are no checked sets',()=>{
  const s=state();s.workouts=[workout('bodyweight','2026-11-02',[entry('pull',[[0,15]])])]
  expect(exerciseRecords(s,'pull').heaviest).toMatchObject({w:0,r:15})
  s.workouts=[];expect(exerciseRecords(s,'pull').heaviest).toBeNull()
 })
 it('keeps rep bests through a later lower-rep session and collects repeated matching entries',()=>{
  const s=state();s.workouts.push(workout('later','2026-11-02',[entry('push',[[38,7]]),entry('pull',[[38,6]])]))
  const records=exerciseRecords(s,'pull')
  expect(records.repBests.find(set=>set.w===38).r).toBe(8)
  expect(records.recent[0].sets).toHaveLength(2)
 })
})
