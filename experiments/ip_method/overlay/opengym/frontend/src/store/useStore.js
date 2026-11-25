// Adapted from openGym (AGPL-3.0-or-later): durable state is held by the local SQLite API.
import { create } from 'zustand'
import {reconcileGuidance} from '../lib/guided-progression.js'
import { api } from '../lib/api.js'
import {prepareOffline,syncOffline,saveTrackerJournal,readTrackerJournal,clearTrackerJournal} from '../../../../aesthetic_lab/static/offline.js'
import {mergeState,SyncConflict} from '../lib/merge-state.js'
import { registerCustom } from '../lib/exercises.js'
import {JOURNAL,LAST_CLEAN,loadTrackerSnapshot,saveTrackerSnapshot} from '../lib/tracker-storage.js'
import {waitForStorage} from '../lib/storage-wait.js'
// Isolate pending drafts between tabs while retaining recovery across a tab reload.
const standalone=window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true
const appTab=standalone?localStorage.getItem('aesthetic_opengym_app_tab'):null
let tab=sessionStorage.getItem('aesthetic_opengym_tab')||appTab
if(!tab)tab=crypto.randomUUID()
sessionStorage.setItem('aesthetic_opengym_tab',tab)
if(standalone)localStorage.setItem('aesthetic_opengym_app_tab',tab)
const KEY='aesthetic_opengym_state_v1_'+tab, REV='aesthetic_opengym_revision_'+tab, DIRTY='aesthetic_opengym_dirty_'+tab
export const DEF={unit:'kg',techniqueGate:true,restSec:90,sound:false,keepAwake:true,lang:'en',theme:'dark',accent:'lime',body:'male',targetW:null,bodyweight:[],routines:[],week:{},dayPlan:{},exWeights:{},workouts:[],active:null,customEx:[],gifSize:'mini',effort:'rir',reminder:{on:false,time:'08:00',tz:'Africa/Johannesburg'},coach:null}
const clone=o=>JSON.parse(JSON.stringify(o))
const cached=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
export const hasData=s=>!!(s.routines?.length||s.workouts?.length||s.bodyweight?.length)
export const useStore=create((set,get)=>{
 let timer=null,flight=null,hydrating=null,localWrite=Promise.resolve(),generation=0,latestSnapshot=null,saveFailed=false
 const cachedUser=cached('aesthetic_opengym_user',null),lastClean=cached(LAST_CLEAN,null)
 const raw=loadTrackerSnapshot(localStorage,KEY,tab,!!cachedUser||!!lastClean)
 const initial=Object.assign(clone(DEF),raw?.format===2?raw.state:raw||{})
 const base=raw?.format===2?raw.base:localStorage.getItem(DIRTY)==='1'?null:clone(initial)
 const revision=raw?.format===2?raw.revision:cached(REV,0)
 const dirty=raw?.format===2?raw.dirty:localStorage.getItem(DIRTY)==='1'
 const commit=snapshot=>{
  latestSnapshot=snapshot;const serial=++generation;set({localSaving:true})
  localWrite=localWrite.catch(()=>{}).then(()=>saveTrackerJournal(snapshot))
  localWrite.then(()=>{
   if(serial!==generation)return
   saveFailed=false;set({localSaving:false,deviceStorageReady:true})
  },error=>{if(serial===generation){saveFailed=true;set({localSaving:false,deviceStorageReady:false,syncError:error.message})}})
 }
 const durable=(S,rev,b,pending,conflict=false)=>{
  const snapshot=saveTrackerSnapshot(localStorage,KEY,tab,{format:2,state:S,base:b,revision:rev,dirty:pending,conflict})
  commit(snapshot);return snapshot
 }
 const clean=(S,rev)=>{try{localStorage.setItem(LAST_CLEAN,JSON.stringify({format:2,state:S,base:S,revision:rev,dirty:false}))}catch{}}
 const needsPairing=()=>set({needsPairing:true,syncStatus:'Saved on this device · Pair at home to sync',syncError:null})
 const persist=(S,push=true)=>{
  reconcileGuidance(S)
  S._ts=Math.max(Date.now(),(get().S._ts||0)+1)
  try{durable(S,get().revision,get().base,push||get().dirty,get().syncConflict)}catch{set({syncError:'Device storage is full. This change was not saved; free storage before continuing.'});return false}
  registerCustom(S.customEx);set({S,dirty:push||get().dirty,hasOfflineSnapshot:true})
  if(push){set({syncStatus:'Saved on this device · Waiting for Mac'});clearTimeout(timer);timer=setTimeout(()=>get().pushState(),500)}
  return true
 }
 const retry=()=>{if(get().hydrated&&!get().startupError&&!document.hidden){get().pushState();if(!get().dirty)get().pullState();void syncOffline().catch(()=>{})}}
 document.addEventListener('visibilitychange',retry);window.addEventListener('online',retry);window.addEventListener('focus',retry)
 setInterval(retry,20000)
 registerCustom(initial.customEx)
 return {
  S:initial,base,dirty,user:cachedUser||(lastClean?.revision>0?{id:'local',name:'Aesthetic Lab',admin:false}:null),ready:false,hydrated:false,startupError:null,localSaving:false,deviceStorageReady:false,needsPairing:false,hasOfflineSnapshot:!!raw,config:{local_workspace:true},revision,syncStatus:dirty?'Saved on this device · Waiting for Mac':'Checking Mac',syncError:null,syncConflict:!!raw?.conflict,
  isGuest:()=>false,setGuest(){},
  setUser(user){localStorage.setItem('aesthetic_opengym_user',JSON.stringify(user));set({user,needsPairing:false})},
  update(fn,push=true){const s=clone(get().S);fn(s);return persist(s,push)},
  replaceState(s,push=false){return persist(Object.assign(clone(DEF),clone(s)),push)},
  async flushLocal(){if(saveFailed&&latestSnapshot)commit(latestSnapshot);try{for(;;){const pending=localWrite;await pending;if(pending===localWrite)return true}}catch{return false}},
  async pushState(){
   clearTimeout(timer)
   if(!get().hydrated||get().startupError)return false
   if(!get().user||get().syncConflict)return false
   if(flight)return flight
   if(!get().dirty)return true
   if(!await get().flushLocal())return false
   if(flight)return flight
   const snapshot=clone(get().S),stamp=snapshot._ts,originalBase=get().base,rev=get().revision
   set({syncStatus:'Saved on this device · Syncing to Mac',syncError:null})
   flight=(async()=>{
    try{
     let saved=snapshot,r
     try{r=await api('/api/data',{method:'PUT',body:JSON.stringify({state:saved,revision:rev})})}
     catch(e){
      if(e.status!==409)throw e
      const mac=await api('/api/data');saved=mergeState(originalBase,snapshot,mac.state)
      r=await api('/api/data',{method:'PUT',body:JSON.stringify({state:saved,revision:mac.revision})})
     }
     const pending=get().S._ts!==stamp
     let current=saved,conflict=false
     if(pending){try{current=mergeState(snapshot,get().S,saved)}catch{current=get().S;conflict=true}}
     durable(current,r.revision,saved,pending,conflict);clean(saved,r.revision);registerCustom(current.customEx)
     set({S:current,base:saved,revision:r.revision,dirty:pending,needsPairing:false,syncStatus:pending?'Saved on this device · Waiting for Mac':'Saved to Mac',syncError:conflict?'Changes overlap with another device. Your phone copy is retained.':null,syncConflict:conflict})
     return !conflict
    }catch(e){
     if(e.status===401){needsPairing();return false}
     const conflict=e instanceof SyncConflict||e.status===409
     durable(get().S,get().revision,get().base,true,conflict)
     set({syncStatus:conflict?'Sync conflict · Phone copy retained':'Saved on this device · Waiting for Mac',syncError:e.network?null:e.message,syncConflict:conflict});return false
    }
   })()
   const ok=await flight;flight=null
   return ok&&get().dirty?get().pushState():ok
  },
  async pullState(){
   if(!get().hydrated||get().startupError||!get().user||get().dirty||flight)return
   try{
    const r=await api('/api/data');if(get().dirty)return
    const S=Object.assign(clone(DEF),r.state)
    durable(S,r.revision,S,false);clean(S,r.revision);registerCustom(S.customEx)
    set({S,base:S,revision:r.revision,hasOfflineSnapshot:true,needsPairing:false,syncStatus:'Saved to Mac',syncError:null,syncConflict:false})
   }catch(e){if(e.status===401){needsPairing();return}set({syncStatus:'Offline · Saved copy on this device',syncError:e.network?null:e.message})}
  },
  async loadMacCopy(){
   if(!window.confirm('Use the Mac version? Your pending workout copy will be kept in this browser as a recovery backup.'))return
   clearTimeout(timer);if(flight)await flight
   try{
    const r=await api('/api/data');localStorage.setItem(KEY+'_recovery',JSON.stringify(get().S));const S=Object.assign(clone(DEF),r.state)
    durable(S,r.revision,S,false);clean(S,r.revision);registerCustom(S.customEx)
    set({S,base:S,dirty:false,revision:r.revision,syncStatus:'Saved to Mac',syncError:null,syncConflict:false})
   }catch(e){set({syncError:e.message})}
  },
  exportPending(){const blob=new Blob([JSON.stringify({state:get().S,base:get().base,revision:get().revision},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='aesthetic-phone-workout-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)},
  async signOut(){
   if(!await get().pushState()||get().dirty){set({syncError:'Sync pending workouts before signing out.'});return}
   await api('/api/logout',{method:'POST',body:'{}'});await localWrite;await clearTrackerJournal();get().setUser(null);localStorage.removeItem(KEY);localStorage.removeItem(REV);localStorage.removeItem(DIRTY);localStorage.removeItem(LAST_CLEAN);localStorage.removeItem(JOURNAL);set({S:clone(DEF),base:null,dirty:false,hasOfflineSnapshot:false})
  },
  async signOutAll(){return get().signOut()},async resetDemo(){},
  async boot(){
   if(!hydrating)hydrating=(async()=>{
    try{
     const stored=await waitForStorage(readTrackerJournal(tab))
     if(stored?.signedOut){set({S:clone(DEF),base:null,dirty:false,user:null,hasOfflineSnapshot:false,deviceStorageReady:true});return}
     const restore=stored?.format===2&&(!raw||((stored.writtenAt||0)>(raw.writtenAt||0)&&(!raw.dirty||stored.writer===raw.writer)))
     if(restore){
      const S=Object.assign(clone(DEF),stored.state);registerCustom(S.customEx)
      set({S,base:stored.base,revision:stored.revision,dirty:stored.dirty,syncConflict:!!stored.conflict,hasOfflineSnapshot:true,
       user:get().user||{id:'local',name:'Aesthetic Lab',admin:false},syncStatus:stored.dirty?'Saved on this device · Waiting for Mac':'Offline · Saved copy on this device'})
      durable(S,stored.revision,stored.base,stored.dirty,!!stored.conflict);if(!await waitForStorage(get().flushLocal()))throw Error('Could not confirm your saved log in phone storage. Reload to retry without clearing your data.')
     }else if(raw){
      set({user:get().user||{id:'local',name:'Aesthetic Lab',admin:false}})
      durable(initial,revision,base,dirty,!!raw.conflict);if(!await waitForStorage(get().flushLocal()))throw Error('Could not confirm your saved log in phone storage. Reload to retry without clearing your data.')
     }
     else set({deviceStorageReady:true})
    }catch(e){set({deviceStorageReady:false,startupError:e.message,syncError:e.message})}
    finally{set({hydrated:true})}
   })()
   await hydrating
   // Never download a potentially older Mac copy over a journal we could not read.
   if(get().startupError){set({ready:true});return}
   try{const me=await api('/api/me');get().setUser(me.user);set({config:await api('/api/config')});if(get().dirty)await get().pushState();else await get().pullState()}
   catch(e){if(e.status===401&&get().user){needsPairing()}else set({syncStatus:get().user?'Offline · Saved copy on this device':'Pair this device on home Wi-Fi',syncError:e.network?null:e.message})}
   if(get().user){void prepareOffline().catch(()=>{});void syncOffline().catch(()=>{})}
   set({ready:true})
  }
 }
})
