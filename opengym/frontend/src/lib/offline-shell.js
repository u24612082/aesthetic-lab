// Public app files only. Pairing credentials and personal records stay out of
// the service-worker cache. Readiness is checked with the controlling worker.
let flight
let status={ready:false,preparing:false,error:'',updateAvailable:false}
let watching=false
const loadedBuild=document.querySelector('meta[name="aesthetic-build"]')?.content
const differentCompleteBuild=result=>!!(result?.ready&&result.version&&loadedBuild&&!loadedBuild.startsWith('__')&&result.version!==loadedBuild)
const complete=result=>publish({...result,preparing:false,error:'',updateAvailable:differentCompleteBuild(result)})
const listeners=new Set()
const publish=patch=>{status={...status,...patch};for(const fn of listeners)fn(status)}
export const shellStatus=()=>status
export const subscribeShell=fn=>{listeners.add(fn);return()=>listeners.delete(fn)}
const bounded=(promise,ms,message)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(message)),ms);promise.then(v=>{clearTimeout(timer);resolve(v)},e=>{clearTimeout(timer);reject(e)})})
const activated=worker=>new Promise((resolve,reject)=>{
 const check=()=>{if(worker.state==='activated'){worker.removeEventListener('statechange',check);resolve(worker)}else if(worker.state==='redundant'){worker.removeEventListener('statechange',check);reject(Error('Offline app installation failed'))}}
 worker.addEventListener('statechange',check);check()
})
const message=(worker,type)=>new Promise((resolve,reject)=>{
 const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(Error('Offline app did not confirm its download'))},type==='PREPARE_OFFLINE'?45000:5000)
 channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data)}
 worker.postMessage({type},[channel.port2])
})
export function ensureOfflineShell(){
 if(flight)return flight
 flight=(async()=>{
  publish({preparing:true,error:''})
  try{
   if(!window.isSecureContext||!('serviceWorker'in navigator))throw Error('secure-context')
   if(!watching){
    watching=true
    navigator.serviceWorker.addEventListener('controllerchange',()=>{void (flight||Promise.resolve()).catch(()=>{}).then(()=>ensureOfflineShell()).catch(()=>{})})
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)void ensureOfflineShell().catch(()=>{})})
    window.addEventListener('online',()=>{void ensureOfflineShell().catch(()=>{})})
   }
   const existing=await navigator.serviceWorker.getRegistration('/')
   if(existing?.active){
    // A prepared phone must not need a successful network registration to open.
    void existing.update().catch(()=>{})
    try{const saved=await message(existing.active,'OFFLINE_STATUS');if(saved.ready){complete(saved);return status}}catch{}
   }
   const registration=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'})
   const worker=await bounded(activated(registration.installing||registration.waiting||registration.active),45000,'Offline download did not finish')
   let result=await message(worker,'OFFLINE_STATUS')
   if(!result.ready)result=await bounded(message(worker,'PREPARE_OFFLINE'),45000,'Offline download did not finish')
   if(!result.ready)throw Error(result.error||'Offline download did not finish')
   complete(result);return status
  }catch(error){
   const certificate=/secure-context|security|certificate|SSL/i.test(String(error.message)+' '+error.name)
   const text=certificate?'Offline startup is blocked. On iPhone, enable full trust for Aesthetic Lab Personal Mac CA in Settings → General → About → Certificate Trust Settings, then reopen this app on home Wi-Fi.':'Offline startup is not downloaded yet. Connect to your Mac on home Wi-Fi and tap Prepare for offline use.'
   publish({ready:false,preparing:false,error:text});throw Error(text)
  }
 })().finally(()=>{flight=null})
 return flight
}
export async function updateOfflineApp(){
 const registration=await navigator.serviceWorker.getRegistration('/')
 if(!registration)throw Error('Connect to your Mac at home and prepare this app once.')
 let cached
 if(registration.active){try{cached=await message(registration.active,'OFFLINE_STATUS')}catch{}}
 try{await registration.update()}
 catch{
  // A suspended iPhone can already have a complete newer worker while still
  // displaying old HTML. Reload that downloaded version even without the Mac.
  if(differentCompleteBuild(cached))return cached
  throw Error('Connect to your Mac on home Wi-Fi to download the app update. Your saved entries are kept.')
 }
 const worker=registration.installing||registration.waiting||registration.active
 await bounded(activated(worker),45000,'The app update did not finish. Try again on home Wi-Fi.')
 const result=await message(registration.active||worker,'OFFLINE_STATUS')
 if(!result.ready)throw Error('The app update is not downloaded yet. Prepare it on home Wi-Fi.')
 return result
}
export async function reloadOfflineApp(flush){
 if(!await flush())throw Error('Your latest entries could not be saved yet. Free phone storage and retry.')
 await updateOfflineApp()
 if(!await flush())throw Error('Wait for your latest entries to finish saving.')
 location.reload()
}
