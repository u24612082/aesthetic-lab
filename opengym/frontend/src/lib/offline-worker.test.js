import {describe,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
const source=readFileSync(new URL('../../public/sw.js',import.meta.url),'utf8').replace('__BUILD_ID__','test-build')
async function fixture(){
 const base='https://gym.local/',files=new Map(),handlers={}
 let hang=false,broken=false,staleHtml=false
 const key=p=>new URL(typeof p==='string'?p:p.url,base).href
 const fetcher=vi.fn(async p=>{
  const url=key(p)
  if(hang)return new Promise(()=>{})
  if(url===base+'offline-assets.json')return Response.json({version:broken?'another-build':'test-build',files:['./assets/app.js','./assets/stats.js']})
  return new Response(url===base?'<html><meta name="aesthetic-build" content="'+(staleHtml?'older-build':'test-build')+'">offline gym</html>':'app file',{headers:{'content-type':url===base?'text/html':'text/javascript'}})
 })
 const buckets=new Map()
 const makeCache=entries=>({match:async p=>entries.get(key(p))?.clone(),put:async(p,r)=>entries.set(key(p),r.clone()),addAll:async urls=>{const results=await Promise.all(urls.map(async u=>[key(u),await fetcher(u)]));for(const [u,r] of results)entries.set(u,r)}})
 const caches={open:async name=>{if(!buckets.has(name))buckets.set(name,makeCache(name.endsWith('test-build')?files:new Map()));return buckets.get(name)},keys:async()=>[...buckets.keys()],delete:async name=>buckets.delete(name)}
 const self={registration:{scope:base,update:vi.fn().mockResolvedValue()},location:{origin:'https://gym.local'},clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(name,fn)=>handlers[name]=fn}
 runInNewContext(source,{self,caches,fetch:fetcher,URL,Response,Promise})
 let install;handlers.install({waitUntil:p=>install=p});await install
 const message=async type=>{let wait,result;handlers.message({data:{type},ports:[{postMessage:r=>result=r}],waitUntil:p=>wait=p});await wait;return result}
 return {base,files,handlers,fetcher,message,caches,self,hang:()=>hang=true,breakManifest:()=>broken=true,staleHtml:()=>staleHtml=true}
}
describe('offline workout app shell',()=>{
 it('retains the previous app build for a suspended page resuming during an update',async()=>{
  const f=await fixture(),prefix='aesthetic-opengym-offline-gym-'
  await f.caches.open(prefix+'obsolete')
  const old=await f.caches.open(prefix+'previous');await old.put(f.base+'assets/old-screen.js',new Response('previous screen'))
  await f.caches.open('aesthetic-exercise-media-v1')
  let activated;f.handlers.activate({waitUntil:p=>activated=p});await activated
  expect(await f.caches.keys()).not.toContain(prefix+'obsolete')
  expect(await f.caches.keys()).toContain(prefix+'previous')
  expect(await f.caches.keys()).toContain('aesthetic-exercise-media-v1')
  f.hang();f.fetcher.mockClear();let response
  f.handlers.fetch({request:{url:f.base+'assets/old-screen.js',method:'GET'},respondWith:p=>response=p})
  expect(await (await response).text()).toBe('previous screen');expect(f.fetcher).not.toHaveBeenCalled()
 })
 it('downloads lazy screen code before confirming readiness',async()=>{
  const f=await fixture();expect(f.files.has(f.base+'assets/stats.js')).toBe(true)
  expect((await f.message('OFFLINE_STATUS')).ready).toBe(true)
 })
 it('opens cached app immediately while the Mac network request would hang',async()=>{
  const f=await fixture();f.hang();f.fetcher.mockClear();let response
  f.handlers.fetch({request:{url:f.base,method:'GET',mode:'navigate'},respondWith:p=>response=p,waitUntil:()=>{}})
  const text=await Promise.race([response.then(r=>r.text()),new Promise((_,reject)=>setTimeout(()=>reject(Error('Navigation waited for Mac')),100))])
  expect(text).toContain('offline gym');expect(f.fetcher).not.toHaveBeenCalled()
 })
 it('does not hold a navigation event open for an update while a new worker needs to activate',async()=>{
  const f=await fixture(),wait=vi.fn();let response
  f.self.registration.update.mockImplementation(()=>new Promise(()=>{}))
  f.handlers.fetch({request:{url:f.base,method:'GET',mode:'navigate'},respondWith:p=>response=p,waitUntil:wait})
  expect(await(await response).text()).toContain('offline gym')
  expect(f.self.registration.update).not.toHaveBeenCalled();expect(wait).not.toHaveBeenCalled()
 })
 it('does not cache authenticated APIs or health records',async()=>{
  const f=await fixture(),respond=vi.fn();f.fetcher.mockClear()
  f.handlers.fetch({request:{url:f.base+'api/data',method:'GET'},respondWith:respond})
  expect(respond).not.toHaveBeenCalled();expect(f.fetcher).not.toHaveBeenCalled()
  expect([...f.files.keys()].some(k=>k.includes('/api/'))).toBe(false)
 })
 it('detects a missing screen instead of falsely reporting offline ready',async()=>{
  const f=await fixture();f.files.delete(f.base+'assets/stats.js')
  expect((await f.message('OFFLINE_STATUS')).ready).toBe(false)
  expect((await f.message('PREPARE_OFFLINE')).ready).toBe(true)
 })
 it('keeps the existing working app if a new deployment is incomplete',async()=>{
  const f=await fixture();f.breakManifest()
  expect((await f.message('PREPARE_OFFLINE')).ready).toBe(false)
  expect((await f.message('OFFLINE_STATUS')).ready).toBe(true)
 })
 it('does not replace the complete cached app with HTML from a different build',async()=>{
  const f=await fixture();f.staleHtml()
  expect((await f.message('PREPARE_OFFLINE')).ready).toBe(false)
  expect((await f.message('OFFLINE_STATUS')).ready).toBe(true)
 })
})
