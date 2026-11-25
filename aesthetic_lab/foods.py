import time
from collections import defaultdict, deque

import httpx
from fastapi import HTTPException
from .db import connect
import json
import re
import math
from functools import lru_cache
from pathlib import Path

FIELDS = "code,product_name,brands,nutriments,countries_tags,url"
cache = {}
calls = defaultdict(deque)


@lru_cache(maxsize=1)
def plan_food_rules():
    rows=json.loads((Path(__file__).parent/'data/diet_plan_foods.json').read_text(encoding='utf-8'))['foods']
    return {row['seed_key']:{**row,'order':i} for i,row in enumerate(rows)}


def serialise(row):
    item=dict(row)
    item['portions']=json.loads(item.pop('portions_json','[]'))
    item['favorite']=bool(item.get('favorite'))
    rule=plan_food_rules().get(item.get('seed_key'))
    item['plan_food']=bool(rule)
    if rule:
        item['plan_name']=item['name'] if item.get('verified') else rule['label']
        item['plan_order']=rule['order']
        item['plan_portions']=rule['portions']
        item['plan_note']=rule['note']
        item['search_terms']=' '.join((item.get('search_terms',''),rule['label'],rule['search_terms']))
    return item


def local_search(query='',view='all',category='',limit=60):
    with connect() as c:
        rows=[serialise(r) for r in c.execute('''SELECT f.*,recent.last_id FROM foods f LEFT JOIN
          (SELECT food_id,MAX(id) AS last_id FROM food_logs GROUP BY food_id) recent ON recent.food_id=f.id''')]
    return rank_foods(rows,query,view,category,limit)


ALIASES={'eggs':['egg'],'yoghurt':['yog'],'yogurt':['yog'],'potatoes':['potato'],
 'maize':['corn','maize'],'mielie':['corn','maize'],'pap':['cornmeal','pap'],
 'aubergine':['eggplant'],'courgette':['zucchini'],'naartjie':['tangerine'],
 'mince':['mince','ground'],'spaghetti':['spaghetti','pasta'],'spagetti':['spaghetti','pasta'],'spagheti':['spaghetti','pasta'],
 'pasta':['pasta','spaghetti','macaroni','noodle'],'nutritec':['nutritech'],'gainer':['gainer','builder'],
 'cocopops':['coco pops'],'sugarfree':['sugar free']}


def clean(value):return ' '.join(re.findall(r'[\w]+',str(value or '').lower()))


def rank_foods(rows,query='',view='all',category='',limit=60):
    phrase=' '.join({'spagetti':'spaghetti','spagheti':'spaghetti','nutritec':'nutritech'}.get(t,t) for t in clean(query).split());tokens=[ALIASES.get(t,[t]) for t in phrase.split()]
    ranked=[]
    for f in rows:
        name=clean(f.get('plan_name') or f['name']);text=clean(f"{f['name']} {f.get('brand','')} {f.get('search_terms','')} {f.get('barcode','')}")
        if category and f.get('category')!=category:continue
        if view=='favorites' and not f.get('favorite'):continue
        if view=='recent' and not f.get('last_id'):continue
        if view=='plan' and not f.get('plan_food'):continue
        if not all(any(t in text for t in group) for group in tokens):continue
        score=150*bool(f.get('favorite'))+20*bool(f.get('last_id'))+25*bool(f.get('featured'))+180*bool(f.get('plan_food'))
        if view=='plan' and not phrase:score=10000-f.get('plan_order',1000)
        if phrase:
            score+=sum(25 for group in tokens if any(t in name for t in group))
            score+=160*(name==phrase)+80*name.startswith(phrase)+40*(phrase in name)
            if any(t in phrase.split() for t in ('spaghetti','pasta')) and name.startswith('pasta'):score+=130
            category_penalty=f.get('category') in ('Baby Foods','Restaurant Foods','Fast Foods','Meals, Entrees, and Side Dishes')
            prefix=clean(f['name'].split(',')[0])
            if category_penalty and prefix not in phrase:score-=180
            undesirable=('babyfood','infant','restaurant','carrabba','applebee','fast foods','frozen meals')
            if any(t in text and t not in phrase for t in undesirable):score-=180
            if len(tokens)<=2 and any(t in name for t in ('with meat','with sauce','dinner','canned')) and not any(t in phrase for t in ('meat','sauce','dinner','canned')):score-=45
        ranked.append((-score,name,f))
    return [f for _,_,f in sorted(ranked,key=lambda item:item[:2])[:limit]]


def rate_limit(kind, maximum):
    now = time.monotonic()
    queue = calls[kind]
    while queue and queue[0] < now - 60:
        queue.popleft()
    if len(queue) >= maximum:
        raise HTTPException(429, "Open Food Facts request limit reached. Please wait a minute.")
    queue.append(now)


def product(raw):
    if not isinstance(raw,dict) or not isinstance(raw.get('product_name'),str) or not isinstance(raw.get('nutriments',{}),dict):return None
    n = dict(raw.get("nutriments") or {})
    if n.get('energy-kcal_100g') is None:
        kj=n.get('energy-kj_100g',n.get('energy_100g'))  # OFF canonical energy_100g is kJ.
        try:n['energy-kcal_100g']=float(kj)/4.184
        except (TypeError,ValueError):pass
    keys = ("energy-kcal_100g", "proteins_100g", "carbohydrates_100g", "fat_100g")
    code=str(raw.get('code',''))
    if not code.isdigit() or len(code) not in (8,12,13,14) or not raw.get("product_name") or any(n.get(k) is None for k in keys):
        return None
    try:
        values = [float(n[k]) for k in keys]
        if any(not math.isfinite(v) or v < 0 for v in values) or values[0] > 1000 or any(v > 100 for v in values[1:]) or sum(values[1:])>105:
            return None
    except (ValueError, TypeError):
        return None
    return {"barcode": code, "name": raw["product_name"][:200], "brand": (raw.get("brands") or "")[:120],
            **dict(zip(("kcal", "protein", "carbs", "fat"), values)), "basis": "per 100 g as sold",
            "provenance": "Open Food Facts · community data; verify pack and weight basis", "verified": 0,
            "source_url": f"https://world.openfoodfacts.org/product/{raw['code']}"}


async def request_off(path, params, kind):
    key = (path, tuple(sorted(params.items())))
    now = time.monotonic()
    if key in cache and now - cache[key][0] < 900:
        return cache[key][1]
    rate_limit(kind, 8 if kind == "search" else 12)
    try:
        async with httpx.AsyncClient(timeout=12, headers={"User-Agent": "AestheticLab/0.1 (local personal nutrition; https://openfoodfacts.org)"}) as client:
            response = await client.get("https://world.openfoodfacts.org" + path, params=params)
            response.raise_for_status()
            data = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, "Open Food Facts unavailable; your local catalogue still works.") from exc
    if len(cache) > 200:
        cache.clear()
    cache[key] = (now, data)
    return data


async def search(query):
    # cc controls country context; countries_tags enforces the actual country filter.
    data = await request_off("/cgi/search.pl", {"search_terms": query, "search_simple": 1, "action": "process",
        "json": 1, "cc": "za", "tagtype_0": "countries", "tag_contains_0": "contains",
        "tag_0": "south-africa", "countries_tags": "en:south-africa", "page_size": 20, "fields": FIELDS}, "search")
    return [p for raw in data.get("products", []) if "en:south-africa" in raw.get("countries_tags", []) and (p := product(raw))]


async def barcode(code):
    data = await request_off(f"/api/v2/product/{code}.json", {"fields": FIELDS, "cc": "za"}, "barcode")
    raw = data.get("product", {})
    if not raw or not raw.get('code'):raise HTTPException(404,'Barcode not found. Add the pack label to keep it available offline.')
    result = product(raw)
    if not result:
        raise HTTPException(422, "Product lacks complete gram-based nutrition. Add it from its label instead.")
    return result


async def discover(query):
    """One explicit search, globally inclusive with South African results first."""
    local=local_search(query)
    normalized=' '.join('nutritech' if t=='nutritec' else 'spaghetti' if t in ('spagetti','spagheti') else t for t in query.lower().split())
    try:
        if query.isdigit() and len(query) in (8,12,13,14):
            raw=await request_off(f'/api/v2/product/{query}.json',{'fields':FIELDS,'cc':'za'},'barcode')
            data={'products':[raw.get('product',{})]}
        else:
            data=await request_off('/cgi/search.pl',{'search_terms':normalized,'search_simple':1,'action':'process','json':1,'cc':'za','page_size':40,'fields':FIELDS},'search')
        seen={r.get('barcode') for r in local if r.get('barcode')};remote=[]
        for raw in sorted((r for r in data.get('products',[]) if isinstance(r,dict)),key=lambda r:'en:south-africa' not in (r.get('countries_tags') or [])):
            p=product(raw)
            if p and p['barcode'] not in seen:remote.append(p);seen.add(p['barcode'])
        return {'foods':local+remote,'online':True,'message':f'{len(remote)} additional complete-label products online. Verify the pack and preparation.'}
    except HTTPException as exc:
        return {'foods':local,'online':False,'message':str(exc.detail)}
