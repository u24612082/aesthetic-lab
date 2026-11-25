import {EXIDX} from './exercises.js'

const words={db:'dumbbell',dumbbells:'dumbbell',bb:'barbell',barbells:'barbell',raises:'raise',laterals:'lateral',presses:'press',curls:'curl',pulldowns:'pulldown',flyes:'fly',flies:'fly',rows:'row'}
const normalize=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).map(word=>words[word]||word).join(' ')
const names={
 'db bench':'dumbbell bench press','dumbbell bench':'dumbbell bench press',
 'flat dumbbell bench press':'dumbbell bench press','dumbbell flat bench press':'dumbbell bench press',
 'incline dumbbell press':'dumbbell incline bench press','incline dumbbell bench press':'dumbbell incline bench press',
 'machine lateral':'machine lateral raise','cable lateral':'cable lateral raise',
}
const equipment=value=>{
 const name=normalize(value)
 return ['leverage machine','selectorized machine'].includes(name)?'machine':name==='cables'?'cable':name
}
export function exerciseKey(state,id,mode='reps',fallbackName){
 const exercise=(state.customEx||[]).find(row=>row.id===id)||EXIDX[id]
 const name=normalize(exercise?.n||fallbackName)
 if(!name)return 'id:'+id+'|'+mode
 return 'exercise:'+(names[name]||name)+'|'+equipment(exercise?.eq)+'|'+mode
}
export function sameExercise(state,a,b,mode='reps',fallbackName){
 return a===b||exerciseKey(state,a,mode)===exerciseKey(state,b,mode,fallbackName)
}
