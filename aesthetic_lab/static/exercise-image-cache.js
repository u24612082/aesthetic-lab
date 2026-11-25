import {MEDIA_CACHE} from './exercise-media.js'

// Static media only. Workout records, food records and credentials never enter this cache.
export async function cacheExerciseImages({previous={},save,notify,request}){
 if(!globalThis.caches)return {ready:false,error:'Open the secure app address to download offline images.'}
 let manifest
 try{manifest=await request('/exercise-media/manifest.json',{cache:'no-store'})}
 catch{if(previous.preparing){const state={...previous,preparing:false};await save(state);notify();return state}return previous}
 const cache=await caches.open(MEDIA_CACHE),existing=new Set((await cache.keys()).map(r=>r.url)),hashes={...previous.hashes}
 const files=manifest.files.filter(f=>{
  const url=new URL(f.url,location.origin)
  return url.origin===location.origin&&url.pathname.startsWith('/exercise-media/')&&/^[a-f0-9]{64}$/.test(f.sha256)
 })
 if(files.length!==manifest.files.length)throw Error('Invalid exercise image manifest.')
 const digest=async r=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await r.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('')
 // Cache writes can survive a killed/suspended PWA before its metadata is saved.
 // Verify those files locally, so a reopened phone resumes instead of starting over.
 for(const f of files){
  if(existing.has(new URL(f.url,location.origin).href)&&hashes[f.url]!==f.sha256){
   const r=await cache.match(f.url)
   if(r&&await digest(r)===f.sha256)hashes[f.url]=f.sha256
  }
 }
 const pending=files.filter(f=>!existing.has(new URL(f.url,location.origin).href)||hashes[f.url]!==f.sha256)
 if(!pending.length&&previous.ready&&previous.version===manifest.version)return previous
 let completed=files.length-pending.length,cursor=0,failure
 const state=()=>({version:manifest.version,total:files.length,completed,hashes,ready:!failure&&completed===files.length,preparing:false,error:failure?'Some exercise images still need downloading. Reconnect to your Mac and try again.':''})
 await save({...state(),ready:false,preparing:true});notify()
 const worker=async()=>{
  while(cursor<pending.length&&!failure){
   const f=pending[cursor++]
   try{
    const r=await fetch(f.url,{cache:'reload',credentials:'same-origin',signal:AbortSignal.timeout(15000)})
    if(!r.ok||!r.headers.get('content-type')?.startsWith('image/'))throw Error('Image unavailable')
    const bytes=await r.clone().arrayBuffer(),sha=await digest(new Response(bytes))
    if(sha!==f.sha256||bytes.byteLength!==f.bytes)throw Error('Incomplete image download')
    await cache.put(f.url,r);hashes[f.url]=sha;completed++
   }catch(e){failure=e}
  }
 }
 await Promise.allSettled(Array.from({length:4},worker))
 const result=state();await save(result);notify();return result
}
