import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { effectiveRoutine, lastEntryFor, buildSets, setsDoneActive, supersetUnits, unitOf, setLabel, modeOf, EFFORT, effortOf, stepEffort, capEffort } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, exCount, DAYN } from '../lib/format.js'
import { beep, vibrate } from '../lib/sound.js'
import { t } from '../lib/i18n.js'
import { api } from '../lib/api.js'
import {Thumb} from '../components/Media.jsx'
import { startFlow, exercisePicker, exConfigSheet, exerciseDetailSheet, finishWorkout, workoutCompleteSheet, confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Check, NumberField } from '../components/ui.jsx'
import { nextPrescription, applyPrescription } from '../lib/progression.js'
import { glyphOf } from '../lib/glyphs.js'
import { restPrescription } from '../lib/rest.js'
import {swapConfig,swapSessionExercise} from '../lib/session-swap.js'
import {lastLoadFor} from '../lib/history.js'
import ExerciseRecords from '../components/ExerciseRecords.jsx'

/* ---------- start chooser (no active workout) ---------- */
function StartChooser() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const todayR = effectiveRoutine(S, todayISO())
  const todayOvr = S.dayPlan[todayISO()] !== undefined
  const others = S.routines.filter(r => r !== todayR)
  return <div className="narrow">
    <div className="hdr"><div><h1>{t('Start workout')}</h1><div className="sub">{t(DAYN[new Date().getDay()])} — {todayR ? t('today is {0}', todayR.name) : t('rest day, but no one’s stopping you')}</div></div></div>
    {todayR && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="accent">{t("Today's plan")}{todayOvr ? ' · ' + t('rescheduled') : ''}</h2>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div><div className="big">{todayR.name}</div><div className="muted small">{exCount(todayR.ex.length)}</div></div>
        <span className="lrow-i" style={{ width: 38, height: 38, borderRadius: 9, fontSize: 22 }}><Icon name={glyphOf(todayR.emoji)} /></span>
      </div>
      <Button variant="primary" icon="play" onClick={() => startFlow(todayR.id)}>{t('Start {0}', todayR.name)}</Button>
    </div>}
    {others.length > 0 && <><h4 className="sec">{t('Other routines')}</h4>
      <div className="list">{others.map(r => <div key={r.id} className="item" onClick={() => startFlow(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <span className="tag acc">{t('Start')}</span></div>)}</div></>}
    <div style={{ height: 14 }} />
    <Button icon="shuffle" onClick={() => startFlow(null)}>{t('Freestyle workout (pick as you go)')}</Button>
    {!S.routines.length && <><div style={{ height: 10 }} /><Button variant="primary" onClick={() => nav('/plan')}>{t('Build a plan first')}</Button></>}
  </div>
}

/* ---------- elapsed clock (isolated so the workout tree doesn't re-render every second) ---------- */
function Elapsed({ start }) {
  const [t, setT] = useState('0:00')
  useEffect(() => {
    const tick = () => { const s = Math.floor((Date.now() - start) / 1000); setT(Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')) }
    tick(); const iv = setInterval(tick, 1000); return () => clearInterval(iv)
  }, [start])
  return <span>{t}</span>
}

/* ---------- one exercise block (reps: weight×reps · time: a held duration · cardio: duration+speed) ---------- */
function ExerciseBlock({ entryIdx, compact, onToggle, onField, onAddSet, onRemoveSet, onStartTimed, onSwap }) {
  const S = useStore(s => s.S)
  const working = useUI(s => s.work)
  const entry = S.active.entries[entryIdx]
  const ex = exOr(entry.id)
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  const cardio = mode === 'cardio'
  const timed = mode === 'time'
  const last = lastEntryFor(S, entry.id)
  const lastWeight=cardio?null:lastLoadFor(S,entry.id,mode)
  // What the progression policy decided for this session, and why (issue #17). Computed when
  // the session was built so the reason matches the numbers already in the rows.
  const plan = entry.plan
  const col1 = cardio ? { f: 'min', step: 1, dec: false, hd: t('Duration (min)') }
    : timed ? { f: 'sec', step: 5, dec: false, hd: t('Seconds') }
      : { f: 'w', step: 2.5, dec: true, hd: t('Weight ({0})', S.unit) }
  const col2 = cardio ? { f: 'speed', step: 0.5, dec: true, hd: t('Speed (km/h)') }
    : timed ? { f: 'w', step: 2.5, dec: true, hd: t('Weight ({0})', S.unit) }
      : { f: 'r', step: 1, dec: false, hd: t('Reps') }
  // Effort (RIR or RPE, whichever the profile logs) only makes sense for weighted rep sets,
  // not cardio/timed holds, and is opt-in since it adds a third stepper to every row. `opt`
  // because an unlogged effort is not the same as 0 — RIR 0 says the set went to failure.
  const kind = effortOf(S)
  const eff = EFFORT[kind]
  const rest=restPrescription(S,entry)
  const col3 = mode === 'reps' && eff ? { ...eff, eff: kind, dec: true, opt: true, hd: t(eff.hd) } : null
  // The effort column walks its own scale — see stepEffort. Weight and reps step up from 0
  // with no ceiling, as they always did.
  const bump = (s, i, col, dir) => {
    if (col.eff) return onField(i, col.f, stepEffort(col.eff, s[col.f], dir))
    onField(i, col.f, Math.max(0, Math.round(((s[col.f] || 0) + dir * col.step) * 100) / 100))
  }
  // Uses the shared stepper markup so a set row picks up the same control styling
  // as every other +/- field in the app.
  const cell = (s, i, col, cls) => (
    <div className={'stp ' + cls}>
      <button aria-label="Decrease" onClick={() => bump(s, i, col, -1)}><Icon name="minus" /></button>
      {/* a typed effort is capped — there is no RPE 12, and 12 reps in reserve is a warm-up */}
      <span className="val"><NumberField decimal={col.dec} nullable={col.opt} value={s[col.f] ?? ''}
        onChange={v => onField(i, col.f, col.eff ? capEffort(col.eff, v) : v)} /></span>
      <button aria-label="Increase" onClick={() => bump(s, i, col, 1)}><Icon name="plus" /></button>
    </div>
  )
  return <>
    <header className="exercise-heading">
      <button type="button" className="exercise-illustration-button" aria-label={'View '+ex.n+' illustrations'} onClick={()=>exerciseDetailSheet(ex)}><Thumb ex={ex}/></button>
      <div className="exercise-heading-title"><h2>{ex.n}</h2></div>
      <button className="iconbtn" aria-label={t('Details')} onClick={()=>exerciseDetailSheet(ex)}><Icon name="info"/></button>
    </header>
    <div className="exercise-actions">
      <button type="button" className="btn tinted lab-swap-button lab-replace-button" aria-label={'Replace '+ex.n+' for this workout'} disabled={!!entry.endedBySwap} onClick={onSwap}><Icon name="shuffle"/>{entry.endedBySwap?'Replaced for this workout':'Replace exercise'}</button>
    </div>
    <div className="exercise-work-body">
    {entry.swap&&<p className="small lab-swap-note">Today only · replaces {entry.swap.plannedName}. Your saved routine stays unchanged.</p>}
    {entry.addedSwaps?.map((swap,i)=><p className="small lab-swap-note" key={i}>{swap.sets} extra sets today replace {swap.plannedName}. Your saved routine stays unchanged.</p>)}
    {entry.endedBySwap&&<p className="small muted">Completed sets kept here. Log the remaining work under the replacement exercise.</p>}
    {entry.target?.notes && <div className="lab-note"><strong>Your reference:</strong> {entry.target.notes}{entry.target.needsReview && <div>Complete the missing targets here or in Plan. Only sets you check off are logged.</div>}</div>}
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      {cardio && <span className="tag acc"><Icon name="figureRun" />{t('Cardio')}</span>}
      {(ex.tg || ex.bp) && <span className="tag">{t(ex.tg || ex.bp)}</span>}
      {ex.eq && <span className="tag">{t(ex.eq)}</span>}
      {lastWeight!==null&&<span className="tag nocap">Last used: {fmtNum(lastWeight)} {S.unit}</span>}
    </div>
    <label className="exercise-rest">Rest after a set · {rest.seconds}s <select aria-label={'Rest for '+ex.n} value={S.restOverrides?.[entry.id]??''} onChange={e=>useStore.getState().update(s=>{s.restOverrides||={};if(e.target.value==='')delete s.restOverrides[entry.id];else s.restOverrides[entry.id]=Number(e.target.value)})}>
      <option value="">Auto by exercise + effort</option>{[60,90,120,150,180,210,240,300].map(sec=><option key={sec} value={sec}>{sec}s</option>)}
    </select></label>
    {last && <div className="small dim" style={{ marginBottom: 4 }}>{t('Last time')} ({fmtDate(last.d)}): {last.sets.map(s => setLabel(entry.id, s, last.target)).join(', ')}</div>}
    <ExerciseRecords id={entry.id} mode={mode} compact/>
    {plan && plan.why && plan.kind !== 'off' && <div className={'progline' + (plan.kind === 'deload' ? ' warn' : '')}>
      <Icon name={plan.kind === 'up' ? 'arrowUp' : plan.kind === 'deload' ? 'arrowDown' : 'lightbulb'} />
      <span>{t(...plan.why)}</span>
    </div>}
    <div className="card" style={{ marginTop: 10, marginBottom: 0 }}>
      {/* the header carries the same eff3 sizing as the rows, or the labels drift off their columns */}
      <div className={'sethead' + (col3 ? ' eff3' : '')}><span className="n-sp" /><span className="w-sp">{col1.hd}</span><span className="r-sp">{col2.hd}</span>{col3 && <span className="eff-sp">{col3.hd}</span>}{timed && <span className="ck-sp" />}<span className="ck-sp" /></div>
      {entry.sets.map((s, i) => <div key={i} className={'setrow' + (s.done ? ' done' : '') + (col3 ? ' eff3' : '')}>
        <div className="n">{i + 1}</div>
        {cell(s, i, col1, 'w')}
        {cell(s, i, col2, 'r')}
        {col3 && cell(s, i, col3, 'eff')}
        {/* A timed set is started, not typed: the timer counts the hold down and checks the
            set off itself. The checkbox stays for anyone who timed it on their own watch. */}
        {timed && <button className="setgo" aria-label={t('Start set')} disabled={s.done || !!working}
          onClick={() => onStartTimed(i)}><Icon name="play" /></button>}
        <Check checked={s.done} onChange={() => onToggle(i)} />
      </div>)}
      <div style={{ height: 8 }} />
      <div className="row">
        <Button size="sm" icon="minus" disabled={entry.sets.length <= 1} onClick={onRemoveSet}>{t('Remove set')}</Button>
        <Button size="sm" icon="plus" onClick={onAddSet}>{t('Add set')}</Button>
      </div>
    </div>
    </div>
  </>
}

/* ---------- active workout ---------- */
function ActiveWorkout() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const { startRest, stopRest } = useUI()
  const A = S.active
  const units = supersetUnits(A.entries)

  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  const done = setsDoneActive(A)

  const mutEntry = (idx, fn) => update(s => { fn(s.active.entries[idx]) }, true)
  const swap = index => {
    const workout=A.id,exercise=A.entries[index].id
    let picker
    picker=exercisePicker(ex=>{
      const state=useStore.getState().S,source=state.active?.entries[index]
      if(state.active?.id!==workout||source?.id!==exercise){useUI.getState().toast('The workout changed. Open Replace exercise again.');return}
      if(ex.id===exercise){useUI.getState().toast('Choose a different exercise.');return}
      picker.close()
      exConfigSheet(ex,swapConfig(state,source,ex.id),async cfg=>{
        try{
          const saved=update(s=>{swapSessionExercise(s,index,ex.id,cfg,{workout,exercise})})
          if(saved===false)return
          useUI.getState().stopWork()
          // Keep an existing rest countdown for the sets already performed.
          if(!await useStore.getState().flushLocal()){useUI.getState().toast('Could not confirm this swap in phone storage. Retry sync before leaving.');return}
          useUI.getState().toast('Swapped for this workout. Your saved routine is unchanged.')
        }catch(error){useUI.getState().toast(error.message)}
      },null,null,{sessionOnly:true})
    },{title:'Replace exercise · this workout',description:'Checked sets stay under the original exercise. Choose a replacement for the remaining work; your saved routine stays unchanged.'})
  }
  // Clearing an optional field drops the key rather than storing null, so a set only carries
  // what was actually logged — in the session, in history and in a backup.
  const setField = (idx, i, field, v) => mutEntry(idx, e => {
    if (v == null) delete e.sets[i][field]; else e.sets[i][field] = v
    if(field==='w') e.sets[i].loadConfirmed=true
  })
  const modeAt = idx => modeOf({ ...(A.entries[idx].target || {}), id: A.entries[idx].id })
  const addSet = idx => mutEntry(idx, e => {
    const l = e.sets[e.sets.length - 1]
    const m = modeOf({ ...(e.target || {}), id: e.id })
    if (m === 'cardio') e.sets.push({ min: l ? l.min : (e.target.min || 20), speed: l ? l.speed : (e.target.speed || 8), done: false })
    else if (m === 'time') e.sets.push({ sec: l ? l.sec : (e.target.sec || 45), w: l ? (l.w || 0) : (e.target.weight || 0), done: false })
    else e.sets.push({ w: l ? l.w : 0, r: l ? l.r : e.target.reps, done: false })
  })
  const removeSet = idx => mutEntry(idx, e => { if (e.sets.length > 1) e.sets.pop() })

  // A timed set is held, not typed. The work timer records what was actually held — an early
  // finish logs 0:38 of a 0:45 target rather than crediting the full prescription — and then
  // checks the set off through the normal path, so rest, supersets and the finish prompt all
  // behave exactly as they do for a reps set.
  const startTimed = (idx, i) => {
    const e = A.entries[idx]
    useUI.getState().startWork(e.sets[i].sec || 45, exOr(e.id).n, elapsed => {
      mutEntry(idx, en => { en.sets[i].sec = elapsed })
      if (!useStore.getState().S.active.entries[idx].sets[i].done) toggle(idx, i)
    })
  }

  const toggle = (idx, i) => {
    const set=A.entries[idx].sets[i]
    if(!set.done && modeAt(idx)==='reps' && (!(set.r>0) || !Number.isInteger(set.r))){useUI.getState().toast('Enter the actual whole-number reps before logging this set.');return}
    if(!set.done && A.entries[idx].target?.loadUnconfirmed && !set.loadConfirmed){useUI.getState().toast('Confirm the working weight for this set first.');return}
    const checking=!set.done
    if(mutEntry(idx,e=>{e.sets[i].done=checking;if(checking)e.sets[i].performedAt=Date.now();else delete e.sets[i].performedAt})===false)return
    if(!checking)return
    beep(S.sound,1040,0.12);vibrate(30)
    const current=useStore.getState().S.active
    const workoutDone=current.entries.every(e=>e.sets.length>0&&e.sets.every(s=>s.done))
    if(workoutDone){stopRest();workoutCompleteSheet();return}
    const group=unitOf(supersetUnits(current.entries),idx)
    const counts=group.map(j=>current.entries[j].sets.filter(s=>s.done).length)
    // Supersets rest after a round, whichever partner was logged last.
    if(group.length===1||counts.every(n=>n===counts[0])){
      const rests=group.map(j=>restPrescription(useStore.getState().S,current.entries[j],current.entries[j].sets[i]||{}))
      const rest=rests.reduce((best,r)=>r.seconds>best.seconds?r:best)
      startRest(rest.seconds,{exercise:rest.exercise,reason:rest.reason,entryId:current.entries[idx].id})
    }else stopRest()

  }

  // Live-presence heartbeat so the admin dashboard can show who's training now. Signed-in only —
  // guests have no server session. Reads fresh state each tick so progress stays current.
  useEffect(() => {
    if (!useStore.getState().user) return
    let stopped = false
    const ping = active => {
      const A2 = useStore.getState().S.active
      if (!A2) return
      const u = supersetUnits(A2.entries)
      const c = Math.min(A2.cur, Math.max(0, A2.entries.length - 1))
      const ui = u.findIndex(x => x.includes(c))
      const tot = A2.entries.reduce((n, e) => n + e.sets.length, 0)
      api('/api/activity', { method: 'POST', body: JSON.stringify({
        active, name: A2.name, exIdx: ui + 1, exTotal: u.length,
        setsDone: setsDoneActive(A2), setsTotal: tot, startedAt: A2.start
      }) }).catch(() => {})
    }
    ping(true)
    const iv = setInterval(() => { if (!stopped) ping(true) }, 20000)
    return () => {
      stopped = true; clearInterval(iv)
      // best-effort "left" signal: sendBeacon survives a tab close, fetch covers in-app nav
      try { navigator.sendBeacon?.('/api/activity', new Blob([JSON.stringify({ active: false })], { type: 'application/json' })) } catch { /* */ }
      api('/api/activity', { method: 'POST', body: JSON.stringify({ active: false }) }).catch(() => {})
    }
  }, [])

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" aria-label={t('Discard')} onClick={() => confirmSheet({ title: t('Discard workout?'), message: t('The sets you logged in this session will be lost.'), confirmText: t('Discard'), danger: true, onConfirm: () => { update(s => { s.active = null }); stopRest(); nav('/home') } })}><Icon name="xmark" /></button>
      <div style={{ textAlign: 'center' }}><div style={{ fontWeight: 600 }}>{A.name}</div><div className="sub"><Elapsed start={A.start} /> · {t('{0} sets', done + '/' + total)}</div></div>
      <button className="iconbtn" style={{ color: 'var(--acc)' }} aria-label={t('Finish')} onClick={finishWorkout}><Icon name="check" /></button>
    </div>
    <div className="wprog"><i style={{ width: (total ? done / total * 100 : 0) + '%' }} /></div>

    {A.entries.length ? <div className="session-exercises">
      <p className="muted small">All {A.entries.length} exercises · log in any order. Only checked sets count when you finish.</p>
      {units.map((group) => <section className="session-group" key={group[0]}>
        {group.length > 1 && <div className="ss-hd"><Icon name="link" />{t('Superset · do these back-to-back, rest after both')}</div>}
        {group.map(idx => <article className="session-exercise" key={idx} data-exercise-index={idx} aria-label={exOr(A.entries[idx].id).n}>
          <div className="row between small muted"><span>Exercise {idx+1} / {A.entries.length}</span><span>{A.entries[idx].sets.filter(s=>s.done).length}/{A.entries[idx].sets.length} sets</span></div>
          <ExerciseBlock entryIdx={idx} compact
            onSwap={()=>swap(idx)}
            onToggle={i=>toggle(idx,i)} onField={(i,f,v)=>setField(idx,i,f,v)}
            onAddSet={()=>addSet(idx)} onRemoveSet={()=>removeSet(idx)} onStartTimed={i=>startTimed(idx,i)}/>
        </article>)}
      </section>)}
    </div> : <div className="empty"><div className="ico"><Icon name="shuffle" /></div>{t('Freestyle workout — add your first exercise.')}</div>}
    <div style={{ height: 12 }} />
    <Button onClick={() => exercisePicker(ex => exConfigSheet(ex, null, cfg => update(s => {
      const full = { ...cfg, id: ex.id }
      const plan = nextPrescription(s, full, s.routines.find(r => r.id === s.active.routineId))
      s.active.entries.push({ id: ex.id, target: { ...cfg }, plan, sets: applyPrescription(buildSets(s, full), plan) })
      s.active.cur = s.active.entries.length - 1
    }), null, S.routines.find(r => r.id === A.routineId)))} icon="plus">{t('Add exercise')}</Button>
    <div style={{ height: 10 }} />
    {(() => {
      const exDone = A.entries.filter(e => e.sets.length && e.sets.every(s => s.done)).length
      const allDone = A.entries.length > 0 && exDone === A.entries.length
      return <button className={allDone ? 'btn primary' : 'btn ghost dim'} onClick={finishWorkout}>
        {allDone ? t('Finish workout') : t('Finish workout early · {0} exercises', exDone + '/' + A.entries.length)}
      </button>
    })()}
    <div style={{ height: 40 }} />
  </div>
}

export default function Workout() {
  const active = useStore(s => s.S.active)
  return active ? <ActiveWorkout /> : <StartChooser />
}
