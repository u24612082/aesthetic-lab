import {useLayoutEffect,useRef,useId} from 'react'
import {createPortal} from 'react-dom'

// The dialog lives outside animated route containers. Only its content scrolls;
// focusing an input cannot drag an iframe or the underlying page into view.
export default function LabDialog({id,title,onClose,children,wide=false,step}){
 const dialog=useRef(null),closeButton=useRef(null),close=useRef(onClose),titleId=useId()
 close.current=onClose
 useLayoutEffect(()=>{
  const el=dialog.current,body=document.body,html=document.documentElement
  const position={x:window.scrollX,y:window.scrollY},active=document.activeElement
  const previous=Object.fromEntries(['position','top','left','right','width','overflow'].map(k=>[k,body.style[k]]))
  const behavior=html.style.scrollBehavior,scrollbar=html.style.scrollbarGutter,route=location.hash
  const viewport=window.visualViewport
  const fit=()=>{const offset=viewport?.offsetTop||0;el.style.setProperty('--lab-viewport-height',(viewport?.height||window.innerHeight)+'px');el.style.setProperty('--lab-dialog-top',(offset+16)+'px');el.style.setProperty('--lab-dialog-offset',offset+'px')}
  fit();viewport?.addEventListener('resize',fit);viewport?.addEventListener('scroll',fit)
  html.style.scrollBehavior='auto';html.style.scrollbarGutter='stable'
  Object.assign(body.style,{position:'fixed',top:-position.y+'px',left:-position.x+'px',right:'0',width:'100%',overflow:'hidden'})
  el.showModal();closeButton.current?.focus({preventScroll:true})
  return()=>{
   viewport?.removeEventListener('resize',fit);viewport?.removeEventListener('scroll',fit)
   if(el.contains(document.activeElement))document.activeElement.blur()
   if(el.open)el.close()
   Object.assign(body.style,previous);html.style.scrollbarGutter=scrollbar
   const restore=()=>window.scrollTo({left:position.x,top:position.y,behavior:'instant'})
   restore()
   if(active?.isConnected)active.focus({preventScroll:true})
   requestAnimationFrame(()=>{if(location.hash===route)restore();html.style.scrollBehavior=behavior})
  }
 },[])
 useLayoutEffect(()=>{dialog.current?.querySelector('.lab-dialog-body')?.scrollTo({top:0,behavior:'instant'})},[step])
 return createPortal(<dialog id={id} ref={dialog} className={'lab-dialog'+(wide?' lab-dialog-wide':'')} aria-labelledby={titleId} onCancel={e=>{e.preventDefault();close.current()}} onClick={e=>{if(e.target===dialog.current){const r=dialog.current.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close.current()}}}>
  <header className="lab-dialog-head"><h2 id={titleId}>{title}</h2><button type="button" className="lab-icon-button" ref={closeButton} aria-label={'Close '+title} onClick={()=>close.current()}>×</button></header>
  <div className="lab-dialog-body">{children}</div>
 </dialog>,document.body)
}
