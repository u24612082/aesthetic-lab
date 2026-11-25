// Keep ranking semantics aligned with foods.rank_foods for the offline library.
const aliases={eggs:['egg'],yoghurt:['yog'],yogurt:['yog'],potatoes:['potato'],maize:['corn','maize'],mielie:['corn','maize'],pap:['cornmeal','pap'],aubergine:['eggplant'],courgette:['zucchini'],naartjie:['tangerine'],mince:['mince','ground'],spaghetti:['spaghetti','pasta'],spagetti:['spaghetti','pasta'],spagheti:['spaghetti','pasta'],pasta:['pasta','spaghetti','macaroni','noodle'],nutritec:['nutritech'],gainer:['gainer','builder'],cocopops:['coco pops'],sugarfree:['sugar free']}
const clean=s=>String(s||'').toLowerCase().match(/[\p{L}\p{N}_]+/gu)?.join(' ')||''
export function rankFoods(rows,query='',view='all',category='',recent=new Map(),limit=60){
 const phrase=clean(query).split(' ').map(t=>({spagetti:'spaghetti',spagheti:'spaghetti',nutritec:'nutritech'}[t]||t)).join(' '),tokens=phrase.split(' ').filter(Boolean).map(t=>aliases[t]||[t]),ranked=[]
 for(const f of rows){
  const name=clean(f.plan_name||f.name),text=clean(`${f.name} ${f.brand||''} ${f.search_terms||''} ${f.barcode||''}`)
  if(category&&f.category!==category||view==='favorites'&&!f.favorite||view==='recent'&&!recent.has(f.id)||view==='plan'&&!f.plan_food||!tokens.every(group=>group.some(t=>text.includes(t))))continue
  let score=150*!!f.favorite+20*!!recent.has(f.id)+25*!!f.featured+180*!!f.plan_food
  if(view==='plan'&&!phrase)score=10000-(f.plan_order??1000)
  if(phrase){
   score+=tokens.filter(group=>group.some(t=>name.includes(t))).length*25+160*(name===phrase)+80*name.startsWith(phrase)+40*name.includes(phrase)
   if(phrase.split(' ').some(t=>['spaghetti','pasta'].includes(t))&&name.startsWith('pasta'))score+=130
   if(['Baby Foods','Restaurant Foods','Fast Foods','Meals, Entrees, and Side Dishes'].includes(f.category)&&!phrase.includes(clean(f.name.split(',')[0])))score-=180
   if(['babyfood','infant','restaurant','carrabba','applebee','fast foods','frozen meals'].some(t=>text.includes(t)&&!phrase.includes(t)))score-=180
   if(tokens.length<=2&&['with meat','with sauce','dinner','canned'].some(t=>name.includes(t))&&!['meat','sauce','dinner','canned'].some(t=>phrase.includes(t)))score-=45
  }
  ranked.push({f,score,name})
 }
 return ranked.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)).slice(0,limit).map(r=>r.f)
}
