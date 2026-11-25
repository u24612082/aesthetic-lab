import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach,it,expect,vi} from 'vitest'
import {registerCustom} from '../lib/exercises.js'

const fixture=vi.hoisted(()=>({state:null}))
vi.mock('../store/useStore.js',()=>({useStore:selector=>selector({S:fixture.state})}))
import ExerciseRecords from './ExerciseRecords.jsx'

beforeEach(()=>{
 fixture.state={unit:'kg',customEx:[{id:'a',n:'DB Bench Press',eq:'dumbbell'},{id:'b',n:'Dumbbell Bench Press',eq:'dumbbells'}],workouts:[
  {id:'heavy',d:'2026-10-01',entries:[{id:'a',sets:[{done:true,w:38,r:8}]}]},
  {id:'reps',d:'2026-10-02',entries:[{id:'b',sets:[{done:true,w:20,r:15}]}]},
  {id:'deload',d:'2026-11-02',entries:[{id:'b',sets:[{done:true,w:30,r:10}]}]},
 ],active:null}
 registerCustom(fixture.state.customEx)
})
it('shows the actual maximum and rep record before the collapsed history on workout cards',()=>{
 const html=renderToStaticMarkup(<ExerciseRecords id="b" compact/>),visible=html.slice(0,html.indexOf('<details'))
 expect(visible).toContain('All-time max');expect(visible).toContain('38 kg × 8 reps')
 expect(visible).toContain('Most reps');expect(visible).toContain('15 reps at 20 kg')
 expect(visible).not.toContain('38 kg × 15 reps')
 expect(html).toContain('History &amp; previous working sets')
})
it('leaves an explicit records panel when an exercise has no history',()=>{
 fixture.state.workouts=[]
 const html=renderToStaticMarkup(<ExerciseRecords id="a" compact/>)
 expect(html).toContain('All-time max');expect(html).toContain('No logged sets yet')
 expect(html).toContain('Most reps');expect(html).toContain('Not recorded yet')
})
it('keeps legacy load-only maxima distinct from sets with known reps',()=>{
 fixture.state.workouts[0].entries[0].topW=50
 const html=renderToStaticMarkup(<ExerciseRecords id="b" compact/>),visible=html.slice(0,html.indexOf('<details'))
 expect(visible).toContain('50 kg');expect(visible).toContain('reps not recorded')
 expect(visible).not.toContain('50 kg ×')
 expect(html).toContain('Heaviest complete working set: 38 kg × 8 reps')
})
it('updates the visible maximum from checked live sets without lowering it on a deload',()=>{
 fixture.state.active={id:'now',d:'2026-11-03',entries:[{id:'b',sets:[{done:true,w:40,r:5},{done:false,w:60,r:10}]}]}
 const html=renderToStaticMarkup(<ExerciseRecords id="a" compact/>)
 expect(html).toContain('40 kg × 5 reps');expect(html).not.toContain('60 kg × 10 reps')
})
it('keeps the full working-set history in the exercise details panel',()=>{
 const html=renderToStaticMarkup(<ExerciseRecords id="a"/>)
 expect(html).toContain('All-time max');expect(html).toContain('Previous working sets')
 expect(html).toContain('Best reps at each weight');expect(html).not.toContain('<details')
})
