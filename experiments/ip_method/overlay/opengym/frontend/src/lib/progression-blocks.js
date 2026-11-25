// Experimental IP workflow. Only the separately built trial imports this module.
import {exerciseKey, sameExercise} from './exercise-identity.js'
import {buildSets, lastLoadFor, modeOf, workoutTime} from './history.js'
import {rirOf} from './effort.js'

export const STAGES = ['anchor', 'reinforce', 'transfer', 'retest', 'complete']
export const LABELS = {anchor:'Anchor', reinforce:'Reinforce', transfer:'Transfer', retest:'Retest', complete:'Complete'}
export const LIMITATIONS = ['Unknown / exploring', 'Bottom range', 'Mid range', 'Lockout / top range', 'Stability', 'Grip', 'Technique / skill', 'Other']
const copy = value => JSON.parse(JSON.stringify(value))
const exerciseId = (block, stage) => stage === 'retest' ? block.anchorId : block[stage + 'Id']
const validSets = entry => (entry?.sets || []).filter(set => set.done === true && !set.warmup && Number.isFinite(set.w) && set.w >= 0 && Number.isInteger(set.r) && set.r > 0)

export function blockSessions(state, block, stage=block.stage){
 return (state.workouts || []).filter(workout => workout.ipTrial?.blockId === block.id && workout.ipTrial.stage === stage)
  .filter(workout => (workout.entries || []).some(entry => modeOf({...entry.target,id:entry.id}) === 'reps' && sameExercise(state,exerciseId(block,stage),entry.id,'reps',entry.n) && validSets(entry).length))
  .sort((a,b) => workoutTime(a)-workoutTime(b))
}

export function anchorSets(state, block, workout){
 return (workout?.entries || []).filter(entry => modeOf({...entry.target,id:entry.id}) === 'reps' && sameExercise(state,block.anchorId,entry.id,'reps',entry.n)).flatMap(validSets)
}

export function createBlock(state, input, {now=Date.now(),id=crypto.randomUUID()}={}){
 const title=String(input.title || '').trim().slice(0,100), reason=String(input.reason || '').trim().slice(0,1200)
 if(!title || !reason) throw Error('Add a block name and the reason for your variation choice.')
 const ids=[input.anchorId,input.reinforceId,input.transferId]
 if(ids.some(id => !id) || new Set(ids.map(id => exerciseKey(state,id,'reps'))).size !== 3) throw Error('Choose three distinct exercise variations. Each keeps its own load history.')
 if(!String(input.setup || '').trim() || !String(input.rom || '').trim()) throw Error('Describe the anchor setup and range of motion so you can reproduce the test.')
 const rest=Number(input.restSeconds)
 if(!Number.isInteger(rest) || rest<30 || rest>600) throw Error('Choose an anchor rest target between 30 and 600 seconds.')
 const block={id,title,goal:String(input.goal || '').trim().slice(0,100),phase:input.phase || 'Unspecified',
  anchorId:ids[0],reinforceId:ids[1],transferId:ids[2],reason,
  limitation:LIMITATIONS.includes(input.limitation)?input.limitation:LIMITATIONS[0],
  anchorProtocol:{setup:String(input.setup).trim().slice(0,600),rom:String(input.rom).trim().slice(0,600),restSeconds:rest},
  stage:'anchor',createdAt:now,stageStarted:now,baselineId:null,retestId:null,reviews:{},events:[{stage:'anchor',at:now}]}
 state.ipBlocks ||= {}
 state.ipBlocks[id]=block
 return block
}

export function beginBlockWorkout(state, blockId, {now=Date.now(),id=crypto.randomUUID()}={}){
 const block=state.ipBlocks?.[blockId]
 if(!block || block.stage === 'complete') throw Error('Choose an active progression block.')
 if(state.active) throw Error('Finish or discard your current trial workout first.')
 const selected=exerciseId(block,block.stage)
 const routineConfig=(state.routines || []).flatMap(r=>r.ex || []).find(entry=>entry.id===selected)
 const target={id:selected,sets:3,reps:8,weight:lastLoadFor(state,selected) ?? 0,mode:'reps',prog:'off'}
 if(routineConfig){target.sets=routineConfig.sets || 3;target.reps=routineConfig.reps || 8}
 // A new variation starts with its own last load (or zero), never the anchor's load.
 const anchorStage=['anchor','retest'].includes(block.stage)
 if(anchorStage) target.restSec=block.anchorProtocol.restSeconds
 state.effort=state.effort==='rpe'?'rpe':'rir'
 state.active={id,d:new Date(now).toLocaleDateString('en-CA'),start:now,routineId:null,name:`IP trial · ${LABELS[block.stage]} · ${block.title}`,
  bw:state.bodyweight?.at(-1)?.w || null,cur:0,
  entries:[{id:selected,target,sets:buildSets(state,target)}],
  ipTrial:{blockId,stage:block.stage,phase:block.phase,protocol:anchorStage?copy(block.anchorProtocol):null}}
 return state.active
}

export function advanceBlock(state, blockId, review, now=Date.now()){
 const block=state.ipBlocks?.[blockId]
 if(!block || !STAGES.includes(block.stage) || block.stage==='complete') throw Error('Choose an active progression block.')
 if(state.active?.ipTrial?.blockId===blockId) throw Error('Finish the current trial workout before advancing.')
 const latest=blockSessions(state,block).at(-1)
 if(!latest) throw Error('Complete a workout for this stage before reviewing it.')
 if(review?.deload) throw Error('A deload stays in your log. Use a normal working session for the progression review.')
 if(['anchor','retest'].includes(block.stage) && review?.conditionsConfirmed !== true) throw Error('Confirm the recorded anchor setup, range of motion and rest before using this session as a test.')
 block.reviews[latest.id]={conditionsConfirmed:review?.conditionsConfirmed===true,deload:false,note:String(review?.note || '').trim().slice(0,1200),at:now}
 if(block.stage==='anchor') block.baselineId=latest.id
 if(block.stage==='retest') block.retestId=latest.id
 block.stage=STAGES[STAGES.indexOf(block.stage)+1]
 block.stageStarted=now
 block.events.push({stage:block.stage,at:now})
 return block
}

export function compareAnchor(state, block){
 const baseline=(state.workouts || []).find(w=>w.id===block.baselineId)
 const retest=(state.workouts || []).find(w=>w.id===block.retestId)
 const before=anchorSets(state,block,baseline),after=anchorSets(state,block,retest)
 const result={before,after,baseline,retest,kind:'insufficient',message:'Finish the anchor and return test to compare your working sets.'}
 if(!before.length || !after.length)return result
 if(baseline.ipTrial?.stage!=='anchor' || retest.ipTrial?.stage!=='retest' || baseline.ipTrial.blockId!==block.id || retest.ipTrial.blockId!==block.id)return {...result,message:'These sessions are not a matching anchor and return test.'}
 if(!block.reviews[baseline.id]?.conditionsConfirmed || !block.reviews[retest.id]?.conditionsConfirmed)return {...result,message:'Matching conditions have not been confirmed.'}
 if(block.reviews[baseline.id]?.deload || block.reviews[retest.id]?.deload || baseline.deload || retest.deload)return {...result,message:'A deload cannot establish transfer from the variation block.'}
 if(JSON.stringify(baseline.ipTrial.protocol)!==JSON.stringify(retest.ipTrial.protocol) || !baseline.ipTrial.protocol)return {...result,message:'Anchor setup, range of motion or rest targets changed. Review the sessions without a matched-test verdict.'}
 if(baseline.ipTrial.phase!==retest.ipTrial.phase)return {...result,message:'The recorded nutrition phase changed. Treat the comparison as contextual, not a matched test.'}
 const a=before[0],b=after[0],ar=rirOf(a),br=rirOf(b)
 if(ar==null || br==null || !Number.isFinite(ar) || !Number.isFinite(br) || ar<0 || br<0 || ar>4 || br>4)return {...result,message:'Record RIR or RPE on both first working sets. Missing effort cannot establish matched progress.'}
 if(Math.abs(ar-br)>0.01)return {...result,message:'The first working sets have different reported effort. Review both sessions before judging transfer.'}
 if(Math.abs(a.w-b.w)>0.001)return {...result,message:'The first-set load changed. Both sessions are shown; there is no direct rep comparison at a matched load.'}
 const delta=b.r-a.r
 return {...result,kind:delta>0?'improved':delta<0?'lower':'unchanged',delta,rir:ar,
  message:delta>0?`First working set: ${delta} more rep${delta===1?'':'s'} at the same load and reported RIR.`:delta<0?`First working set: ${Math.abs(delta)} fewer reps at the same load and reported RIR.`:'The first working set matched your baseline load, reps and reported RIR.'}
}

export function workedExample(){
 const protocol={setup:'Incline bench 30°; same dumbbells and seat position',rom:'Same controlled full range',restSeconds:180}
 const block={id:'example',title:'Upper-chest example',goal:'Upper Chest',phase:'Lean surplus',anchorId:'example-anchor',reinforceId:'example-reinforce',transferId:'example-transfer',
  limitation:'Bottom range',reason:'Illustrative hypothesis only; no limitation was measured.',anchorProtocol:protocol,stage:'complete',createdAt:1,
  baselineId:'example-before',retestId:'example-after',reviews:{'example-before':{conditionsConfirmed:true},'example-after':{conditionsConfirmed:true}}}
 const session=(id,r,stage,d)=>({id,d,start:Date.parse(d),end:Date.parse(d)+3600000,name:'Illustrative '+stage,bw:80,
  ipTrial:{blockId:'example',stage,phase:'Lean surplus',protocol},entries:[{id:'example-anchor',n:'Incline Dumbbell Press',target:{mode:'reps'},sets:[{done:true,w:30,r,rir:2}]}]})
 return {block,state:{customEx:[{id:'example-anchor',n:'Incline Dumbbell Press',eq:'dumbbell'}],workouts:[session('example-before',7,'anchor','2026-08-01'),session('example-after',9,'retest','2026-10-01')]}}
}
