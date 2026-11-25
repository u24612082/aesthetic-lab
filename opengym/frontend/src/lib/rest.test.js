import {it,expect} from 'vitest'
import {restPrescription} from './rest.js'
import {registerCustom} from './exercises.js'

registerCustom([{id:'rest-press',n:'Incline Smith Press'},{id:'rest-lateral',n:'Machine Lateral Raises'},{id:'rest-leg',n:'Bulgarian Split Squats'},{id:'rest-straight',n:'Straight-Arm Pulldown'}])
it('allocates different baselines for compounds and isolation work',()=>{
 expect(restPrescription({}, {id:'rest-lateral'}).seconds).toBe(90)
 expect(restPrescription({}, {id:'rest-press'}).seconds).toBe(150)
 expect(restPrescription({}, {id:'rest-leg'}).seconds).toBe(180)
 expect(restPrescription({}, {id:'rest-straight'}).seconds).toBe(90)
})
it('uses explicitly logged effort and low reps without inventing missing effort',()=>{
 expect(restPrescription({}, {id:'rest-press'},{r:5,rir:1}).seconds).toBe(210)
 expect(restPrescription({}, {id:'rest-lateral'},{r:12,rpe:9}).seconds).toBe(120)
 expect(restPrescription({}, {id:'rest-lateral'},{r:12}).seconds).toBe(90)
})
it('preserves explicit per-exercise overrides',()=>{
 expect(restPrescription({restOverrides:{'rest-press':120}}, {id:'rest-press'},{r:5,rir:0}).seconds).toBe(120)
})
