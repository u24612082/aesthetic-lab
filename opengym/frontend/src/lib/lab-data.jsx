import {useCallback,useEffect,useRef,useState} from 'react'
import {api} from './api.js'
import {useStore} from '../store/useStore.js'

export const MACROS=['kcal','protein','carbs','fat']
export const MEALS=['Breakfast','Lunch','Dinner','Snacks']
export const number=(value,digits=0)=>new Intl.NumberFormat('en-ZA',{maximumFractionDigits:digits}).format(value||0)
export const localDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
export function shiftDay(day,amount){const d=new Date(day+'T12:00:00');d.setDate(d.getDate()+amount);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
export const dateLabel=day=>new Intl.DateTimeFormat('en-ZA',{day:'numeric',month:'short'}).format(new Date(day.slice(0,10)+'T12:00:00'))
export function foodMacros(food,grams){return Object.fromEntries(MACROS.map(k=>[k,Number(food?.[k]||0)*Number(grams||0)/100]))}
export function savedFood(log){return {id:log.food_id,name:log.food_name,brand:'Saved diary entry',basis:'per 100 g of original entry',provenance:'Quantity changes preserve the original nutrient snapshot.',portions:[],...Object.fromEntries(MACROS.map(k=>[k,log[k]/log.grams*100]))}}
export const post=(path,body={},method='POST',options={})=>api(path,{...options,method,body:JSON.stringify(body)})

export function useLabResource(path,interval=60000){
 const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),version=useRef(0),pending=useRef(false)
 const refresh=useCallback(async()=>{
  if(pending.current)return
  pending.current=true
  const current=++version.current
  try{const value=await api(path);if(current===version.current){setData(value);setError('')}}
  catch(e){if(current===version.current){setError(e.message);if(e.status===401)useStore.getState().setUser(null)}}
  finally{if(current===version.current){setLoading(false);pending.current=false}}
 },[path])
 useEffect(()=>{
  setData(null);setLoading(true);void refresh()
  const retry=()=>{if(!document.hidden)void refresh()}
  const timer=interval?setInterval(retry,interval):null
  window.addEventListener('online',retry);window.addEventListener('focus',retry)
  return()=>{version.current++;pending.current=false;clearInterval(timer);window.removeEventListener('online',retry);window.removeEventListener('focus',retry)}
 },[refresh,interval])
 return {data,error,loading,refresh}
}

export function LabError({children}){return children?<p className="lab-message lab-message-error" role="alert">{children}</p>:null}
export function LabEmpty({children}){return <p className="lab-empty">{children}</p>}
export function LabPage({title,subtitle,actions,children}){return <section className="lab-native-page"><header className="lab-page-heading"><div><h1>{title}</h1><p>{subtitle}</p></div>{actions&&<div className="lab-page-actions">{actions}</div>}</header>{children}</section>}
