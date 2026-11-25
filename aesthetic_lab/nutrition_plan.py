"""Auditable adult macro estimates and a conservative, data-gated feedback controller."""
import hashlib
import json
import math
import time
from datetime import datetime,timedelta
from statistics import mean
from typing import Literal
from pydantic import Field
from fastapi import HTTPException
from .body_metrics import body_metrics
from .config import timezone
from .db import connect
from .models import StrictModel

SOURCES=[
 {'title':'Mifflin–St Jeor: resting energy equation','url':'https://pubmed.ncbi.nlm.nih.gov/2305711/'},
 {'title':'Off-season bodybuilding nutrition review','url':'https://pmc.ncbi.nlm.nih.gov/articles/PMC6680710/'},
 {'title':'Natural bodybuilding contest-preparation review','url':'https://pmc.ncbi.nlm.nih.gov/articles/PMC4033492/'},
 {'title':'Protein and resistance training meta-analysis','url':'https://pubmed.ncbi.nlm.nih.gov/28698222/'},
]
PHASES={
 'lean_gain':{'label':'Slow lean surplus','offset':.05,'range':[.1,.25],'protein':2.0},
 'slow_cut':{'label':'Slow cut','offset':-.10,'range':[-.5,-.25],'protein':2.2},
 'maintain':{'label':'Maintenance / recomp','offset':0,'range':[-.1,.1],'protein':2.0},
}


class PlanProfile(StrictModel):
    phase:Literal['lean_gain','slow_cut','maintain']
    age:int=Field(ge=18,le=80)
    height_cm:float=Field(ge=130,le=230)
    equation_sex:Literal['male','female']
    activity:float=Field(ge=1.2,le=1.9)
    starting_weight_kg:float|None=Field(default=None,ge=20,le=400)
    automatic:bool=True


def resting_energy(profile,weight):
    return 10*weight+6.25*profile['height_cm']-5*profile['age']+(5 if profile['equation_sex']=='male' else -161)


def macro_targets(calories,weight,phase):
    protein=round(PHASES[phase]['protein']*weight)
    fat=round(max(.6*weight,calories*.25/9))
    carbs=round((calories-4*protein-9*fat)/4,1)
    if carbs<0:raise ValueError('The calorie estimate cannot support these protein and fat allocations.')
    return {'kcal':int(round(calories)),'protein':protein,'carbs':carbs,'fat':fat}


def configure(profile):
    config=profile.model_dump();body=body_metrics();latest=body['latest']
    weight=latest['kg'] if latest else config['starting_weight_kg']
    if weight is None:raise HTTPException(422,'Log your body weight in Stats or enter a starting weight to calculate your plan.')
    if latest and (datetime.now(timezone()).date()-datetime.fromisoformat(latest['date']).date()).days>14:
        weight=config['starting_weight_kg']
        if weight is None:raise HTTPException(422,'Your weight entry is over two weeks old. Log a current weight or enter a starting weight.')
    bmi=weight/(config['height_cm']/100)**2
    if not 18.5<=bmi<=40:raise HTTPException(422,'This profile is outside the automatic planner’s supported adult range. Keep manual targets and seek individual guidance.')
    maintenance=resting_energy(config,weight)*config['activity']
    calories=round(maintenance*(1+PHASES[config['phase']]['offset'])/25)*25
    if not 1500<=calories<=6000:raise HTTPException(422,'This estimate falls outside the planner’s supported 1,500–6,000 kcal range. Use individually reviewed manual targets.')
    targets=macro_targets(calories,weight,config['phase']);now=time.time()
    fingerprint=hashlib.sha256(json.dumps({'profile':config,'at':now},sort_keys=True).encode()).hexdigest()
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        old=c.execute('SELECT kcal,protein,carbs,fat FROM nutrition_settings WHERE id=1').fetchone()
        c.execute('INSERT OR REPLACE INTO nutrition_plan(id,profile,starting_weight,initial_tdee,started_at,last_adjusted) VALUES(1,?,?,?,?,?)',
                  (json.dumps(config),weight,maintenance,now,now))
        c.execute('INSERT OR REPLACE INTO nutrition_settings(id,kcal,protein,carbs,fat) VALUES(1,?,?,?,?)',tuple(targets.values()))
        c.execute('INSERT INTO nutrition_plan_history(fingerprint,created_at,before_json,after_json,reason,evidence_json) VALUES(?,?,?,?,?,?)',
                  (fingerprint,now,json.dumps(dict(old) if old else {}),json.dumps(targets),'Phase started: '+PHASES[config['phase']]['label'],json.dumps({'basis':'Mifflin–St Jeor starting estimate','weight_kg':weight,'estimated_maintenance_kcal':round(maintenance)})))
    return plan_status()


def evidence(end=None):
    end=end or datetime.now(timezone()).date();start=end-timedelta(days=13)
    with connect() as c:
        days=[dict(r) for r in c.execute('''SELECT d.local_date,COALESCE(SUM(l.kcal),0) AS kcal,
          COALESCE(SUM(l.protein),0) AS protein,COALESCE(SUM(l.carbs),0) AS carbs,COALESCE(SUM(l.fat),0) AS fat,COUNT(l.id) AS entries
          FROM nutrition_days d LEFT JOIN food_logs l ON l.local_date=d.local_date
          WHERE d.complete=1 AND d.local_date BETWEEN ? AND ? GROUP BY d.local_date ORDER BY d.local_date''',(str(start),str(end)))]
    usable=[r for r in days if r['entries'] and r['kcal']>0]
    return {'complete_food_days':len(usable),'mean_complete_day_kcal':round(mean(r['kcal'] for r in usable),1) if usable else None,
            'mean_complete_day_protein_g':round(mean(r['protein'] for r in usable),1) if usable else None,
            'complete_days':usable,'window_start':str(start),'window_end':str(end)}


def assessment(row,targets,body,intake,now=None,training=None):
    now=now or time.time();profile=json.loads(row['profile']);reasons=[]
    if not profile['automatic']:reasons.append('Automatic adjustments are paused; current targets stay in place.')
    if now-row['started_at']<14*86400:reasons.append('Collect 14 days after starting or switching a phase before adjusting.')
    if now-row['last_adjusted']<7*86400:reasons.append('Targets can change at most once every seven days.')
    if body['change_pct_per_week'] is None:reasons.append('Need at least three weigh-ins in each of the latest two weeks.')
    if intake['complete_food_days']<12:reasons.append('Need at least 12 food days marked complete in the last 14 days; partial days are excluded.')
    average=intake['mean_complete_day_kcal'];calories=targets.get('kcal')
    if not calories:reasons.append('Calorie targets are not configured.')
    elif average is not None and abs(average-calories)>max(150,calories*.1):reasons.append('Logged intake differs from the target by more than 10% or 150 kcal; first establish consistent intake.')
    recent=[r['kg'] for r in body['records'] if r['date']>=intake['window_start']]
    if recent and (max(recent)-min(recent))/mean(recent)>.04:reasons.append('Large short-term weight swings: hold and collect steadier measurements.')
    rate=body['change_pct_per_week'];low,high=PHASES[profile['phase']]['range']
    direction=0 if rate is None or low<=rate<=high else 1 if rate<low else -1
    if direction<0 and len((training or {}).get('fatigue',[]))>=2:reasons.append('Multiple comparable performance declines: hold further calorie reductions and review recovery and logging.')
    if reasons:return {'state':'holding','reasons':reasons,'calorie_delta':0,'target_rate_pct_week':[low,high]}
    if not direction:return {'state':'on_track','reasons':['The two-week scale trend is within your selected phase range.'],'calorie_delta':0,'target_rate_pct_week':[low,high]}
    weight=body['mean_7d_kg'];maintenance=resting_energy(profile,weight)*profile['activity']
    step=min(100,max(25,round(calories*.03/25)*25));new_calories=calories+direction*step
    if not max(1500,maintenance*.8)<=new_calories<=min(6000,maintenance*1.2):
        return {'state':'holding','reasons':['The adjustment reaches the estimate’s 20% guardrail. Review your activity/profile rather than increasing the automatic change.'],'calorie_delta':0,'target_rate_pct_week':[low,high]}
    return {'state':'ready','reasons':['Scale trend is outside the phase range despite sufficiently complete, consistent intake.'],'calorie_delta':direction*step,
            'targets':macro_targets(new_calories,weight,profile['phase']),'target_rate_pct_week':[low,high]}


def plan_status(training=None):
    body=body_metrics();intake=evidence()
    if body['mean_7d_kg'] and intake['mean_complete_day_protein_g'] is not None:
        intake['protein_g_per_kg']=round(intake['mean_complete_day_protein_g']/body['mean_7d_kg'],2)
    with connect() as c:
        row=c.execute('SELECT * FROM nutrition_plan WHERE id=1').fetchone()
        target_row=c.execute('SELECT kcal,protein,carbs,fat FROM nutrition_settings WHERE id=1').fetchone()
        history=[dict(r) for r in c.execute('SELECT created_at,before_json,after_json,reason,evidence_json FROM nutrition_plan_history ORDER BY id DESC LIMIT 12')]
    targets=dict(target_row) if target_row else {}
    if training is None:
        # Avoid importing dashboard: its own response includes plan context.
        training={'fatigue':[]}
    review=assessment(dict(row),targets,body,intake,training=training) if row else {'state':'not_configured','reasons':['Create a macro plan to set your phase and starting estimate.'],'calorie_delta':0}
    return {'configured':bool(row),'profile':json.loads(row['profile']) if row else None,'targets':targets,
            'estimated_maintenance_kcal':round(row['initial_tdee']) if row else None,'started_at':row['started_at'] if row else None,
            'bodyweight':body,'intake_quality':intake,'assessment':review,'history':history,'sources':SOURCES,
            'policy':'Adult starting estimates, not measured metabolism. Phase rates, ±100 kcal steps, 14-day evidence and weekly cooldown are conservative implementation choices, not a clinically validated controller.'}


def consider_adjustment(training=None):
    with connect() as c:
        version=c.execute('PRAGMA data_version').fetchone()[0]
        if training is None:
            from .analytics import dashboard
            training=dashboard(28)
        status=plan_status(training);review=status['assessment']
        if review['state']!='ready':return status
        digest=hashlib.sha256(json.dumps({k:status[k] for k in ('profile','targets','bodyweight','intake_quality')},sort_keys=True).encode()).hexdigest()
        now=time.time()
        c.execute('BEGIN IMMEDIATE')
        # Recheck on the same connection. Any concurrent commit while gathering
        # evidence defers the decision, including edits to food or weight records.
        if c.execute('PRAGMA data_version').fetchone()[0]!=version:return status
        row=c.execute('SELECT * FROM nutrition_plan WHERE id=1').fetchone()
        current=c.execute('SELECT kcal,protein,carbs,fat FROM nutrition_settings WHERE id=1').fetchone()
        if not row or now-row['last_adjusted']<7*86400 or dict(current)!=status['targets']:return status
        if json.loads(row['profile'])!=status['profile'] or not status['profile']['automatic']:return status
        if c.execute('SELECT 1 FROM nutrition_plan_history WHERE fingerprint=?',(digest,)).fetchone():return status
        after=review['targets']
        c.execute('UPDATE nutrition_settings SET kcal=?,protein=?,carbs=?,fat=? WHERE id=1',tuple(after.values()))
        c.execute('UPDATE nutrition_plan SET last_adjusted=? WHERE id=1',(now,))
        c.execute('INSERT INTO nutrition_plan_history(fingerprint,created_at,before_json,after_json,reason,evidence_json) VALUES(?,?,?,?,?,?)',
                  (digest,now,json.dumps(status['targets']),json.dumps(after),review['reasons'][0],json.dumps({'bodyweight':status['bodyweight'],'intake':status['intake_quality'],'performance_flags':training.get('fatigue',[]),'calorie_delta':review['calorie_delta']})))
    return plan_status(training)


def pause_for_manual_targets(c):
    row=c.execute('SELECT profile FROM nutrition_plan WHERE id=1').fetchone()
    if row:
        profile=json.loads(row['profile']);profile['automatic']=False
        c.execute('UPDATE nutrition_plan SET profile=? WHERE id=1',(json.dumps(profile),))
