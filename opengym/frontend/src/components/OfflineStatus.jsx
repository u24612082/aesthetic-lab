import {useEffect,useState} from 'react'
import {useStore} from '../store/useStore.js'
import {useUI} from '../store/useUI.js'
import Login from '../views/Login.jsx'
import {ensureOfflineShell,shellStatus,subscribeShell,updateOfflineApp} from '../lib/offline-shell.js'
import {offlineStatus,subscribeOffline,startOfflineSync,syncOffline,exportPending,keepMacFoodChanges} from '../../../../aesthetic_lab/static/offline.js'
export default function OfflineStatus(){
 const [status,setStatus]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const [shell,setShell]=useState(shellStatus)
 const tracker=useStore()
 useEffect(()=>{const refresh=()=>offlineStatus().then(setStatus).catch(()=>{});refresh();const off=subscribeOffline(refresh),stop=startOfflineSync();return()=>{off();stop()}},[])
 useEffect(()=>{const off=subscribeShell(setShell);void ensureOfflineShell().catch(()=>{});return off},[])
 const backup=async()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(await exportPending(),null,2)],{type:'application/json'}));a.download='aesthetic-phone-food-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
 const sync=async()=>{setBusy(true);setError('');try{await Promise.all([tracker.pushState(),syncOffline()]);if(!useStore.getState().dirty)await useStore.getState().pullState()}catch(e){setError(e.message)}finally{setBusy(false)}}
 const updateApp=async()=>{setBusy(true);setError('');try{if(!await useStore.getState().flushLocal())throw Error('Your latest entries could not be saved yet. Retry after freeing phone storage.');await updateOfflineApp();if(!await useStore.getState().flushLocal())throw Error('Wait for your latest entries to finish saving.');location.reload()}catch(e){setError(e.message)}finally{setBusy(false)}}
 const foodConflict=!!status?.conflicts.length
 const message=tracker.localSaving?'Saving on this iPhone…':tracker.syncConflict?'Workout changes need review':foodConflict?'Food changes need review':status?.pending?`${status.pending} food ${status.pending===1?'change':'changes'} saved on this device · Waiting for Mac`:status?.media?.preparing&&!tracker.dirty?'Downloading exercise images for offline use':tracker.syncStatus
 return <div className={'lab-save lab-sync-status'+(tracker.syncError||foodConflict||error?' lab-save-error':'')}>
  <div className="lab-syncbar"><span role="status" title={message}>{message}</span><button className="btn sm" onClick={sync} disabled={busy}>{busy?'Syncing…':'Sync to Mac'}</button></div>
  {shell.updateAvailable&&<div className="lab-sync-actions"><span>App update ready. Your saved entries will be kept.</span><button className="btn sm" onClick={updateApp} disabled={busy||tracker.localSaving}>Update app</button></div>}
  <div className="lab-offline-readiness" data-workout-offline-ready={shell.ready&&tracker.hasOfflineSnapshot&&tracker.deviceStorageReady&&!tracker.localSaving?'true':'false'}>{shell.ready&&tracker.hasOfflineSnapshot&&tracker.deviceStorageReady&&!tracker.localSaving?<span>Ready to log lifts and body weight offline</span>:<><span>{shell.preparing?'Downloading the offline app…':'Offline startup needs preparation'}</span><a href="#/phone">Prepare for offline use</a></>}</div>
  {shell.error&&<p className="lab-sync-error" role="alert">{shell.error}</p>}
  {tracker.needsPairing&&<div className="lab-sync-actions"><p>You can keep logging offline. Pair at home to send your saved entries to the Mac.</p><button className="btn sm" onClick={()=>useUI.getState().openSheet(close=><Login compact onPaired={close}/>)}>Pair to sync</button></div>}
  {(tracker.syncError||error)&&<p className="lab-sync-error" role="alert">{error||tracker.syncError}</p>}
  {tracker.syncConflict&&<div className="lab-sync-actions"><button className="btn sm" onClick={()=>tracker.exportPending()}>Download phone backup</button><button className="btn sm" onClick={()=>tracker.loadMacCopy()}>Load Mac version</button></div>}
  {foodConflict&&<div className="lab-sync-actions"><p>{status.conflicts[0].message}</p><button className="btn sm" onClick={backup}>Download food backup</button><button className="btn sm" onClick={()=>{if(window.confirm('Use the Mac food diary and discard ALL pending phone food changes? A recovery copy will be kept on this device.'))keepMacFoodChanges().catch(e=>setError(e.message))}}>Keep Mac food diary</button></div>}
 </div>
}
