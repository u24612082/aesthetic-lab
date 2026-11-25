import {describe,it,expect} from 'vitest'
import {buildSets,lastLoadFor,rememberLoad,lastPerformedSet} from './history.js'
import {exerciseRecords} from './exercise-records.js'

// One exercise that sits in two routines with different plans (Day 3 plans 3x7, Day 1 plans 3x9).
const entry=(id,sets)=>({id,target:{mode:'reps'},sets:sets.map(([w,r],i)=>({w,r,done:true,performedAt:i+1}))})
const workout=(id,d,entries)=>({id,d,name:id,start:Date.parse(d+'T10:00:00Z'),end:Date.parse(d+'T11:00:00Z'),entries})
const day3Plan={id:'cable-lat',sets:3,reps:7,weight:30}
const day1Plan={id:'cable-lat',sets:3,reps:9,weight:30}
const base=()=>({unit:'kg',exWeights:{},customEx:[{id:'cable-lat',n:'Cable Lateral Raises',eq:'cable'}],workouts:[],active:null})
// Mirrors doFinishWorkout in sheets.jsx: remember the last performed load, then store the workout.
function finish(s,w){
 w.entries.forEach(e=>{const last=lastPerformedSet(e.sets);if(last)rememberLoad(s,e.id,last.w,{at:last.performedAt||w.end})})
 s.workouts.push(w)
}
const shape=sets=>sets.map(s=>[s.w,s.r])

describe('same exercise on two training days',()=>{
 it('starts the other day from the last logged weight and reps, not that day\'s own plan',()=>{
  const s=base()
  finish(s,workout('d3','2026-11-04',[entry('cable-lat',[[30,7],[30,7],[30,7]])]))
  expect(shape(buildSets(s,day1Plan))).toEqual([[30,7],[30,7],[30,7]])
 })
 it('follows a change made on the other day and goes back and forth',()=>{
  const s=base()
  finish(s,workout('d3','2026-11-04',[entry('cable-lat',[[30,7],[30,7],[30,7]])]))
  finish(s,workout('d1','2026-11-05',[entry('cable-lat',[[32.5,8],[32.5,8],[32.5,6]])]))
  expect(lastLoadFor(s,'cable-lat')).toBe(32.5)
  expect(shape(buildSets(s,day3Plan))).toEqual([[32.5,8],[32.5,8],[32.5,6]])
 })
 it('keeps the all-time best through lighter weeks so the working weight can be resumed',()=>{
  const s=base()
  finish(s,workout('d3','2026-11-04',[entry('cable-lat',[[30,8],[30,7],[30,7]])]))
  finish(s,workout('d1','2026-12-02',[entry('cable-lat',[[20,12],[20,12],[20,12]])]))
  expect(lastLoadFor(s,'cable-lat')).toBe(20)
  expect(shape(buildSets(s,day1Plan))).toEqual([[20,12],[20,12],[20,12]])
  expect(exerciseRecords(s,'cable-lat').heaviest).toMatchObject({w:30,r:8,d:'2026-11-04'})
 })
})
