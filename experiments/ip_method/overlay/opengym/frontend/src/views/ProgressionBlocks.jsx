import {useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {useStore} from '../store/useStore.js'
import {exOr} from '../lib/exercises.js'
import {sameExercise} from '../lib/exercise-identity.js'
import {exerciseRecords} from '../lib/exercise-records.js'
import {effectiveRoutine} from '../lib/history.js'
import {todayISO,fmtNum} from '../lib/format.js'
import {startFlow} from '../sheets.jsx'
import {beginBlockWorkout} from '../lib/progression-blocks.js'
import {FOCUS_GOALS,SIMPLE_STAGES,focusSuggestion,createGuidedBlock,focusExerciseId,guidedStatus,guidedSamples,guidedComparison} from '../lib/guided-progression.js'
import {Button} from '../components/ui.jsx'

const name=id=>exOr(id).n
const date=value=>value?new Date(value).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}):'—'
const setText=set=>set?`${fmtNum(set.w)} kg × ${set.r}${set.rir!=null?' · RIR '+set.rir:set.rpe!=null?' · RPE '+set.rpe:''}`:'Choose a starting load when you log it'
function LastPerformance({id}){
 const S=useStore(s=>s.S),records=exerciseRecords(S,id),recent=records.recent[0]
 return <div className="focus-performance"><span>Last logged</span><strong>{setText(recent?.sets[0])}</strong>{recent&&<small>{date(recent.d)}</small>}{records.heaviest&&<small>Best recorded: {setText(records.heaviest)}</small>}</div>
}
function FocusChooser({close,canCancel=false}){
 const S=useStore(s=>s.S),update=useStore(s=>s.update),[goal,setGoal]=useState('upper-chest'),[error,setError]=useState('')
 const suggestion=focusSuggestion(S,goal)
 const useFocus=()=>{setError('');try{if(update(state=>{createGuidedBlock(state,goal)})!==false)close()}catch(e){setError(e.message)}}
 return <section className="card focus-chooser" aria-label="Choose your aesthetic priority">
  <span className="ip-eyebrow">ONE CHOICE TO GET STARTED</span><h2>What would you like to improve?</h2><p className="muted">I’ll use your routine and logged exercises to choose a focus and related variations.</p>
  <div className="focus-goals">{FOCUS_GOALS.map(item=><button type="button" key={item.id} data-focus-goal={item.id} aria-pressed={goal===item.id} onClick={()=>{setGoal(item.id);setError('')}}>{item.label}</button>)}</div>
  {!suggestion.error&&<div className="ip-actions"><Button variant="primary" onClick={useFocus}>Use this focus</Button>{canCancel&&<Button onClick={close}>Cancel</Button>}</div>}
  {suggestion.error?<p role="alert">{suggestion.error}</p>:<><div className="focus-anchor"><small>YOUR MAIN LIFT</small><h3>{suggestion.anchor.name}</h3><LastPerformance id={suggestion.anchor.id}/></div>
   <div className="focus-path"><div><small>Support option</small><strong>{suggestion.reinforce.name}</strong></div><span aria-hidden="true">→</span><div><small>Bridge option</small><strong>{suggestion.transfer.name}</strong></div></div>
   <p className="small muted">You’ll keep your main lift while it is progressing. I’ll review completed sessions and use a variation after repeated comparable stalls. These are related alternatives; a limiting muscle has not been identified.</p>
  </>}
  {error&&<p className="ip-error" role="alert">{error}</p>}
 </section>
}
function Comparison({block}){
 const S=useStore(s=>s.S),result=guidedComparison(S,block)
 return <section className={'ip-comparison '+result.kind} aria-label="Automatic performance comparison"><h3>Your return check</h3><p>{result.message}</p><div className="ip-grid">{[['Before',result.before],['After',result.after]].map(([label,sample])=><div key={label}><small className="muted">{label} · {date(sample?.d)}</small><p><b>{setText(sample?.first)}</b></p>{sample?.sets.length>1&&<p className="small muted">Other working sets: {sample.sets.slice(1).map(setText).join('; ')}</p>}</div>)}</div><p className="small muted">These are recorded performances. Setup, ROM and technique were not measured; this does not prove muscle growth or causal transfer.</p></section>
}
function FocusCard({block}){
 const S=useStore(s=>s.S),update=useStore(s=>s.update),navigate=useNavigate(),[error,setError]=useState('')
 const currentId=focusExerciseId(block),status=guidedStatus(S,block),samples=guidedSamples(S,block)
 const today=effectiveRoutine(S,todayISO()),matching=(S.routines||[]).filter(r=>(r.ex||[]).some(e=>sameExercise(S,e.id,block.anchorId)||sameExercise(S,e.id,currentId)))
 const startNormal=()=>{if(S.active)navigate('/workout');else if(today)startFlow(today.id);else navigate('/workout')}
 const standalone=()=>{setError('');try{if(update(s=>{beginBlockWorkout(s,block.id)})!==false)navigate('/workout')}catch(e){setError(e.message)}}
 const pause=()=>update(s=>{const b=s.ipBlocks[block.id];b.paused=!b.paused;if(!b.paused)b.resumeAt=Date.now()})
 return <article className="card focus-card" data-ip-block={block.id}>
  <div className="row between"><span className="ip-eyebrow">{block.goal}</span><span className="tag acc">{block.paused?'Paused':block.stage==='complete'?'Complete':'Automatic'}</span></div>
  <h2>{SIMPLE_STAGES[block.stage]}</h2><div className="focus-lift">{name(currentId||block.anchorId)}</div>
  {block.stage!=='complete'&&<div className="ip-actions"><Button variant="primary" onClick={startNormal}>{S.active?'Continue workout':today?'Start '+today.name:'Choose workout'}</Button><Button onClick={pause}>{block.paused?'Resume focus':'Pause focus'}</Button></div>}
  <p className="focus-decision" role="status">{status.message}</p>
  {block.stage!=='complete'&&<><LastPerformance id={currentId}/><div className="focus-meter"><span>Session review</span><b>{(block.exposures?.[block.stage]||[]).length} new sessions in this stage</b></div><p className="small muted">Log your normal sets and RIR. I’ll update the next step when you finish. Temporary gym swaps still work.</p></>}
  <details className="ip-details"><summary>My plan & why</summary><div className="ip-variations">{[['Main lift',block.anchorId],['Support option',block.reinforceId],['Bridge option',block.transferId]].map(([label,id])=><div key={label}><small>{label}</small><strong>{name(id)}</strong></div>)}</div><p>{block.reason}</p><p className="small muted">Focus slots appear in: {matching.map(r=>r.name).join(', ')||'your freestyle workouts'}. Starting a normal routine will apply the current variation to its main-lift slot for that session.</p><p className="small muted">Related variations keep separate loads and records. Your saved routine templates stay intact.</p>{block.stage!=='complete'&&!block.paused&&<Button onClick={standalone} disabled={!!S.active}>Train just this lift</Button>}</details>
  {(block.retestId||block.stage==='complete')&&<Comparison block={block}/>}
  {error&&<p className="ip-error" role="alert">{error}</p>}
 </article>
}
function Preview(){
 return <section className="card focus-preview" aria-label="Read-only automatic guidance preview"><span className="ip-eyebrow">EXAMPLE ONLY · NEVER ADDED TO YOUR LOG</span><h2>You log. The focus updates.</h2><ol><li><b>Main lift:</b> You log your normal incline dumbbell sets. Improving results keep the exercise in place.</li><li><b>Repeated stall:</b> After enough comparable sessions, the next workout uses a related support variation in the same slot.</li><li><b>Support & bridge:</b> Each stays while productive. Repeated stable results trigger the next step.</li><li><b>Return check:</b> The original lift comes back. The app compares your logged sets—for example, 30 kg × 7 becoming 30 kg × 9 at the same reported effort.</li></ol><p className="small muted">A deload, falling performance or a slow-cut goal can hold rotation. No forms or stage-advance buttons are needed.</p></section>
}
export default function ProgressionBlocks(){
 const S=useStore(s=>s.S),[choosing,setChoosing]=useState(false),[preview,setPreview]=useState(false)
 const guided=Object.values(S.ipBlocks||{}).filter(b=>b.guided).sort((a,b)=>b.createdAt-a.createdAt)
 const current=guided.find(b=>b.stage!=='complete'&&!b.paused)||guided.find(b=>b.stage!=='complete'),completed=guided.filter(b=>b.stage==='complete')
 const legacy=Object.values(S.ipBlocks||{}).filter(b=>!b.guided)
 return <div className="ip-page focus-page"><div className="hdr"><div><h1>Your aesthetic focus</h1><div className="sub">Choose a priority. Keep logging as usual.</div></div></div>
  {!current&&!completed.length&&!choosing&&<FocusChooser close={()=>setChoosing(false)}/>}
  {choosing&&<FocusChooser canCancel close={()=>setChoosing(false)}/>}
  {current&&<FocusCard block={current}/>}
  <div className="focus-tools">{(current||completed.length>0)&&!choosing&&<Button onClick={()=>setChoosing(true)}>Choose another focus</Button>}<Button onClick={()=>setPreview(value=>!value)}>{preview?'Hide preview':'Show a quick preview'}</Button></div>
  {preview&&<Preview/>}
  {completed.map(block=><FocusCard key={block.id} block={block}/>)}
  {legacy.length>0&&<details className="card ip-details"><summary>Your earlier trial blocks ({legacy.length})</summary><p>These blocks and their workout records are preserved. Choose a focus above to use automatic guidance.</p>{legacy.map(block=><p key={block.id}>{block.title} · {block.stage}</p>)}</details>}
  <details className="card ip-details"><summary>How automatic decisions work</summary><p>Selection favours related exercises you already train. Routine workouts are tracked automatically, including the same exercise under another routine ID.</p><p>The prototype looks for four consecutive exposures with at least two working sets and the same first-set load, reps and reported RIR. At least two exposures must be new to the stage. Progress keeps the current lift; a performance drop, a recorded deload, or a slow-cut context holds rotation. After the bridge stage it collects two return sessions.</p><p>Four exposures is an adjustable trial rule, not an established optimal training dose. Missing setup or technique evidence stays unknown. Your technique gate continues to govern load review; this feature never approves or increases a weight.</p></details>
  <p className="focus-footnote">Isolated Mac trial · Local guidance · Your usual app and iPhone remain unchanged.</p>
 </div>
}
