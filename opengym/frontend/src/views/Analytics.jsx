import {useState} from 'react'
import {Button} from '../components/ui.jsx'
import LabDialog from '../components/LabDialog.jsx'
import {useLabResource,number,dateLabel,LabPage,LabError,LabEmpty} from '../lib/lab-data.jsx'


function WeightTrend({body,plan}){
 const records=body?.records||[],values=records.map(r=>r.kg),low=Math.min(...values)-.3,high=Math.max(...values)+.3
 const first=records.length?Date.parse(records[0].date):0,last=records.length?Date.parse(records.at(-1).date):0
 const points=records.map(r=>[12+(Date.parse(r.date)-first)/Math.max(last-first,86400000)*576,135-(r.kg-low)/Math.max(high-low,.6)*120])
 return <section className="lab-card" id="weight-analysis"><h2>Body weight and nutrition phase</h2>{body?.latest?<>
  <div className="lab-plan-facts"><div><strong>{number(body.latest.kg,2)} kg</strong><small>Last recorded · {dateLabel(body.latest.date)}</small></div><div><strong>{body.mean_7d_kg?number(body.mean_7d_kg,2)+' kg':'—'}</strong><small>Seven-day mean</small></div><div><strong>{body.change_pct_per_week!=null?(body.change_pct_per_week>0?'+':'')+number(body.change_pct_per_week,2)+'%':'—'}</strong><small>Weekly mean-based change</small></div></div>
  {records.length>1&&<svg className="lab-weight-chart" viewBox="0 0 600 155" role="img" aria-label={`Recorded body weight from ${records[0].date} to ${records.at(-1).date}; ${number(Math.min(...values),1)} to ${number(Math.max(...values),1)} kilograms`}><polyline fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" points={points.map(p=>p.join(',')).join(' ')}/>{records.map((r,i)=><circle key={r.date} cx={points[i][0]} cy={points[i][1]} r="3" fill="currentColor"><title>{r.date}: {r.kg} kg</title></circle>)}</svg>}
  <p className="lab-note">{body.goal_kg?`Recorded goal: ${number(body.goal_kg,1)} kg. `:''}{body.limitations}</p>
 </>:<LabEmpty>Record your weight in Stats. Synced weigh-ins feed this analysis, the macro planner and Claude.</LabEmpty>}
 {plan?.configured&&<p className="lab-note">Current phase: {plan.profile.phase.replaceAll('_',' ')} · {number(plan.targets.kcal)} kcal · {plan.intake_quality.complete_food_days}/14 complete food days. {plan.assessment.reasons[0]}</p>}</section>
}

function Session({id,onClose}){
 const {data,error}=useLabResource('/api/workouts/'+id,0)
 return <LabDialog title={data?.workout.name||'Workout detail'} onClose={onClose} wide><LabError>{error}</LabError>{!data?<LabEmpty>Loading saved session…</LabEmpty>:<><p className="lab-note">{dateLabel(data.workout.local_date)} · {data.workout.source}</p>{data.sets.length?<div className="lab-table-wrap"><table className="lab-table"><thead><tr><th>Exercise</th><th>kg</th><th>Reps</th><th>RIR</th></tr></thead><tbody>{data.sets.map(s=><tr key={s.id}><td>{s.exercise}{s.warmup&&<small>Warm-up</small>}</td><td>{number(s.load_kg,1)}</td><td>{s.reps}</td><td>{s.rir??'—'}</td></tr>)}</tbody></table></div>:<LabEmpty>This session has summary data only.</LabEmpty>}</>}</LabDialog>
}

export default function Analytics(){
 const [days,setDays]=useState(7),[session,setSession]=useState(null),[limit,setLimit]=useState(8)
 const {data,error,loading}=useLabResource('/api/dashboard?days='+days)
 const priority=['Upper Chest','Lateral Deltoids','Lats','Upper Back','Quadriceps','Hamstrings']
 const groups=data?priority.map(target=>data.volume.find(g=>g.target===target)).filter(Boolean):[]
 const stats=data?.stats,peak=Math.max(...groups.map(v=>v.direct_sets),1)
 const bins=[]
 if(data){const size=Math.ceil(data.daily.length/12);for(let i=0;i<data.daily.length;i+=size){const values=data.daily.slice(i,i+size);bins.push({date:values[0].date,sets:values.reduce((n,d)=>n+d.sets,0)})}}
 const maxSets=Math.max(...bins.map(b=>b.sets),1)
 return <LabPage title="Analytics" subtitle="Completed work, muscle exposure and performance trends." actions={<label className="lab-period-label">Period<select id="period" value={days} onChange={e=>{setDays(Number(e.target.value));setLimit(8)}}><option value="7">Last 7 days</option><option value="28">Last 28 days</option><option value="84">Last 12 weeks</option></select></label>}>
  <LabError>{error}</LabError>{!data?<LabEmpty>{loading?'Loading your training data…':'Connect to your Mac to download this view.'}</LabEmpty>:<>
   <p className="lab-note">{dateLabel(data.period.start)} – {dateLabel(data.period.end)} · Saved Mac data; sync your phone for the latest sessions.</p>
   <div className="lab-stats-grid" id="stats">{[['Sessions',stats.sessions,stats.summary_only+' summary-only'],['Working sets',stats.working_sets,stats.known_hard_sets+' confirmed at RIR ≤4'],['Volume',number(stats.tonnage_kg/1000,1)+' t','Reported loads × reps'],['Food consistency',stats.logged_days+'/'+days,'Days with food entries']].map(([title,value,note])=><section className="lab-card lab-stat" key={title}><span>{title}</span><strong>{value}</strong><small>{note}</small></section>)}</div>
   <WeightTrend body={data.bodyweight} plan={data.nutrition_plan}/>
   <div className="lab-analysis-grid"><section className="lab-card"><h2>Priority muscle exposure</h2><p className="lab-note">Direct working sets. Secondary exposure stays separate.</p><div className="lab-volume" id="volume-chart" role="img" aria-label={groups.map(g=>g.target+': '+g.direct_sets+' direct working sets').join('; ')}>{groups.map(g=><div className="lab-volume-row" key={g.target} title={`${g.secondary_sets} secondary sets; ${g.unknown_rir_sets} with unknown RIR`}><span>{g.target}</span><div className="lab-track"><i style={{width:g.direct_sets/peak*100+'%'}}/></div><strong>{g.direct_sets}</strong></div>)}</div></section>
   <section className="lab-card"><h2>Training rhythm</h2><p className="lab-note">Working sets across the selected period.</p><div className="lab-activity" id="activity-chart">{bins.map(b=><div key={b.date} title={b.date+': '+b.sets+' working sets'}><span>{b.sets||''}</span><i style={{height:Math.max(3,b.sets/maxSets*140)+'px'}}/><small>{days===7?new Intl.DateTimeFormat('en-ZA',{weekday:'short'}).format(new Date(b.date+'T12:00:00')):dateLabel(b.date)}</small></div>)}</div><h3 className="lab-subheading">Performance signals</h3>{data.fatigue.length?<ul className="lab-copy">{data.fatigue.map((f,i)=><li key={i}>{f.exercise}: {f.change_pct}% estimated performance change between comparable sessions.</li>)}</ul>:<LabEmpty>No ≥5% decline found in comparable logged performance. This is a performance flag, not a recovery diagnosis.</LabEmpty>}{data.symmetry.length>0&&<ul className="lab-copy">{data.symmetry.map((s,i)=><li key={i}>{s.exercise}: {s.gap_pct}% paired side-to-side performance gap.</li>)}</ul>}</section></div>
   <section className="lab-card"><h2>Recent sessions</h2><div id="recent-sessions" className="lab-session-list">{data.workouts.length?data.workouts.slice(0,limit).map(w=><button key={w.id} onClick={()=>setSession(w.id)}><span><strong>{w.name}</strong><small>{dateLabel(w.local_date)} · {Math.round((new Date(w.ended_at)-new Date(w.started_at))/60000)} min · {w.detail_level==='sets'?'Set-level':'Summary only'}</small></span><span aria-hidden="true">›</span></button>):<LabEmpty>Finish a workout to see it here.</LabEmpty>}</div>{limit<data.workouts.length&&<Button onClick={()=>setLimit(limit+12)}>Show more sessions</Button>}</section>
   <section className="lab-card"><h2>Your full muscle breakdown</h2><div className="lab-table-wrap"><table className="lab-table"><thead><tr><th>Target</th><th>Direct</th><th>Secondary</th><th>Hard</th></tr></thead><tbody>{data.volume.map(g=><tr key={g.target}><td>{g.target}</td><td>{g.direct_sets}</td><td>{g.secondary_sets}</td><td>{g.known_hard_sets}</td></tr>)}</tbody></table></div><p className="lab-note">{data.methodology}</p>{data.unmapped_exercises.length>0&&<p className="lab-note">Unmapped: {data.unmapped_exercises.join(', ')}</p>}</section>
  </>}
  {session!=null&&<Session id={session} onClose={()=>setSession(null)}/>}
 </LabPage>
}
