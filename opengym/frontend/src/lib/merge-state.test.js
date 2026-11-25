import {describe,it,expect} from 'vitest'
import {mergeState,SyncConflict} from './merge-state.js'
const base={workouts:[],routines:[],customEx:[],bodyweight:[],active:null,unit:'kg',_ts:1}
describe('offline three-way merge',()=>{
 it('combines independent workouts using the latest shared default load',()=>{
  const b={...base,exWeights:{}}
  const phone={...b,workouts:[{id:'phone'}],exWeights:{bench:{w:38,at:100}}}
  const mac={...b,workouts:[{id:'mac'}],exWeights:{bench:{w:36,at:200}}}
  const merged=mergeState(b,phone,mac)
  expect(merged.workouts).toHaveLength(2);expect(merged.exWeights.bench.w).toBe(36)
 })
 it('keeps a finished session closed when a stale tab delivers its draft',()=>{
  const entry={id:'lift',sets:[{w:15,r:10,done:true},{w:15,r:10,done:false}]}
  const phone={...base,workouts:[{id:'today',entries:[entry]}]},mac={...base,active:{id:'today',entries:[entry]}}
  expect(mergeState(base,phone,mac)).toMatchObject({active:null,workouts:[{id:'today'}]})
 })
 it('retains a conflict if a stale draft contains checked sets absent from the finished log',()=>{
  const first={w:15,r:10,done:true},extra={w:15,r:9,done:true}
  const phone={...base,workouts:[{id:'today',entries:[{id:'lift',sets:[first]}]}]},mac={...base,active:{id:'today',entries:[{id:'lift',sets:[first,extra]}]}}
  expect(()=>mergeState(base,phone,mac)).toThrow(SyncConflict)
 })
 it('keeps independent phone and Mac workouts',()=>{
  const phone={...base,workouts:[{id:'phone',entries:[]}],_ts:2},mac={...base,workouts:[{id:'mac',entries:[]}],_ts:3}
  expect(mergeState(base,phone,mac).workouts.map(w=>w.id)).toEqual(['mac','phone'])
 })
 it('deduplicates retries of the same finished session',()=>{
  const s={...base,workouts:[{id:'same',entries:[]}]};expect(mergeState(base,s,s).workouts).toHaveLength(1)
 })
 it('preserves Mac preferences and phone session changes',()=>{
  const phone={...base,active:{id:'a',entries:[]}},mac={...base,accent:'blue'}
  expect(mergeState(base,phone,mac)).toMatchObject({accent:'blue',active:{id:'a'}})
 })
 it('holds overlapping changes to the same working sets',()=>{
  const b={...base,active:{id:'a',sets:[{w:77,r:12}]}}
  expect(()=>mergeState(b,{...b,active:{id:'a',sets:[{w:78,r:12}]}},{...b,active:{id:'a',sets:[{w:79,r:12}]}})).toThrow(SyncConflict)
 })
 it('holds delete versus edit conflicts',()=>{
  const b={...base,workouts:[{id:'a',name:'Old'}]}
  expect(()=>mergeState(b,{...b,workouts:[]},{...b,workouts:[{id:'a',name:'Edited'}]})).toThrow(SyncConflict)
 })
 it('applies an uncontested deletion while adding a new workout',()=>{
  const b={...base,workouts:[{id:'old'}]};expect(mergeState(b,{...b,workouts:[]},{...b,workouts:[{id:'old'},{id:'new'}]}).workouts).toEqual([{id:'new'}])
 })
 it('rejects merging a legacy draft without its baseline',()=>{expect(()=>mergeState(null,base,base)).toThrow(SyncConflict)})
})
