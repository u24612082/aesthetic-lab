import {describe,it,expect} from 'vitest'
import {JOURNAL,LAST_CLEAN,loadTrackerSnapshot,saveTrackerSnapshot} from './tracker-storage.js'
const memory=()=>{const m=new Map();return {get length(){return m.size},key:i=>[...m.keys()][i],getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}}
const key=tab=>'aesthetic_opengym_state_v1_'+tab
const snapshot=(dirty=true)=>({format:2,state:{routines:[{id:'day1'}],bodyweight:[{d:'2026-11-02',w:81.7}],active:{id:'session',sets:[{w:82.5,r:9,done:true}]},_ts:10},base:{routines:[{id:'day1'}],bodyweight:[],active:null},revision:7,dirty,conflict:false})
describe('durable offline tracker journal',()=>{
 it('recovers the checked lift and weigh-in when a browser restart creates a new tab ID',()=>{
  const s=memory(),saved=snapshot();saveTrackerSnapshot(s,key('old'),'old',saved)
  expect(loadTrackerSnapshot(s,key('new'),'new')).toMatchObject(saved)
 })
 it('keeps a simultaneous tab’s own draft separate',()=>{
  const s=memory(),first=snapshot(),other={...snapshot(),state:{active:{id:'other'}}}
  saveTrackerSnapshot(s,key('a'),'a',first);saveTrackerSnapshot(s,key('b'),'b',other)
  expect(loadTrackerSnapshot(s,key('a'),'a').state.active.id).toBe('session')
 })
 it('does not resurrect an older pending tab after the latest device copy was acknowledged',()=>{
  const s=memory();saveTrackerSnapshot(s,key('a'),'a',snapshot())
  saveTrackerSnapshot(s,key('b'),'b',{...snapshot(false),revision:8})
  expect(loadTrackerSnapshot(s,key('new'),'new')).toMatchObject({dirty:false,revision:8})
 })
 it('migrates a legacy pending copy before falling back to the last Mac snapshot',()=>{
  const s=memory();s.setItem(LAST_CLEAN,JSON.stringify(snapshot(false)));s.setItem(key('closed'),JSON.stringify(snapshot()))
  expect(loadTrackerSnapshot(s,key('new'),'new').dirty).toBe(true)
 })
 it('retains durable recovery even if there is room for only the canonical journal',()=>{
  const s=memory(),set=s.setItem;s.setItem=(k,v)=>{if(k!==JOURNAL)throw Error('quota');set(k,v)}
  expect(()=>saveTrackerSnapshot(s,key('tab'),'tab',snapshot())).not.toThrow()
  expect(loadTrackerSnapshot(s,key('tab'),'tab').state.bodyweight[0].w).toBe(81.7)
 })
 it('does not claim a save when the canonical device write fails',()=>{
  const s=memory();s.setItem=()=>{throw Error('quota')}
  expect(()=>saveTrackerSnapshot(s,key('tab'),'tab',snapshot())).toThrow('quota')
 })
 it('does not recover a saved session after an explicit sign-out',()=>{
  const s=memory();s.setItem(JOURNAL,JSON.stringify(snapshot()))
  expect(loadTrackerSnapshot(s,key('new'),'new',false)).toBeNull()
 })
})
