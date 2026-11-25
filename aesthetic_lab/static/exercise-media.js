import {EXERCISE_MEDIA as DATA} from './exercise-media-data.js'
import {EXERCISE_ILLUSTRATIONS as ART} from './exercise-illustration-data.js'

export const MEDIA_CACHE='aesthetic-exercise-media-v1'
export const normalExerciseName=name=>String(name||'').toLowerCase().replace(/[^a-z0-9]/g,'').replace(/s$/,'')
const areas=new Set(['shoulders','chest','back','waist','upper legs','lower legs','upper arms','lower arms','neck','cardio'])
export const areaImage=ex=>{
 const target=String(ex?.aestheticTarget||ex?.tg||'').toLowerCase()
 const area=/tibialis|shins|calves/.test(target)?'lower legs':/serratus/.test(target)?'chest':areas.has(ex?.bp)?ex.bp:'other'
 return '/exercise-media/areas/'+area.replaceAll(' ','-')+'.svg'
}

export function mediaFor(ex){
 const rule=DATA.byName[normalExerciseName(ex?.n)]||(!ex?.custom?DATA.byId[ex?.id]:null)
 const asset=rule&&DATA.catalog[rule.asset]
 if(!asset)return {key:'area:'+ex?.bp,name:'Target-area guide',kind:'area',frames:[areaImage(ex)],labels:['Target area'],source:'Aesthetic Lab illustration',variants:[],note:'Target-area guide; a movement photo is not available for this exercise.'}
 const illustrated=(base,key,override)=>{
  const slug=override?.slug||ART.byAsset[key],art=slug&&ART.catalog[slug]
  return {...base,...(art||{}),key,artSlug:slug||null}
 }
 const override=ART.byName[normalExerciseName(ex?.n)]
 return {...illustrated(asset,rule.asset,override),note:override?.note??rule.note??'',variants:(rule.variants||[]).map(key=>illustrated(DATA.catalog[key],key)).filter(v=>v.frames?.length)}
}

export function mediaFilesFor(exercises){
 const files=new Set()
 for(const ex of exercises){const media=mediaFor(ex);for(const asset of [media,...media.variants])for(const path of asset.frames)files.add(path);files.add(areaImage(ex))}
 return [...files]
}
