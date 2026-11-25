"""Idempotent, conflict-checked replay of a phone's food changes."""
import hashlib
import json
import math
from uuid import UUID

from fastapi import HTTPException
from .db import connect
from .models import StrictModel, FoodInput, FoodLogInput, FoodLogEdit, FoodFavorite, NutritionTargets,NutritionDay
from typing import Literal


class Change(StrictModel):
    kind: Literal['log.create','log.edit','log.delete','food.create','food.edit','food.favorite','targets','day.complete']
    payload: dict
    base: dict | None = None


def replay(change_id, change):
    try:UUID(change_id)
    except ValueError:raise HTTPException(422,'Invalid change identifier') from None
    digest=hashlib.sha256(json.dumps(change.model_dump(),sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        receipt=c.execute('SELECT * FROM offline_receipts WHERE id=?',(change_id,)).fetchone()
        if receipt:
            if receipt['digest']!=digest:raise HTTPException(409,'This change identifier was already used for different data.')
            return json.loads(receipt['response'])
        p=dict(change.payload);base=change.base;kind=change.kind
        def conflict():raise HTTPException(409,'This entry changed on the Mac. Your phone copy is retained; review the pending change before syncing.')
        def check(row,fields):
            if not row or base is None:conflict()
            for k in fields:
                a,b=row[k],base.get(k)
                if isinstance(a,(float,int)) and not isinstance(a,bool) and isinstance(b,(float,int)):
                    if not math.isclose(a,b,rel_tol=1e-10,abs_tol=1e-8):conflict()
                elif a!=b:conflict()
        def food_id(value):
            if not isinstance(value,int) or isinstance(value,bool):raise HTTPException(422,'Invalid food identifier')
            if value<0:
                row=c.execute('SELECT food_id FROM offline_food_ids WHERE local_id=?',(value,)).fetchone()
                if not row:raise HTTPException(409,'The custom food must sync before its diary entry.')
                return row[0]
            return value
        if kind=='food.create':
            local_id=p.pop('local_id',None)
            if not isinstance(local_id,int) or isinstance(local_id,bool) or not -9007199254740991<=local_id<0:raise HTTPException(422,'Invalid local food identifier')
            body=FoodInput.model_validate(p)
            if c.execute('SELECT 1 FROM offline_food_ids WHERE local_id=?',(local_id,)).fetchone():raise HTTPException(409,'Local food identifier already registered.')
            fid=c.execute("INSERT INTO foods(name,brand,kcal,protein,carbs,fat,basis,provenance,verified) VALUES (?,?,?,?,?,?,?,'User supplied pack label',1)",tuple(body.model_dump().values())).lastrowid
            c.execute('INSERT INTO offline_food_ids VALUES (?,?)',(local_id,fid));result={'id':fid}
        elif kind in ('food.edit','food.favorite'):
            fid=food_id(p.pop('food_id',None));row=c.execute('SELECT * FROM foods WHERE id=?',(fid,)).fetchone()
            if kind=='food.favorite':
                body=FoodFavorite.model_validate(p);check(row,['favorite'])
                c.execute('UPDATE foods SET favorite=? WHERE id=?',(body.favorite,fid))
            else:
                body=FoodInput.model_validate(p);check(row,list(body.model_dump()))
                c.execute("UPDATE foods SET name=?,brand=?,kcal=?,protein=?,carbs=?,fat=?,basis=?,provenance='User supplied pack label',verified=1 WHERE id=?",(*body.model_dump().values(),fid))
            result={'id':fid}
        elif kind=='log.create':
            p['food_id']=food_id(p.get('food_id'));body=FoodLogInput.model_validate(p)
            old=c.execute('SELECT * FROM food_logs WHERE request_id=?',(body.request_id,)).fetchone()
            if old:
                if (old['food_id'],old['grams'],old['meal'],old['local_date'])!=(body.food_id,body.grams,body.meal,str(body.local_date)):conflict()
                result={'id':old['id']}
            else:
                food=c.execute('SELECT * FROM foods WHERE id=?',(body.food_id,)).fetchone()
                if not food:raise HTTPException(404,'Food no longer exists on the Mac.')
                snapshot=FoodInput.model_validate(base).model_dump() if base else dict(food)
                values=tuple(snapshot[k]*body.grams/100 for k in ('kcal','protein','carbs','fat'))
                lid=c.execute('INSERT INTO food_logs(request_id,food_id,local_date,meal,grams,food_name,kcal,protein,carbs,fat) VALUES (?,?,?,?,?,?,?,?,?,?)',
                              (body.request_id,body.food_id,str(body.local_date),body.meal,body.grams,snapshot['name'],*values)).lastrowid
                result={'id':lid}
        elif kind in ('log.edit','log.delete'):
            request_id=p.pop('request_id',None)
            if not isinstance(request_id,str) or not 8<=len(request_id)<=100:raise HTTPException(422,'Invalid food entry identifier')
            old=c.execute('SELECT * FROM food_logs WHERE request_id=?',(request_id,)).fetchone()
            check(old,['grams','meal','local_date','kcal','protein','carbs','fat'])
            if kind=='log.delete':
                if p:raise HTTPException(422,'Unexpected deletion fields')
                c.execute('DELETE FROM food_logs WHERE request_id=?',(request_id,));result={'deleted':True}
            else:
                body=FoodLogEdit.model_validate(p);ratio=body.grams/old['grams']
                c.execute('UPDATE food_logs SET grams=?,meal=?,local_date=?,kcal=?,protein=?,carbs=?,fat=? WHERE request_id=?',
                          (body.grams,body.meal,str(body.local_date),*(old[k]*ratio for k in ('kcal','protein','carbs','fat')),request_id));result={'saved':True}
        elif kind=='day.complete':
            body=NutritionDay.model_validate(p)
            old=c.execute('SELECT complete FROM nutrition_days WHERE local_date=?',(str(body.local_date),)).fetchone()
            check({'complete':bool(old['complete']) if old else False},['complete'])
            c.execute('INSERT OR REPLACE INTO nutrition_days(local_date,complete) VALUES(?,?)',(str(body.local_date),body.complete));result={'saved':True}
        else:
            body=NutritionTargets.model_validate(p)
            row=c.execute('SELECT kcal,protein,carbs,fat FROM nutrition_settings WHERE id=1').fetchone()
            check(dict(row) if row else {k:None for k in ('kcal','protein','carbs','fat')},['kcal','protein','carbs','fat'])
            c.execute('INSERT OR REPLACE INTO nutrition_settings(id,kcal,protein,carbs,fat) VALUES (1,?,?,?,?)',tuple(body.model_dump().values()))
            from .nutrition_plan import pause_for_manual_targets
            pause_for_manual_targets(c);result={'saved':True}
        c.execute('INSERT INTO offline_receipts(id,digest,response) VALUES (?,?,?)',(change_id,digest,json.dumps(result)))
    return result
