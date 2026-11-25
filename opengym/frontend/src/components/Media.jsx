import {useEffect,useState} from 'react'
import {mediaFor,areaImage} from '../../../../aesthetic_lab/static/exercise-media.js'
import {useStore} from '../store/useStore.js'
import Icon from './Icon.jsx'

function Frame({src,ex,label,lazy}){
 const [failed,setFailed]=useState(false)
 useEffect(()=>setFailed(false),[src])
 return <div className="exercise-photo-frame"><img src={failed?areaImage(ex):src} alt={ex.n+' · '+(failed?'target-area guide':label)} loading={lazy?'lazy':'eager'} decoding="async" width="360" height="250" onError={e=>{if(!failed)setFailed(true);else e.currentTarget.style.visibility='hidden'}}/><span>{failed?'Target-area guide':label}</span></div>
}

// Missing custom movements get a labelled target-area guide, never a guessed pose.
export default function Media({ex,id,compact,minimizable}){
 const media=mediaFor(ex),size=useStore(s=>s.S.gifSize),[expanded,setExpanded]=useState(size==='full'),[variant,setVariant]=useState(media.key)
 useEffect(()=>{setVariant(media.key);setExpanded(size==='full')},[media.key,size])
 const choices=[media,...media.variants],active=choices.find(v=>v.key===variant)||media
 const mini=minimizable&&!expanded
 return <figure className={'exmedia exercise-visual'+(compact&&!expanded?' compact':'')+(mini?' mini':'')+(active.kind==='illustration'?' is-illustrated':'')} id={id} data-exercise-media={media.key} data-media-kind={active.kind}>
  {choices.length>1&&<div className="exercise-media-variants" role="group" aria-label={'Image variation for '+ex.n}>{choices.map(v=><button key={v.key} type="button" aria-pressed={variant===v.key} onClick={()=>setVariant(v.key)}>{v.name}</button>)}</div>}
  <div className="exercise-photo-pair">{active.frames.map((src,i)=><Frame key={src} src={src} ex={ex} label={active.labels?.[i]||(i?'Finish':'Start')} lazy={!!minimizable}/>)}</div>
  <figcaption className="exercise-media-caption"><span>{active.kind==='area'?'Target-area guide':active.kind==='diagram'?'Movement diagram':active.kind==='illustration'?'Exercise illustration':'Movement reference'}{media.note&&<small>{media.note}</small>}</span>{minimizable&&<button type="button" onClick={()=>setExpanded(v=>!v)} aria-expanded={!mini} aria-label={(mini?'Expand ':'Minimize ')+ex.n+' images'}><Icon name={mini?'expand':'minimize'}/>{mini?'Expand':'Minimize'}</button>}</figcaption>
  {!mini&&active.source_url&&<a className="exercise-media-source" href={active.source_url} target="_blank" rel="noreferrer">{active.source}</a>}
 </figure>
}

export function Thumb({ex}){
 const media=mediaFor(ex),src=media.kind==='photo'?areaImage(ex):media.frames.at(-1),[failed,setFailed]=useState(false)
 useEffect(()=>setFailed(false),[src])
 return <img className="thumb" src={failed?areaImage(ex):src} loading="lazy" decoding="async" alt="" width="64" height="64" data-exercise-thumbnail={media.key} data-exercise-media={media.key} data-media-kind={media.kind} onError={e=>{if(!failed)setFailed(true);else e.currentTarget.style.visibility='hidden'}}/>
}
