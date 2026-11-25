import {afterEach,describe,it,expect,vi} from 'vitest'
import {cacheExerciseImages} from '../../../../aesthetic_lab/static/exercise-image-cache.js'

afterEach(()=>vi.unstubAllGlobals())
const origin='https://local.test'
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('')
async function fixture(){
 const bytes=new Uint8Array([255,216,255,1,2,3]),file={url:'/exercise-media/photos/example.jpg',sha256:await sha(bytes),bytes:bytes.length},entries=new Map(),saved=[]
 const key=url=>new URL(url,origin).href
 const cache={keys:async()=>[...entries.keys()].map(url=>({url})),match:async url=>entries.get(key(url))?.clone(),put:async(url,response)=>entries.set(key(url),response.clone())}
 vi.stubGlobal('location',{origin});vi.stubGlobal('caches',{open:async()=>cache})
 const fetcher=vi.fn(async()=>new Response(bytes,{headers:{'content-type':'image/jpeg'}}));vi.stubGlobal('fetch',fetcher)
 const options={request:async()=>({version:'v1',files:[file]}),save:async state=>saved.push(structuredClone(state)),notify:vi.fn()}
 return {bytes,file,entries,cache,fetcher,options,saved}
}
describe('offline exercise image preparation',()=>{
 it('caches only verified complete images before reporting ready',async()=>{
  const f=await fixture(),state=await cacheExerciseImages(f.options)
  expect(state.ready).toBe(true);expect(state.completed).toBe(1);expect(f.saved[0].ready).toBe(false);expect(f.saved.at(-1).ready).toBe(true)
  expect(await f.cache.match(f.file.url)).toBeTruthy()
 })
 it('recovers cached files after a terminated app lost its progress metadata',async()=>{
  const f=await fixture();await f.cache.put(f.file.url,new Response(f.bytes,{headers:{'content-type':'image/jpeg'}}))
  const state=await cacheExerciseImages({...f.options,previous:{preparing:true}})
  expect(state.ready).toBe(true);expect(f.fetcher).not.toHaveBeenCalled()
 })
 it('does not mark an interrupted or corrupted download ready',async()=>{
  const f=await fixture();f.fetcher.mockImplementation(async()=>new Response('corrupted bytes',{headers:{'content-type':'image/jpeg'}}))
  const state=await cacheExerciseImages(f.options)
  expect(state.ready).toBe(false);expect(state.completed).toBe(0);expect(await f.cache.match(f.file.url)).toBeUndefined()
 })
 it('retains the last complete download while the Mac is unreachable',async()=>{
  const f=await fixture(),previous={ready:true,preparing:false,version:'v1',completed:1,total:1}
  expect(await cacheExerciseImages({...f.options,previous,request:async()=>{throw Error('Mac unavailable')}})).toEqual(previous)
  expect(f.fetcher).not.toHaveBeenCalled()
 })
})
