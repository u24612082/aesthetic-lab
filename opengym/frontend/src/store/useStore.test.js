import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'

const mocks=vi.hoisted(()=>({api:vi.fn(),read:vi.fn(),save:vi.fn(),prepare:vi.fn(),sync:vi.fn()}))
vi.mock('../lib/api.js',()=>({api:mocks.api}))
vi.mock('../lib/exercises.js',()=>({registerCustom:vi.fn()}))
vi.mock('../../../../aesthetic_lab/static/offline.js',()=>({
 readTrackerJournal:mocks.read,saveTrackerJournal:mocks.save,
 clearTrackerJournal:vi.fn(),prepareOffline:mocks.prepare,syncOffline:mocks.sync,
}))
const memory=()=>{
 const values=new Map()
 return {get length(){return values.size},key:i=>[...values.keys()][i],getItem:k=>values.get(k)??null,
  setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)}
}
const snapshot=()=>({format:2,writer:'existing-tab',writtenAt:1,revision:7,dirty:true,conflict:false,
 state:{routines:[{id:'day1'}],customEx:[],bodyweight:[{d:'2026-11-02',w:81.7}],active:{id:'lift',sets:[{w:82.5,r:9,done:true}]},_ts:1},base:{active:null}})

beforeEach(()=>{
 vi.resetModules();vi.useFakeTimers();vi.clearAllMocks()
 vi.stubGlobal('localStorage',memory());vi.stubGlobal('sessionStorage',memory())
 sessionStorage.setItem('aesthetic_opengym_tab','existing-tab')
 vi.stubGlobal('window',{matchMedia:()=>({matches:false}),addEventListener:vi.fn()})
 vi.stubGlobal('navigator',{})
 vi.stubGlobal('document',{addEventListener:vi.fn(),hidden:false})
 mocks.api.mockRejectedValue(Object.assign(Error('Pairing expired'),{status:401}))
 mocks.read.mockResolvedValue(null);mocks.save.mockResolvedValue();mocks.prepare.mockResolvedValue();mocks.sync.mockResolvedValue()
})
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals()})

describe('offline tracker hydration',()=>{
 it('recovers from stalled phone storage without replacing unread pending data with the Mac copy',async()=>{
  localStorage.setItem('aesthetic_opengym_state_v1_existing-tab',JSON.stringify(snapshot()))
  mocks.read.mockImplementationOnce(()=>new Promise(()=>{}))
  const {useStore}=await import('./useStore.js'),boot=useStore.getState().boot()
  await vi.advanceTimersByTimeAsync(8001);await boot
  expect(useStore.getState()).toMatchObject({hydrated:true,ready:true,deviceStorageReady:false,S:{active:{id:'lift'}}})
  expect(useStore.getState().startupError).toContain('Phone storage did not respond')
  expect(mocks.api).not.toHaveBeenCalled();expect(await useStore.getState().pushState()).toBe(false)
 })
 it('keeps the recovered log accessible on a second reload without a cached user or Mac acknowledgement',async()=>{
  const saved=snapshot();localStorage.setItem('aesthetic_opengym_state_v1_existing-tab',JSON.stringify(saved));mocks.read.mockResolvedValue(saved)
  const {useStore}=await import('./useStore.js');await useStore.getState().boot()
  expect(useStore.getState()).toMatchObject({hydrated:true,needsPairing:true,dirty:true,user:{id:'local'},hasOfflineSnapshot:true})
  expect(useStore.getState().S.active.sets[0]).toMatchObject({w:82.5,r:9,done:true})
  expect(useStore.getState().S.bodyweight[0].w).toBe(81.7)
 })
 it('restores the IndexedDB journal when recent localStorage writes were lost at process exit',async()=>{
  mocks.read.mockResolvedValue(snapshot())
  const {useStore}=await import('./useStore.js');await useStore.getState().boot()
  expect(useStore.getState()).toMatchObject({deviceStorageReady:true,dirty:true,user:{id:'local'}})
  expect(useStore.getState().S.active.id).toBe('lift')
 })
 it('honors an explicit sign-out instead of reopening retained recovery copies',async()=>{
  localStorage.setItem('aesthetic_opengym_state_v1_existing-tab',JSON.stringify(snapshot()))
  mocks.read.mockResolvedValue({signedOut:true,writtenAt:2})
  const {useStore}=await import('./useStore.js');await useStore.getState().boot()
  expect(useStore.getState()).toMatchObject({user:null,dirty:false,hasOfflineSnapshot:false,S:{active:null}})
  expect(mocks.save).not.toHaveBeenCalled()
 })
 it('keeps the saving indicator until IndexedDB acknowledges the workout write',async()=>{
  mocks.read.mockResolvedValue(snapshot())
  const {useStore}=await import('./useStore.js');await useStore.getState().boot()
  let acknowledge;mocks.save.mockImplementationOnce(()=>new Promise(resolve=>{acknowledge=resolve}))
  useStore.getState().update(s=>{s.active.sets[0].w=85})
  let confirmed=false;const saved=useStore.getState().flushLocal().then(ok=>{confirmed=ok})
  await vi.waitFor(()=>expect(acknowledge).toBeTypeOf('function'))
  expect(confirmed).toBe(false);expect(useStore.getState().localSaving).toBe(true)
  acknowledge();await saved
  expect(confirmed).toBe(true);expect(useStore.getState().localSaving).toBe(false)
 })
})
