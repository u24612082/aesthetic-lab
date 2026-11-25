import { useEffect } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'
import { useStore } from '../store/useStore.js'

const clock = sec => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')

// One bar, two meanings: the rest countdown between sets, and the work countdown during a
// timed set (issue #16). They are mutually exclusive by construction — startWork() stops any
// running rest — so the bar can never have to show both, and a work set gets its own colour
// plus a "Done" that logs the time actually held.
export default function RestTimer() {
  const timer = useUI(s => s.timer)
  const work = useUI(s => s.work)
  const { addRest, stopRest, finishWorkEarly, stopWork } = useUI()
  const on = work || timer
  const saved=useStore(s=>s.S.active?.restTimer)
  useEffect(()=>{
    if(!timer&&!work&&saved?.endsAt>Date.now())useUI.getState().startRest(Math.ceil((saved.endsAt-Date.now())/1000),saved,false)
  },[!!saved,!!timer,!!work])
  // A sticky dock above the app keeps the countdown visible while leaving
  // every set row and the bottom navigation available to tap.
  if (!on) return null
  const pct = (on.left / on.total) * 100

  if (work) return (
    <div className="timer-dock"><div id="timer" className="working">
      <div className="t">{clock(work.left)}</div>
      <div className="grow">
        {work.label && <div className="lbl">{work.label}</div>}
        <div className="bar"><i style={{ width: pct + '%' }} /></div>
      </div>
      <Button size="sm" onClick={stopWork}>{t('Cancel')}</Button>
      <Button size="sm" variant="primary" icon="check" onClick={finishWorkEarly}>{t('Done')}</Button>
    </div></div>
  )
  // Three controls plus the clock don't fit one line on a phone — at 360px the bar is left
  // with about 30px and stops saying anything. So the rest variant stacks: clock and bar
  // read at a glance, controls get their own row. −15 and +15 sit together in number-line
  // order; Skip is pushed to the far edge, away from the button you tap to buy more time.
  return (
    <div className="timer-dock"><div id="timer" className="rest">
      <div className="head">
        <div className="t">{clock(timer.left)}</div>
        {timer.exercise&&<div className="grow"><div className="lbl">{timer.exercise}</div><div className="small muted">{timer.reason}</div></div>}
        <div className="bar"><i style={{ width: pct + '%' }} /></div>
      </div>
      <div className="acts">
        <Button size="sm" icon="minus" onClick={() => addRest(-15)}>15s</Button>
        <Button size="sm" icon="plus" onClick={() => addRest(15)}>15s</Button>
        <Button size="sm" variant="primary" className="skip" onClick={stopRest}>{t('Skip')}</Button>
      </div>
    </div></div>
  )
}
