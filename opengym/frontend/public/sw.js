// Each built app keeps its HTML and all code together. Navigation never waits
// for an unreachable Mac; API responses and health records are never cached.
const BUILD='__BUILD_ID__'
const CACHE='aesthetic-opengym-offline-gym-'+BUILD
const MEDIA_CACHE='aesthetic-exercise-media-v1'
const EXTRA=['./startup.js','./manifest.json','./icon-180.png','./icon-512.png','/analytics/','/analytics/?embedded=1','/analytics/app.js','/analytics/offline.js','/analytics/exercise-media.js','/analytics/exercise-media-data.js','/analytics/exercise-illustration-data.js','/analytics/exercise-image-cache.js','/analytics/food-search.js','/analytics/style.css','/analytics/fonts.css','/analytics/icon.svg']
const absolute=path=>new URL(path,self.registration.scope).href
let preparing
async function prepareShell(){
 if(preparing)return preparing
 preparing=(async()=>{
  const manifestResponse=await fetch(absolute('./offline-assets.json'),{cache:'reload'})
  if(!manifestResponse.ok)throw Error('Offline asset list unavailable')
  const manifest=await manifestResponse.clone().json()
  if(manifest.version!==BUILD||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.some(path=>!path.startsWith('./assets/')||path.includes('..')||new URL(path,self.registration.scope).origin!==self.location.origin))throw Error('App update is not complete')
  const html=await fetch(absolute('./'),{cache:'reload'})
  if(!html.ok||!html.headers.get('content-type')?.includes('text/html'))throw Error('App unavailable')
  if(!(await html.clone().text()).includes('name="aesthetic-build" content="'+BUILD+'"'))throw Error('App HTML update is not complete')
  const c=await caches.open(CACHE)
  await c.addAll([...manifest.files,...EXTRA].map(absolute))
  await c.put(absolute('./offline-assets.json'),manifestResponse)
  await c.put(absolute('./'),html)
 })().finally(()=>{preparing=null})
 return preparing
}
async function shellStatus(){
 const c=await caches.open(CACHE),r=await c.match(absolute('./offline-assets.json'))
 if(!r)return {ready:false,version:BUILD}
 const manifest=await r.json(),files=['./',...manifest.files,...EXTRA]
 const present=await Promise.all(files.map(path=>c.match(absolute(path))))
 return {ready:manifest.version===BUILD&&present.every(Boolean),version:BUILD,assets:files.length}
}
self.addEventListener('install',event=>event.waitUntil(prepareShell().then(()=>self.skipWaiting())))
const isShell=name=>name.startsWith('opengym-')||name.startsWith('aesthetic-shell-')||name.startsWith('aesthetic-opengym-')
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 // A page already open during an update can still import its previous build's
 // hashed files. Retain that cache until the next upgrade instead of deleting
 // code underneath an iPhone page suspended in the background.
 const previous=(await caches.keys()).filter(name=>isShell(name)&&name!==CACHE)
 await Promise.all(previous.slice(0,-1).map(name=>caches.delete(name)))
 await self.clients.claim()
})()))
self.addEventListener('message',event=>{
 if(!['OFFLINE_STATUS','PREPARE_OFFLINE'].includes(event.data?.type)||!event.ports?.[0])return
 event.waitUntil((async()=>{
  try{if(event.data.type==='PREPARE_OFFLINE')await prepareShell();event.ports[0].postMessage(await shellStatus())}
  catch{event.ports[0].postMessage({ready:false,version:BUILD,error:'Connect to your Mac at home to download the app.'})}
 })())
})
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url)
 if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return
 if(url.pathname.startsWith('/exercise-media/')||url.pathname.includes('/img/')||url.pathname.includes('/gif/')){
  const reload=['reload','no-store'].includes(event.request.cache)
  event.respondWith(caches.open(MEDIA_CACHE).then(async c=>{
   const hit=await c.match(event.request);if(hit&&!reload)return hit
   try{const r=await fetch(event.request);if(r.ok)await c.put(event.request,r.clone());return r}catch(error){if(hit)return hit;throw error}
  }));return
 }
 if(event.request.mode==='navigate'){
  const target=url.pathname.startsWith('/analytics')?'/analytics/':'./'
  event.respondWith(caches.open(CACHE).then(async c=>(await c.match(absolute(target)))||fetch(event.request)))
  // A new worker installs its complete matching build before replacing this one.
  // Do not replace the cached HTML with a newer build's uncached asset names.
  // The page checks for updates on startup, foreground and reconnect. Keeping
  // a navigation event alive for registration.update() can prevent a downloaded
  // waiting worker from activating. Respond with the cached shell and finish.
  return
 }
 event.respondWith(caches.open(CACHE).then(async c=>{
  const hit=await c.match(event.request);if(hit)return hit
  if(url.pathname.startsWith('/assets/')){
   for(const name of (await caches.keys()).filter(isShell).reverse()){
    if(name===CACHE)continue
    const previous=await (await caches.open(name)).match(event.request);if(previous)return previous
   }
  }
  const r=await fetch(event.request);if(r.ok)await c.put(event.request,r.clone());return r
 }))
})
self.addEventListener('push',event=>{
 const data=event.data?event.data.json():{}
 event.waitUntil(self.registration.showNotification(data.title||'Aesthetic Lab',{body:data.body||'',icon:'icon-512.png',badge:'icon-180.png',tag:data.tag||'opengym',renotify:true}))
})
self.addEventListener('notificationclick',event=>{
 event.notification.close()
 event.waitUntil(self.clients.matchAll({type:'window'}).then(clients=>{const c=clients.find(c=>'focus'in c);return c?c.focus():self.clients.openWindow('./')}))
})
