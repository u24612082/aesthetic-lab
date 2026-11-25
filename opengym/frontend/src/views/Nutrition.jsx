import {useCallback,useEffect,useRef,useState} from 'react'
import {api} from '../lib/api.js'
import {useUI} from '../store/useUI.js'
import {Button} from '../components/ui.jsx'
import LabDialog from '../components/LabDialog.jsx'
import MacroPlan from '../components/MacroPlan.jsx'
import Icon from '../components/Icon.jsx'
import {MACROS,MEALS,number,localDay,shiftDay,foodMacros,savedFood,post,LabPage,LabEmpty,LabError} from '../lib/lab-data.jsx'
import {diaryFor,prepareOffline,subscribeOffline} from '../../../../aesthetic_lab/static/offline.js'

const blankLabel={name:'',brand:'Custom',basis:'per 100 g as sold',kcal:'',protein:'',carbs:'',fat:''}
const foodTitle=f=>f.plan_name||f.name
const foodSource=f=>f.verified?'Pack label':f.provenance?.startsWith('Manufacturer reference')?'Manufacturer reference':f.brand==='USDA reference'||f.brand==='Generic reference'||f.provenance?.startsWith('Published South African')?'Reference data':f.source_url?.includes('openfoodfacts.org')?'Community label':'Estimate'

function TargetsDialog({targets,onClose,onSaved}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false)
 const save=async e=>{
  e.preventDefault();setBusy(true)
  try{const body=Object.fromEntries([...new FormData(e.currentTarget)].map(([k,v])=>[k,v===''?null:Number(v)]));await post('/api/nutrition/settings',body,'PUT');onSaved();onClose()}catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <LabDialog id="nutrition-goal-dialog" title="Daily targets" onClose={onClose}><p className="lab-copy">Set your own targets. Saving manual targets pauses automatic macro adjustments. Leave a field empty to track without a target.</p><form id="nutrition-target-form" className="lab-form" onSubmit={save}>
  {MACROS.map(k=><label key={k}>{k==='kcal'?'Calories (kcal)':k[0].toUpperCase()+k.slice(1)+' (g)'}<input name={k} type="number" inputMode="decimal" step="any" min="0.1" max={k==='kcal'?10000:k==='protein'||k==='fat'?1000:2000} defaultValue={targets[k]??''}/></label>)}
  <LabError>{error}</LabError><Button variant="primary" type="submit" disabled={busy}>{busy?'Saving…':'Save targets'}</Button>
 </form></LabDialog>
}

function FoodDialog({meal,date,log,onClose,onSaved}){
 const [tab,setTab]=useState('library'),[scope,setScope]=useState('plan'),[query,setQuery]=useState(''),[category,setCategory]=useState('')
 const [foods,setFoods]=useState([]),[settings,setSettings]=useState(null),[food,setFood]=useState(log?savedFood(log):null)
 const [grams,setGrams]=useState(log?String(log.grams):'100'),[portion,setPortion]=useState(''),[count,setCount]=useState('1')
 const [chosenMeal,setChosenMeal]=useState(log?.meal||meal),[chosenDay,setChosenDay]=useState(log?.local_date||date)
 const [label,setLabel]=useState(blankLabel),[editFood,setEditFood]=useState(null),[discovery,setDiscovery]=useState(null)
 const [busy,setBusy]=useState(false),[searching,setSearching]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(true)
 const [libraryVersion,setLibraryVersion]=useState(0)
 const requestId=useRef(crypto.randomUUID()),mounted=useRef(true)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 useEffect(()=>subscribeOffline(()=>setLibraryVersion(n=>n+1)),[])
 useEffect(()=>{let live=true;api('/api/nutrition/settings').then(s=>{if(live)setSettings(s)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[libraryVersion])
 useEffect(()=>{
  if(tab!=='library'||food)return
  let live=true
  const timer=setTimeout(async()=>{setLoading(true);try{const rows=await api(`/api/foods?q=${encodeURIComponent(query)}&view=${scope}&category=${encodeURIComponent(category)}`);if(live){setFoods(rows);setError('')}}catch(e){if(live)setError(e.message)}finally{if(live)setLoading(false)}},120)
  return()=>{live=false;clearTimeout(timer)}
 },[query,scope,category,tab,food,libraryVersion])
 const select=f=>{setFood(f);setGrams('100');setPortion('');setCount('1');setError('');requestId.current=crypto.randomUUID()}
 const portions=food?.portions||(food?.portions_json?JSON.parse(food.portions_json):[])
 const portionWeight=(value,amount)=>{setPortion(value);setCount(amount);if(value!==''&&portions[Number(value)])setGrams(String(Math.round(portions[Number(value)].grams*Number(amount||0)*10)/10))}
 const favorite=async f=>{try{await post(`/api/foods/${f.id}/favorite`,{favorite:!f.favorite},'PATCH');setFoods(rows=>scope==='favorites'&&f.favorite?rows.filter(row=>row.id!==f.id):rows.map(row=>row.id===f.id?{...row,favorite:!f.favorite}:row))}catch(e){setError(e.message)}}
 const saveLog=async e=>{
  e.preventDefault();if(!food||busy)return;setBusy(true);setError('')
  try{
   const values=new FormData(e.currentTarget),body={grams:Number(values.get('grams')),meal:values.get('meal'),local_date:values.get('local_date')}
   if(log)await post(`/api/food-logs/${log.id}`,body,'PATCH',{entryRequestId:log.request_id,entryBase:log})
   else await post('/api/food-logs',{...body,food_id:food.id,request_id:requestId.current})
   onSaved(log?'Food entry updated.':'Food saved on this device.');onClose()
  }catch(e){setError(e.message)}finally{if(mounted.current)setBusy(false)}
 }
 const saveLabel=async e=>{
  e.preventDefault();setBusy(true);setError('')
  try{const values=Object.fromEntries(new FormData(e.currentTarget));for(const k of MACROS)values[k]=Number(values[k]);const response=await post(editFood?`/api/foods/${editFood}`:'/api/foods',values,editFood?'PATCH':'POST');select(await api(`/api/foods/${response.id}`));setTab('library')}catch(e){setError(e.message)}finally{setBusy(false)}
 }
 const importBarcode=async barcode=>{setBusy(true);setError('');try{select(await post('/api/foods/barcode/'+encodeURIComponent(barcode)));setTab('library')}catch(e){setError(e.message)}finally{setBusy(false)}}
 const searchUnified=async e=>{
  e.preventDefault();const q=query.trim();if(q.length<2||searching)return
  setSearching(true);setError('');setScope('all');setCategory('')
  try{const result=await api('/api/foods/discover?q='+encodeURIComponent(q));if(mounted.current)setDiscovery({query:q,...result})}catch(e){if(mounted.current)setError(e.message)}finally{if(mounted.current)setSearching(false)}
 }
 const discovered=discovery?.query===query.trim()&&scope==='all'&&!category?discovery:null
 const downloadedCodes=new Set(foods.map(f=>f.barcode).filter(Boolean))
 const matches=[...foods,...(discovered?.foods||[]).filter(f=>!f.id&&!downloadedCodes.has(f.barcode))]
 const totals=foodMacros(food,grams)
 return <LabDialog id="food-dialog" title={log?'Edit food entry':'Log food'} onClose={onClose} step={food?'weight':tab} wide>
  <LabError>{error}</LabError>
  {!log&&<div className="lab-segments" role="group" aria-label="Food source">{[['library','Search foods'],['label','Add pack label']].map(([key,title])=><button type="button" key={key} data-food-tab={key} className={tab===key?'on':''} onClick={()=>{setTab(key);setFood(null);setError('');if(key==='label'){setLabel(blankLabel);setEditFood(null)}}}>{title}</button>)}</div>}
  {food?<><div id="selected-food" className="lab-selected-food"><div><h3>{foodTitle(food)}</h3><p>{food.brand} · {food.basis}</p></div>{!log&&<Button size="sm" onClick={()=>setFood(null)}>Change food</Button>}</div>
   <p className="lab-note">{food.provenance}{food.source_url&&<> · <a href={food.source_url} target="_blank" rel="noreferrer">Source reference</a></>}</p>
   {food.plan_note&&<p className="lab-note">{food.plan_note}</p>}
   <form id="log-form" className="lab-form" onSubmit={saveLog}>
    {!!food.plan_portions?.length&&<div><span className="lab-search-label">Quick gram weights from your plans</span><div className="lab-quick-foods" role="group" aria-label="Quick gram weights">{food.plan_portions.map(p=><button type="button" className="chip" key={p.grams} data-plan-grams={p.grams} aria-pressed={Number(grams)===p.grams} onClick={()=>{setGrams(String(p.grams));setPortion('');setCount('1')}}>{p.label}</button>)}</div></div>}
    <div className="lab-form-grid">
     {portions.length>0&&<><label>Portion<select id="portion-select" value={portion} onChange={e=>portionWeight(e.target.value,count)}><option value="">Use gram weight</option>{portions.map((p,i)=><option value={i} key={i}>{p.label} · {p.grams} g</option>)}</select></label>{portion!==''&&<label>Number of portions<input id="portion-count" type="number" inputMode="decimal" min="0.1" step="any" value={count} onChange={e=>portionWeight(portion,e.target.value)}/></label>}</>}
     <label>Weight (g)<input id="grams" name="grams" type="number" inputMode="decimal" required min="0.1" max="10000" step="any" value={grams} onChange={e=>{setGrams(e.target.value);setPortion('')}}/></label>
     <label>Meal<select name="meal" value={chosenMeal} onChange={e=>setChosenMeal(e.target.value)}>{MEALS.map(m=><option key={m}>{m}</option>)}</select></label>
     <label>Date<input id="log-date" name="local_date" type="date" required value={chosenDay} onChange={e=>setChosenDay(e.target.value)}/></label>
    </div>
    <div id="food-preview" className="lab-macro-preview">{MACROS.map(k=><div key={k}><strong>{number(totals[k],1)}{k==='kcal'?' kcal':' g'}</strong><span>{k==='kcal'?'Energy':k}</span></div>)}</div>
    <Button id="save-food-log" type="submit" variant="primary" disabled={busy}>{busy?'Saving…':log?'Save changes':'Add to diary'}</Button>
   </form>
   {!log&&<Button size="sm" onClick={()=>{setEditFood(food.id);setLabel(Object.fromEntries(Object.keys(blankLabel).map(k=>[k,food[k]??blankLabel[k]])));setFood(null);setTab('label')}}>Edit pack label</Button>}
  </>:tab==='library'?<>
   <form className="lab-unified-search" id="food-search-form" onSubmit={searchUnified}><label className="lab-search-label" htmlFor="food-filter">Food, brand or barcode</label><div className="lab-food-searchbox"><input id="food-filter" className="field" type="search" placeholder="Search food, brand or barcode" autoComplete="off" autoCapitalize="none" autoCorrect="off" enterKeyHint="search" minLength="2" maxLength="100" value={query} onChange={e=>{setQuery(e.target.value);if(scope==='plan')setScope('all')}}/><Button type="submit" variant="primary" aria-label={searching?'Searching foods':'Search all foods'} title="Search all foods" disabled={searching||query.trim().length<2}>{searching?<span aria-hidden="true">…</span>:<Icon name="magnifier"/>}</Button></div></form>
   <p className="lab-note">Downloaded foods appear as you type. Tap the search icon or Search on your keyboard for online brands and barcodes.</p>
   {!query&&<div className="lab-quick-foods">{['Coco Pops','Jungle Oats','Clover Greek','PnP milk','NutriTech vanilla','Eggs'].map(q=><button type="button" className="chip" key={q} onClick={()=>{setQuery(q);setScope('all')}}>{q}</button>)}</div>}
   <div className="lab-food-filters"><div className="lab-segments">{[['plan','Plan foods'],['all','All'],['recent','Recent'],['favorites','Favorites']].map(([value,title])=><button type="button" key={value} data-food-scope={value} className={scope===value?'on':''} onClick={()=>setScope(value)}>{title}</button>)}</div><select id="food-category" aria-label="Food category" value={category} onChange={e=>setCategory(e.target.value)}><option value="">All categories</option>{settings?.categories.map(c=><option key={c}>{c}</option>)}</select></div>
   {scope==='plan'&&<p className="lab-note">Foods from your bulk and cut plans. Choose the preparation and fat content you use. Searching above includes the whole catalogue.</p>}
   <p id="food-result-count" className="lab-note">{loading?'Searching…':`${matches.length} matches · ${number(settings?.food_count)} foods downloaded`}</p>
   {discovered&&<p className="lab-note" role="status">{discovered.message}</p>}
   <div id="food-options" className="lab-food-options">{matches.map(f=><div className="lab-food-option-row" key={f.id||f.barcode}><button type="button" className="lab-food-option" data-food-id={f.id} data-plan-food={f.plan_food||undefined} data-online-barcode={!f.id?f.barcode:undefined} disabled={busy} onClick={()=>f.id?select(f):importBarcode(f.barcode)}><span><strong>{foodTitle(f)}</strong><small>{f.brand} · {foodSource(f)} · {f.basis}</small></span><span>{number(f.kcal)}<small>kcal / 100 g</small></span></button>{f.id&&<button type="button" className="lab-icon-button lab-favorite" data-favorite-food={f.id} aria-label={(f.favorite?'Unfavorite ':'Favorite ')+f.name} aria-pressed={f.favorite} onClick={()=>favorite(f)}>{f.favorite?'★':'☆'}</button>}</div>)}{!loading&&!matches.length&&<LabEmpty>No downloaded matches. Tap the search icon for online products, or add the pack label.</LabEmpty>}</div>
  </>:tab==='label'?<><p className="lab-copy">Enter the values printed on your pack, per 100 g. This food will also be available offline.</p><form id="label-form" className="lab-form" onSubmit={saveLabel}>
   <label>Food name<input name="name" required maxLength="200" value={label.name} onChange={e=>setLabel({...label,name:e.target.value})}/></label>
   <div className="lab-form-grid"><label>Brand<input name="brand" maxLength="120" value={label.brand} onChange={e=>setLabel({...label,brand:e.target.value})}/></label><label>Weight basis<input name="basis" required maxLength="100" value={label.basis} onChange={e=>setLabel({...label,basis:e.target.value})}/></label>{MACROS.map(k=><label key={k}>{k==='kcal'?'Calories per 100 g':k+' per 100 g'}<input name={k} type="number" inputMode="decimal" required min="0" step="any" max={k==='kcal'?1000:100} value={label[k]} onChange={e=>setLabel({...label,[k]:e.target.value})}/></label>)}</div>
   <Button variant="primary" type="submit" disabled={busy}>{busy?'Saving…':'Save food label'}</Button>
  </form></>:null}
 </LabDialog>
}

export default function Nutrition(){
 const [day,setDay]=useState(localDay),[diary,setDiary]=useState(null),[dialog,setDialog]=useState(null),[goals,setGoals]=useState(false),[error,setError]=useState('')
 const version=useRef(0)
 const refresh=useCallback(async()=>{const n=++version.current;try{const data=await diaryFor(day);if(n===version.current){setDiary(data);setError('')}}catch(e){if(n===version.current)setError(e.message)}},[day])
 useEffect(()=>{void prepareOffline().catch(()=>{});void refresh();const off=subscribeOffline(refresh);return()=>{version.current++;off()}},[refresh])
 const saved=message=>{useUI.getState().toast(message||'Daily targets updated.');void refresh()}
 const repeat=async log=>{try{await post('/api/food-logs',{food_id:log.food_id,grams:log.grams,meal:log.meal,local_date:day,request_id:crypto.randomUUID()});saved('Food repeated.')}catch(e){setError(e.message)}}
 const remove=async log=>{try{await api('/api/food-logs/'+log.id,{method:'DELETE',entryRequestId:log.request_id,entryBase:log});saved('Food entry removed.')}catch(e){setError(e.message)}}
 const targets=diary?.settings.targets||{},totals=diary?.totals||{},progress=targets.kcal?Math.min(100,(totals.kcal||0)/targets.kcal*100):0
 return <LabPage title="Nutrition" subtitle="Your daily food diary. Weigh it, log it, keep moving." actions={<Button id="diary-add" variant="primary" onClick={()=>setDialog({meal:'Breakfast'})}>＋ Log food</Button>}>
  <LabError>{error}</LabError>
  <MacroPlan/>
  <div className="lab-diary-toolbar"><div className="lab-date-control"><button className="lab-icon-button" aria-label="Previous day" onClick={()=>setDay(shiftDay(day,-1))}>‹</button><input id="diary-date" aria-label="Diary date" type="date" value={day} onChange={e=>{if(e.target.value)setDay(e.target.value)}}/><button className="lab-icon-button" aria-label="Next day" onClick={()=>setDay(shiftDay(day,1))}>›</button></div><Button id="nutrition-goals" onClick={()=>setGoals(true)} disabled={!diary}>Daily targets</Button></div>
  {!diary?<LabEmpty>{error?'Connect to your Mac to download the food library.':'Loading your diary…'}</LabEmpty>:<>
   <div id="diary-stats" className="lab-nutrition-stats"><section className="lab-card lab-energy"><div><span className="lab-eyebrow">CALORIES LOGGED</span><strong>{number(totals.kcal)} <small>kcal</small></strong><p>{targets.kcal?`${number(Math.abs(targets.kcal-totals.kcal))} kcal ${targets.kcal>=totals.kcal?'remaining':'above target'}`:'Set an optional daily calorie target'}</p></div><div className="lab-energy-ring" style={{'--progress':progress+'%'}}><span>{targets.kcal?number(targets.kcal):'—'}<small>{targets.kcal?'daily target':'no target'}</small></span></div></section><div className="lab-macro-grid">{['protein','carbs','fat'].map(k=><section className="lab-card lab-macro" key={k}><span>{k}</span><strong>{number(totals[k],1)} <small>g</small></strong><small>{targets[k]?number(targets[k])+' g target':'No target set'}</small><div className="lab-track"><i style={{width:(targets[k]?Math.min(100,totals[k]/targets[k]*100):0)+'%'}}/></div></section>)}</div></div>
   <label className="lab-card lab-check lab-complete-day"><input id="nutrition-day-complete" type="checkbox" checked={!!diary.complete} disabled={!diary.logs.length} onChange={async e=>{try{await post('/api/nutrition/day',{local_date:day,complete:e.target.checked},'PUT');saved('Food-day status saved.')}catch(e){setError(e.message)}}}/><span><strong>Day fully logged</strong><small>Include meals, drinks, oils and supplements. Only complete days are used to adjust your plan; this status also saves offline.</small></span></label>
   <div id="food-diary" className="lab-meals">{MEALS.map(meal=>{const logs=diary.logs.filter(l=>l.meal===meal);return <section key={meal} className="lab-card lab-meal"><header><div><h2>{meal}</h2><span>{number(logs.reduce((n,l)=>n+l.kcal,0))} kcal</span></div><Button size="sm" data-add-meal={meal} onClick={()=>setDialog({meal})}>＋ Add food</Button></header>{logs.length?logs.map(log=><div key={log.request_id} className="food-row lab-food-row"><div><strong>{log.food_name}</strong><small>{number(log.grams,1)} g · P {number(log.protein,1)} / C {number(log.carbs,1)} / F {number(log.fat,1)}</small></div><span>{number(log.kcal)}<small>kcal</small></span><div className="lab-food-row-actions"><button className="lab-icon-button" data-edit-log={log.id} aria-label={'Edit '+log.food_name} onClick={()=>setDialog({meal,log})}>✎</button><button className="lab-icon-button" data-repeat-log={log.id} aria-label={'Repeat '+log.food_name} onClick={()=>repeat(log)}>＋</button><button className="lab-icon-button" data-delete-log={log.id} aria-label={'Remove '+log.food_name} onClick={()=>remove(log)}>×</button></div></div>):<LabEmpty>Nothing logged yet.</LabEmpty>}</section>})}</div>
   <p className="lab-note">{number(diary.settings.food_count)} foods · USDA reference and South African products. Match the raw or cooked preparation and verify branded estimates against the pack.</p>
  </>}
  {dialog&&<FoodDialog {...dialog} date={day} onClose={()=>setDialog(null)} onSaved={saved}/>}
  {goals&&<TargetsDialog targets={targets} onClose={()=>setGoals(false)} onSaved={()=>saved()}/>}
 </LabPage>
}
