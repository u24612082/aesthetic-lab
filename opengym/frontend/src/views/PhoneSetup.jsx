import {useEffect,useState} from 'react'
import {api} from '../lib/api.js'
import {Button} from '../components/ui.jsx'
import {useStore} from '../store/useStore.js'
import {ensureOfflineShell,shellStatus,subscribeShell} from '../lib/offline-shell.js'
import {prepareOffline,offlineStatus,subscribeOffline,syncOffline} from '../../../../aesthetic_lab/static/offline.js'

export default function PhoneSetup(){
 const [status,setStatus]=useState(null),[pair,setPair]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[offline,setOffline]=useState(null),[busy,setBusy]=useState(false)
 const [shell,setShell]=useState(shellStatus)
 const tracker=useStore()
 const load=()=>api('/api/phone/status').then(setStatus).catch(e=>setError(e.message))
 useEffect(()=>{load();const refresh=()=>offlineStatus().then(setOffline).catch(()=>{});refresh();return subscribeOffline(refresh)},[])
 useEffect(()=>{const off=subscribeShell(setShell);void ensureOfflineShell().catch(()=>{});return off},[])
 const pairing=async()=>{try{setPair(await api('/api/phone/pairing-code',{method:'POST',body:'{}'}));setError('')}catch(e){setError(e.message)}}
 const profile=async()=>{try{setNotice((await api('/api/phone/reveal-profile',{method:'POST',body:'{}'})).message)}catch(e){setError(e.message)}}
 const prepare=async()=>{setBusy(true);setError('');try{
  await ensureOfflineShell()
  if(!useStore.getState().hasOfflineSnapshot)await useStore.getState().pullState()
  if(!useStore.getState().hasOfflineSnapshot)throw Error('Pair this app and connect to your Mac once to download your routines.')
  if(!await useStore.getState().flushLocal())throw Error('Your workout copy could not be confirmed in phone storage. Free some storage and try again.')
  try{await navigator.storage?.persist?.()}catch{}
  setNotice('Ready to log lifts, reps and body weight offline. Saved entries sync when you reopen the app at home.')
  // Food and pictures are optional for lifting; their download cannot hold up
  // the workout-ready confirmation or replace a pending workout draft.
  void prepareOffline(true).then(()=>syncOffline()).catch(()=>{})
 }catch(e){setError(e.message)}finally{setBusy(false)}}
 return <div className="narrow phone-setup"><h1>Your iPhone, ready for the gym</h1><p className="muted">Log every set and meal without a connection. Sync when you get home.</p>
 {error&&<p role="alert">{error}</p>}
 <div className="card"><h2>Offline logging</h2><p>{shell.ready&&tracker.hasOfflineSnapshot&&tracker.deviceStorageReady&&!tracker.localSaving?'Ready to log lifts and body weight offline.':'Prepare this iPhone once while connected to your Mac at home.'}</p><ul className="phone-steps"><li>App screens: {shell.ready?'downloaded':shell.preparing?'downloading…':'not ready'}</li><li>Routines and weight history: {tracker.hasOfflineSnapshot?'saved on this device':'connect to your Mac once'}</li><li>Food library: {offline?.prepared?'downloaded':'optional download pending'}</li><li>Exercise pictures: {offline?.media?.ready?'downloaded':'optional download pending'}</li></ul>{shell.error&&<p role="alert">{shell.error}</p>}{offline?.media?.preparing&&<p className="small muted" role="status">Downloading exercise images… Lifting remains available.</p>}<Button variant="primary" onClick={prepare} disabled={busy}>{busy?'Preparing offline app…':'Prepare for offline use'}</Button><p className="small muted">At the gym, use this same Home Screen app. Lifts, reps and weigh-ins save immediately on the phone. At home, keep the Mac awake and reopen the app on the same Wi-Fi to sync. {offline?.pending?`${offline.pending} food changes waiting to sync.`:''}</p>{notice&&<p role="status">{notice}</p>}</div>
 {!status?<p>{error?'Mac not connected. Your downloaded gym log remains available.':'Checking the home connection…'}</p>:!status.enabled?<div className="card"><h2>Prepare your Mac</h2><p>On your Mac, open <strong>Setup iPhone Access.command</strong> in this app’s folder, then return here.</p><Button onClick={load}>Check again</Button></div>:<>
 <div className="card"><h2>1. Trust your Mac once</h2><p>Keep your iPhone and Mac on the same home Wi-Fi. Send your Mac’s security profile to your iPhone using AirDrop.</p><Button onClick={profile}>Show profile on Mac</Button><ol className="phone-steps"><li>On iPhone: Settings → General → VPN &amp; Device Management. Install <strong>Aesthetic Lab — My Mac</strong>.</li><li>Settings → General → About → Certificate Trust Settings. Turn on full trust for <strong>Aesthetic Lab Personal Mac CA</strong>.</li></ol><p className="small muted">Only iphone.mobileconfig is shared. Private keys stay on the Mac.</p></div>
 <div className="card"><h2>2. Install your gym app</h2><img className="phone-qr" src="/api/phone/qr.svg" alt="Scan to open your private tracker"/><a className="phone-address" href={status.url}>{status.url}</a><p>Scan with your iPhone camera and open in Safari. Tap Share → Add to Home Screen, then Add. Open the new Home Screen app before pairing.</p></div>
 <div className="card"><h2>3. Pair the Home Screen app</h2><p>Generate the code here on your Mac and enter it in the app on your iPhone.</p><Button variant="primary" onClick={pairing}>{pair?'Create a new code':'Show pairing code'}</Button>{pair&&<><div className="phone-pair-code">{pair.code}</div><p className="small muted">One use. Expires in five minutes.</p></>}<p>On the iPhone, open Settings → Connect your iPhone and prepare that device for the gym.</p></div>
 </>}
 <p className="small muted">Keep this Home Screen app and its browser data installed until changes have synced. Coaching and barcode lookups run when your Mac is reachable.</p>
 </div>
}
