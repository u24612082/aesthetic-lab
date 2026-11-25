import {useState} from 'react'
import {Button} from '../components/ui.jsx'
import {useLabResource,post,LabPage,LabError,LabEmpty,dateLabel} from '../lib/lab-data.jsx'

function Report({saved}){
 if(!saved)return <LabEmpty>Finish a workout or log food, then request your first review.</LabEmpty>
 let report
 try{report=JSON.parse(saved.report)}catch{return <LabEmpty>The saved review could not be read. Request another review.</LabEmpty>}
 const suggestions=(report.adjustments||[]).map(a=>`${a.target}: ${a.weekly_set_delta>0?'+':''}${a.weekly_set_delta} weekly sets. ${a.reason}`)
 return <><div className="lab-card-heading"><h2>Your aesthetic audit</h2><span className="lab-badge">{saved.mode==='claude_pro'?'CLAUDE PRO':saved.mode==='claude'?'CLAUDE':'LOCAL RULES'}</span></div><p className="lab-report-summary">{report.summary}</p><p className="lab-note">Generated {saved.created_at} UTC · May precede your latest unsynced entries.</p>{[['Aesthetic audit',report.aesthetic_audit],['Fatigue signals',report.fatigue_signals],['Nutrition context',report.nutrition_notes],['Volume suggestions',suggestions],['Evidence & limitations',report.limitations]].map(([title,items])=><section className="lab-report-section" key={title}><h3>{title}</h3>{items?.length?<ul>{items.map((item,i)=><li key={i}>{item}</li>)}</ul>:<p>No new suggestions for this section.</p>}</section>)}</>
}

export default function LabCoach(){
 const status=useLabResource('/api/coach/status',5000),dashboard=useLabResource('/api/dashboard?days=7',5000)
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[apiKey,setApiKey]=useState('')
 const s=status.data,automation=s?.subscription?.automation,job=automation?.job,subscription=s?.provider==='subscription'
 const running=busy||job?.state==='queued'||job?.state==='running'||s?.state==='running'
 const action=async(path,body={})=>{
  setBusy(true);setError('')
  try{const result=await post(path,body);setNotice(result.message||'Coach updated.');await Promise.all([status.refresh(),dashboard.refresh()])}catch(e){setError(e.message)}finally{setBusy(false);setApiKey('')}
 }
 const review=()=>action(subscription?'/api/coach/run?force=true':'/api/coach/run')
 const issue=job?.state&&!['complete','queued','running','superseded'].includes(job.state)
 return <LabPage title="Aesthetic coach" subtitle="Your training, technique and nutrition in one review.">
  <LabError>{error||status.error||dashboard.error}</LabError>{notice&&<p className="lab-notice" role="status">{notice}</p>}
  <section className="lab-card lab-coach-status"><div className="lab-card-heading"><h2 id="coach-connection-title">{subscription?'Your Claude Pro coach':'Your training coach'}</h2><span className="lab-badge">{running?'REVIEWING':subscription?'CLAUDE PRO':'LOCAL / API'}</span></div>
   <p id="coach-connection-message">{s?.demo?'Demo mode uses local rules. Personal Claude settings are unchanged.':s?.message||'Checking your coach…'}</p>
   {s&&<p className="lab-note">Last 28 days: {s.sessions} sessions · {s.detailed_sessions} with set data · {s.food_days} food days.</p>}
   {subscription?<div id="subscription-coach"><p id="subscription-review-status" className="lab-note">{running?'Claude is reviewing saved data on your Mac.':issue?job.message:automation?.enabled?'Automatic reviews are enabled. Saved changes are batched for review.':'Automatic reviews are paused.'}</p><div className="lab-actions"><Button id="open-subscription-coach" variant="primary" onClick={review} disabled={running||!s?.has_data||s?.demo}>{running?'Reviewing…':'Review now'}</Button><Button id="toggle-auto-coach" onClick={()=>action('/api/coach/automation',{enabled:!automation?.enabled})} disabled={busy||s?.demo}>{automation?.enabled?'Pause automatic reviews':'Enable automatic reviews'}</Button></div><p className="lab-note">Uses your Claude subscription limits. New reviews need your Mac and its internet connection; suggestions do not change your programme automatically.</p></div>:<><Button id="generate-audit" variant="primary" onClick={review} disabled={running||!s?.has_data}>{running?'Reviewing…':'Update audit'}</Button>{s&&!s.demo&&<details className="lab-api-settings"><summary>{s.api_key_configured?'Claude API settings':'Optional Claude API connection'}</summary><form className="lab-form" onSubmit={e=>{e.preventDefault();void action('/api/coach/connect',{api_key:apiKey})}}><label>Anthropic API key<input type="password" autoComplete="off" required minLength="20" value={apiKey} onChange={e=>setApiKey(e.target.value)}/></label><p className="lab-note">API usage is billed separately. Local rules work without a key.</p><Button type="submit" disabled={busy}>Connect</Button>{s.api_key_configured&&<Button type="button" onClick={()=>action('/api/coach/disconnect')} disabled={busy}>Disconnect API</Button>}</form></details>}</>}
   <LabError>{s?.last_error?.message}</LabError>
  </section>
  <section className="lab-card" id="coach-report"><Report saved={dashboard.data?.coach}/></section>
  <section className="lab-card"><h2>Technique-gated progression</h2><p className="lab-copy">Amplitude and force control must reach 3/5 for isolation or 4/5 for compounds on every working set. Missing measured scores hold progression. Passing permits a load review.</p><div className="lab-gates" id="technique-gates">{dashboard.data?.progression_gates.length?dashboard.data.progression_gates.map((g,i)=><article className="lab-gate" key={i}><div className="lab-card-heading"><h3>{g.exercise}</h3><span className={'lab-badge '+(g.status==='passed'?'':'lab-badge-hold')}>{g.status==='passed'?'READY FOR REVIEW':g.status==='hold'?'HOLD':'MORE DATA NEEDED'}</span></div><p className="lab-note">{dateLabel(g.session_date)} · {g.working_sets} working sets · {g.threshold}/5 threshold</p><ul>{g.reasons.map((reason,j)=><li key={j}>{reason}</li>)}</ul></article>):<LabEmpty>Completed working sets will appear here. Technique scores are never inferred.</LabEmpty>}</div></section>
  <section className="lab-card"><h2>Performance & balance</h2>{dashboard.data?.symmetry.length?<ul className="lab-copy">{dashboard.data.symmetry.map((s,i)=><li key={i}>{s.exercise}: {s.gap_pct}% paired left/right estimated performance gap.</li>)}</ul>:<LabEmpty>No paired left/right performance data yet. Workout volume alone cannot measure physical symmetry.</LabEmpty>}</section>
 </LabPage>
}
