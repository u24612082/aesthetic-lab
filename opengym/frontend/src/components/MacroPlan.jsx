import {useEffect,useState} from 'react'
import {Button} from './ui.jsx'
import LabDialog from './LabDialog.jsx'
import {post,useLabResource,number,LabError} from '../lib/lab-data.jsx'
import {subscribeOffline} from '../../../../aesthetic_lab/static/offline.js'

const phases={lean_gain:'Slow lean surplus',slow_cut:'Slow cut',maintain:'Maintenance / recomp'}

function PlanDialog({data,onClose,onSaved}){
 const p=data?.profile||{},[phase,setPhase]=useState(p.phase||'lean_gain'),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const save=async e=>{
  e.preventDefault();if(busy)return;setBusy(true);setError('')
  const values=Object.fromEntries(new FormData(e.currentTarget));for(const k of ['age','height_cm','activity'])values[k]=Number(values[k])
  values.starting_weight_kg=values.starting_weight_kg?Number(values.starting_weight_kg):null;values.automatic=values.automatic==='on'
  try{await post('/api/nutrition/plan',values,'PUT');onSaved();onClose()}catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <LabDialog id="macro-plan-dialog" title={data?.configured?'Edit phase and macro plan':'Build your macro plan'} onClose={onClose} wide>
  <p className="lab-copy">Choose your current phase. Saving starts a fresh 14-day observation period. Your Mac calculates and audits changes after your phone syncs.</p>
  <form id="macro-plan-form" className="lab-form" onSubmit={save}>
   <label>Current phase<select name="phase" value={phase} onChange={e=>setPhase(e.target.value)}>{Object.entries(phases).map(([v,label])=><option value={v} key={v}>{label}</option>)}</select></label>
   <div className="lab-form-grid">
    <label>Age<input name="age" type="number" inputMode="numeric" min="18" max="80" required defaultValue={p.age||''}/></label>
    <label>Height (cm)<input name="height_cm" type="number" inputMode="decimal" min="130" max="230" step="any" required defaultValue={p.height_cm||''}/></label>
    <label>Sex used for calorie estimate<select name="equation_sex" required defaultValue={p.equation_sex||''}><option value="" disabled>Choose an equation</option><option value="male">Male</option><option value="female">Female</option></select></label>
    <label>Overall activity<select name="activity" defaultValue={p.activity||1.55}><option value="1.2">Low · mostly seated</option><option value="1.4">Light · some daily movement</option><option value="1.55">Moderate · regular training and movement</option><option value="1.7">High · active days and frequent training</option><option value="1.9">Very high · physical work and training</option></select></label>
    <label>Starting weight (kg)<input name="starting_weight_kg" type="number" inputMode="decimal" min="20" max="400" step="any" defaultValue={p.starting_weight_kg||data?.bodyweight?.latest?.kg||''}/></label>
   </div>
   <p className="lab-note">A recent weight from Stats takes priority over the starting weight. Activity includes the gym; exercise calories are never added twice.</p>
   <label className="lab-check"><input name="automatic" type="checkbox" defaultChecked={p.automatic??true}/><span>Automatically adjust when the evidence is sufficient</span></label>
   <p className="lab-note">Starting estimate: Mifflin–St Jeor × activity, then {phase==='slow_cut'?'a 10% deficit':phase==='lean_gain'?'a 5% surplus':'maintenance'}. Protein {phase==='slow_cut'?'2.2':'2.0'} g/kg, fat at least 0.6 g/kg and around 25% of energy, carbohydrates from the remainder. These are estimates for adults.</p>
   <LabError>{error}</LabError><Button variant="primary" type="submit" disabled={busy}>{busy?'Calculating…':'Save phase and calculate targets'}</Button>
  </form>
 </LabDialog>
}

export default function MacroPlan(){
 const {data,error,refresh}=useLabResource('/api/nutrition/plan'),[editing,setEditing]=useState(false)
 useEffect(()=>{let timer;const off=subscribeOffline(()=>{clearTimeout(timer);timer=setTimeout(refresh,400)});return()=>{clearTimeout(timer);off()}},[refresh])
 const plan=data?.profile,body=data?.bodyweight,rate=data?.assessment.target_rate_pct_week
 return <section className="lab-card lab-macro-plan" id="macro-plan">
  <header className="lab-card-heading"><div><span className="lab-eyebrow">ADAPTIVE NUTRITION</span><h2>{plan?phases[plan.phase]:'A plan for your current phase'}</h2></div><Button id="macro-plan-edit" onClick={()=>setEditing(true)}>{plan?'Change phase / settings':'Calculate my macros'}</Button></header>
  <LabError>{error}</LabError>
  {plan?<>
   <div className="lab-plan-facts"><div><strong>{number(data.targets.kcal)} kcal</strong><small>Current daily target · {plan.automatic?'auto-adjust enabled':'adjustments paused'}</small></div><div><strong>{rate?.join(' to ')}%</strong><small>Target scale change per week</small></div><div><strong>{body?.mean_7d_kg?number(body.mean_7d_kg,2)+' kg':'Need weigh-ins'}</strong><small>Seven-day mean · {body?.change_pct_per_week!=null?`${body.change_pct_per_week>0?'+':''}${number(body.change_pct_per_week,2)}% / week`:'trend not ready'}</small></div></div>
   <p className="lab-note">P {number(data.targets.protein)} g · C {number(data.targets.carbs)} g · F {number(data.targets.fat)} g. {data.intake_quality.complete_food_days}/14 complete food days.</p>
   <ul className="lab-plan-reasons">{data.assessment.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>
   <details className="lab-plan-details"><summary>Adjustment history and evidence</summary><p className="lab-note">The Mac checks synced data every minute. No more than ±100 kcal per adjustment or one adjustment per week. Incomplete intake and multiple comparable performance declines can hold changes. Offline, this is the last downloaded plan.</p>{data.history.map((h,i)=>{const before=JSON.parse(h.before_json),after=JSON.parse(h.after_json);return <p className="lab-note" key={i}>{new Date(h.created_at*1000).toLocaleDateString('en-ZA')} · {before.kcal?number(before.kcal)+' → ':''}{number(after.kcal)} kcal · {h.reason}</p>})}<p className="lab-note">{data.policy}</p>{data.sources.map(s=><p className="lab-note" key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></p>)}</details>
  </>:<p className="lab-copy">Switch between a slow lean surplus, a slow cut and maintenance. Your weight trend, complete food logs and comparable training performance guide small, recorded adjustments. Set up once while connected to your Mac.</p>}
  {editing&&<PlanDialog data={data} onClose={()=>setEditing(false)} onSaved={refresh}/>}
 </section>
}
