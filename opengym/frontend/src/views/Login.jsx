// Local pairing replaces upstream multi-profile WebAuthn for this personal SQLite host.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import Icon from '../components/Icon.jsx'
export default function Login({compact=false,onPaired}){
 const [token,setToken]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const connect=async e=>{e.preventDefault();setBusy(true);try{await api('/api/login',{method:'POST',body:JSON.stringify({token})});setToken('');await useStore.getState().boot();if(!useStore.getState().needsPairing)onPaired?.()}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <div className="narrow" style={{paddingTop:compact?0:'10vh',maxWidth:460}}><div style={{color:'var(--acc)',fontSize:40}}><Icon name="dumbbell"/></div><h1>Aesthetic Lab</h1><p className="muted">Your training. Your Mac. Your data.</p><div className="card"><h2>Pair your iPhone</h2><p className="small muted">On the Mac, open Settings → Connect your iPhone and show a six-digit code. Your routines, food and coach will use the same database. On your first Mac login, use APP_TOKEN from .env instead.</p><form onSubmit={connect}><label htmlFor="pair-token">Pairing code or Mac token</label><input id="pair-token" className="field" type="password" inputMode="numeric" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} value={token} onChange={e=>setToken(e.target.value.trim())} required minLength={6}/><p role="alert">{error}</p><button className="btn primary" disabled={busy}>{busy?'Connecting…':'Connect to Mac'}</button></form></div><p className="small dim">Tracker powered by <a href="https://github.com/alexpcosta/opengym" target="_blank" rel="noopener noreferrer">OpenGym</a> · AGPL-3.0</p></div>
}
