import {useEffect} from 'react'
import {useLocation} from 'react-router-dom'
import {useStore} from '../store/useStore.js'
import {api} from '../lib/api.js'
import {reconcileGuidance,phaseLabel,focusExerciseId} from '../lib/guided-progression.js'
import {exOr} from '../lib/exercises.js'

export default function TrialBanner(){
 const config=useStore(s=>s.config),ready=useStore(s=>s.ready),user=useStore(s=>s.user),S=useStore(s=>s.S)
 const location=useLocation()
 useEffect(()=>{
  if(!ready||!user)return
  const draft=structuredClone(useStore.getState().S)
  if(reconcileGuidance(draft))useStore.getState().update(state=>{reconcileGuidance(state)})
 },[ready,!!user,S.workouts.length])
 useEffect(()=>{
  if(!ready||!user)return
  let cancelled=false
  const read=async()=>{try{const plan=await api('/api/nutrition/plan');const phase=phaseLabel(plan.profile?.phase);if(!cancelled&&useStore.getState().S.ipContext?.phase!==phase)useStore.getState().update(state=>{state.ipContext={phase,source:'nutrition-plan'};if(state.active?.ipTrial?.automatic&&state.active.entries.every(e=>e.sets.every(s=>!s.done)))state.active.ipTrial.phase=phase})}catch{}}
  const visible=()=>{if(!document.hidden)void read()}
  void read();window.addEventListener('online',visible);document.addEventListener('visibilitychange',visible)
  return()=>{cancelled=true;window.removeEventListener('online',visible);document.removeEventListener('visibilitychange',visible)}
 },[ready,!!user,location.pathname])
 const block=Object.values(S.ipBlocks||{}).find(b=>b.guided&&!b.paused&&b.stage!=='complete'),active=S.active?.ipTrial?.automatic&&block&&S.active.ipTrial.blockId===block.id
 return <><aside className="ip-trial-banner" aria-label="Isolated trial workspace"><div><strong>IP METHOD TRIAL</strong><span>A separate copy of your gym log. Changes stay here.</span></div><nav><a href="#/progression-blocks">My focus</a><a href={config.personal_url||'http://127.0.0.1:8765'} target="_blank" rel="noopener noreferrer">Open usual app ↗</a></nav></aside>
  {active&&<div className="focus-workout-note"><div><b>Focus lift today: {exOr(focusExerciseId(block)).n}</b><span>{S.active.ipTrial.deload?'Recovery session · focus rotation is held.':'Log as usual. I’ll review this session when you finish.'}</span></div><button onClick={()=>useStore.getState().update(state=>{state.active.ipTrial.deload=!state.active.ipTrial.deload})}>{S.active.ipTrial.deload?'Normal session':'Training lighter today'}</button></div>}
  {!S.active&&block?.lastDecision?.workoutId&&<a className="focus-update-note" href="#/progression-blocks"><b>Focus updated</b> · {block.lastDecision.message} <span>View focus →</span></a>}
 </>
}
