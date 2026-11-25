import {useMemo,useState} from 'react'
import {useStore} from '../store/useStore.js'
import {exerciseRecords} from '../lib/exercise-records.js'
import {modeOf} from '../lib/history.js'
import {fmtNum} from '../lib/format.js'
import {dateLocale} from '../lib/i18n.js'
import {exOr} from '../lib/exercises.js'

export default function ExerciseRecords({id,mode=modeOf({id}),compact=false}){
 const state=useStore(store=>store.S)
 const records=useMemo(()=>exerciseRecords(state,id),[state,id])
 const [shown,setShown]=useState(6)
 if(mode!=='reps')return null
 const load=weight=>weight===0?'Bodyweight':fmtNum(weight)+' '+state.unit
 const pair=set=>load(set.w)+' × '+set.r+' reps'
 const date=value=>value?new Date(value+'T12:00:00').toLocaleDateString(dateLocale(),{day:'numeric',month:'short',year:'numeric'}):'Date not recorded'
 // Keep the maximum visible without opening a disclosure, including a clear
 // empty state. A legacy load-only maximum must never acquire invented reps.
 const maximum=records.loadOnly||records.heaviest
 const highlights=<div className="exercise-record-highlights" data-record-highlights={id}>
  <div><span>All-time max</span><strong>{maximum?(maximum.r!=null?pair(maximum):load(maximum.w)):'No logged sets yet'}</strong><small>{maximum?(maximum.r!=null?date(maximum.d):'Load-only record · reps not recorded'):'Complete a working set to start your record.'}</small></div>
  <div><span>Most reps</span><strong>{records.mostReps?records.mostReps.r+' reps at '+load(records.mostReps.w):'Not recorded yet'}</strong>{records.mostReps&&<small>{date(records.mostReps.d)}</small>}</div>
 </div>
 if(!records.heaviest)return <section className="exercise-records" data-exercise-records={id} aria-label={'Records for '+exOr(id).n}>{highlights}</section>
 const peak=records.peakSession
 const contents=<>
  {records.loadOnly&&<p className="small muted">Heaviest complete working set: {pair(records.heaviest)}. The higher load-only record has no recorded reps.</p>}
  {peak&&<div className="exercise-record-session">
   <h4>{peak.live?'Current workout at your heaviest load':'Session at your heaviest load'}</h4>
   <p className="small muted">{date(peak.d)}{peak.name?' · '+peak.name:''}</p>
   <p>{peak.sets.map(pair).join(' · ')}</p>
  </div>}
  <h4>Best reps at each weight</h4>
  <table className="exercise-record-table"><thead><tr><th scope="col">Load</th><th scope="col">Best reps</th><th scope="col">Date</th></tr></thead>
   <tbody>{records.repBests.map(set=><tr key={set.w}><td>{load(set.w)}</td><td>{set.r}</td><td>{date(set.d)}</td></tr>)}</tbody>
  </table>
  {!!records.recent.length&&<><h4>Previous working sets</h4>
   {records.recent.slice(0,shown).map(session=><div className="exercise-record-session" key={session.id}>
    <p className="small muted">{date(session.d)}{session.name?' · '+session.name:''}</p>
    <p>{session.sets.map(pair).join(' · ')}</p>
   </div>)}
   {records.recent.length>shown&&<button type="button" className="btn sm" onClick={()=>setShown(value=>value+6)}>Show older sessions</button>}
  </>}
  <p className="small muted">Shared across your routines. Historical records stay available during lighter sessions.</p>
 </>
 return <section className="exercise-records" data-exercise-records={id} aria-label={'Records for '+exOr(id).n}>
  {!compact&&<h3>Your working-set records</h3>}{highlights}
  {compact?<details className="exercise-record-history"><summary>History &amp; previous working sets</summary>{contents}</details>:contents}
 </section>
}
