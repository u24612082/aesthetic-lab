import {describe,it,expect} from 'vitest'
import {mediaFor,mediaFilesFor,areaImage} from '../../../../aesthetic_lab/static/exercise-media.js'
import program from '../../../../aesthetic_lab/data/program.json'
import aliases from '../../../../aesthetic_lab/data/exercise_media_aliases.json'

describe('local exercise images',()=>{
 it('covers all 41 supplied routine entries with an actual movement image',()=>{
  for(const day of program)for(const [n] of day.exercises){const m=mediaFor({n,custom:true});expect(['illustration','diagram'],n).toContain(m.kind);expect(m.frames,n).toHaveLength(2);expect(m.frames.every(p=>p.startsWith('/exercise-media/'))).toBe(true)}
 })
 it('covers the additional standard exercises without changing their IDs',()=>{
  for(const id of Object.keys(aliases.legacy_ids))expect(mediaFor({id}).kind,id).toBe('illustration')
 })
 it('offers separate apparatus references for ambiguous exercises',()=>{
  const pec=mediaFor({n:'Reverse Pec Deck / Rear Delt Cable Fly',custom:true}),press=mediaFor({n:'Incline Smith Press',custom:true})
  expect(pec.variants[0].key).toBe('Cable_Rear_Delt_Fly');expect(press.variants[0].key).toBe('Incline_Dumbbell_Press')
  expect(pec.frames[0]).not.toBe(pec.variants[0].frames[0])
 })
 it('labels unsupported custom exercises instead of guessing a similar movement',()=>{
  const ex={id:'0025',n:'My entirely new movement',custom:true,bp:'shoulders',img:'https://example.com/untrusted.jpg'},m=mediaFor(ex)
  expect(m.kind).toBe('area');expect(m.frames[0]).toBe('/exercise-media/areas/shoulders.svg')
 })
 it('prepares every apparatus variation and fallback without duplicate downloads',()=>{
  const ex={n:'Incline Smith Press',custom:true,bp:'chest'},files=mediaFilesFor([ex,ex])
  expect(files).toHaveLength(5);expect(files.some(p=>p.includes('incline-db-press'))).toBe(true)
 })
 it('uses the recorded target for shins even with an older broad leg category',()=>{
  expect(areaImage({bp:'upper legs',tg:'shins',aestheticTarget:'Tibialis Anterior'})).toBe('/exercise-media/areas/lower-legs.svg')
 })
})
