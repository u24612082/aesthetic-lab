import {it,expect} from 'vitest'
import {nextPrescription} from './progression.js'
import {EXDB} from './exercises.js'
it('holds an automatic load jump even after all reps when technique evidence is absent',()=>{
 const id=EXDB.find(e=>e.bp==='chest').id
 const cfg={id,sets:2,reps:8,weight:50,prog:'linear',inc:2.5}
 const S={unit:'kg',techniqueGate:true,workouts:[{entries:[{id,target:cfg,sets:[{w:50,r:8,done:true},{w:50,r:8,done:true}]}]}]}
 expect(nextPrescription({...S,techniqueGate:false},cfg,{}).weight).toBe(52.5)
 const p=nextPrescription(S,cfg,{})
 expect(p.kind).toBe('hold');expect(p.weight).toBe(50)
})
