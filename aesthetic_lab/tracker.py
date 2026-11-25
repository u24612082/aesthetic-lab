"""OpenGym frontend adapter. One authenticated personal workspace, one SQLite database."""
import hashlib
import json
import os
from datetime import datetime, timezone as utc_timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .config import timezone
from .db import connect
from .ingest import targets
from .models import SetRecord, Workout

router = APIRouter()
PROGRAM = json.loads((Path(__file__).parent/'data/program.json').read_text(encoding='utf-8'))


def initial_state():
    routines, customs = [], []
    for day, routine in enumerate(PROGRAM, 1):
        entries=[]
        for position, (name,sets,reps,weight,note,target,muscle,equipment) in enumerate(routine['exercises'],1):
            eid=f'lab-d{day}-e{position}'
            customs.append({'id':eid,'n':name,'bp': 'shoulders' if 'Deltoids' in target else 'chest' if 'Chest' in target else 'back' if target in ('Lats','Upper Back') else 'waist' if target in ('Abdominals','Serratus Anterior') else 'upper legs',
                            'tg':muscle,'eq':equipment,'sm':[],'st':[],'custom':True,'desc':note,'aestheticTarget':target})
            entries.append({'id':eid,'sets':sets or 0,'reps':reps or 0,'weight':weight or 0,'mode':'reps','prog':'off',
                            'notes':note,'needsReview':not sets or not reps,'loadUnconfirmed':weight is None})
        routines.append({'id':f'lab-day-{day}','name':routine['name'],'emoji':'dumbbell','prog':'off','ex':entries})
    return {'unit':'kg','techniqueGate':True,'restSec':90,'sound':False,'keepAwake':True,'lang':'en','theme':'dark','accent':'lime','body':'male',
            'bodyweight':[],'routines':routines,'week':{},'dayPlan':{},'exWeights':{},'workouts':[],'active':None,'customEx':customs,
            'effort':'rir','coach':None,'gifSize':'mini','reminder':{'on':False,'time':'08:00','tz':'Africa/Johannesburg'},'_ts':0}


def read_state():
    with connect() as c:
        row=c.execute('SELECT * FROM tracker_state WHERE id=1').fetchone()
        if not row:
            payload=json.dumps(initial_state())
            c.execute('INSERT OR IGNORE INTO tracker_state(id,payload,revision) VALUES (1,?,1)',(payload,))
            row=c.execute('SELECT * FROM tracker_state WHERE id=1').fetchone()
    return {'state':json.loads(row['payload']),'revision':row['revision']}


def workout_models(state):
    library={str(e['id']): e for e in state.get('customEx',[]) if isinstance(e,dict) and 'id' in e}
    output=[]
    ids=set()
    for w in state.get('workouts',[]):
        wid=str(w['id'])
        if wid in ids: raise ValueError('Duplicate workout IDs')
        ids.add(wid)
        records=[]
        for entry in w.get('entries',[]):
            exercise=library.get(str(entry.get('id')), {})
            name=exercise.get('n') or entry.get('n') or str(entry['id'])
            mode=(entry.get('target') or {}).get('mode','reps')
            for s in entry.get('sets',[]):
                if not s.get('done') or mode!='reps': continue
                if 'w' not in s or 'r' not in s: raise ValueError('Completed sets require load and reps')
                effort=s.get('rir')
                if effort is None and s.get('rpe') is not None:
                    rpe=float(s['rpe'])
                    if not 0<=rpe<=10: raise ValueError('RPE must be between 0 and 10')
                    effort=10-rpe
                records.append(SetRecord(exercise=name,reps=s['r'],load=s['w'],unit=state.get('unit','kg'),rir=effort,
                                         side=s.get('side','unknown'),warmup=s.get('warmup',False),
                                         equipment_id=str(entry['id']),resistance_mode='standard',technique=s.get('technique')))
        started=datetime.fromtimestamp(float(w['start'])/1000,utc_timezone.utc)
        ended=datetime.fromtimestamp(float(w['end'])/1000,utc_timezone.utc)
        output.append(Workout(external_id=wid,name=w['name'],started_at=started,ended_at=ended,
                              detail_level='sets' if records else 'summary',sets=records))
    return output


class StateUpdate(BaseModel):
    state: dict
    revision: int = Field(ge=1)


@router.get('/api/config')
def config():
    return {'local_workspace':True,'invite_only':True,'coach':None,'tracker':'opengym','demo':os.getenv('APP_DEMO','false').lower()=='true'}


@router.get('/api/me')
def me():
    return {'user':{'id':'local','name':'Aesthetic Lab','admin':False}}


@router.get('/api/data')
def get_data():
    return read_state()


@router.put('/api/data')
def put_data(body: StateUpdate):
    state=body.state
    try:
        if state.get('unit')!='kg': raise ValueError('This workspace records kilograms')
        for key in ('routines','customEx','workouts','bodyweight'):
            if not isinstance(state.get(key,[]),list): raise ValueError('Invalid tracker collection')
        if len(state.get('workouts',[]))>10000: raise ValueError('Workout history exceeds the supported limit')
        from datetime import date
        import math
        for point in state.get('bodyweight',[]):
            date.fromisoformat(point['d']);weight=float(point['w'])
            if not math.isfinite(weight) or not 20<=weight<=400:raise ValueError('Invalid weight')
        models=workout_models(state)
        payload=json.dumps(state,allow_nan=False)
    except (ValueError,TypeError,KeyError,OverflowError,AttributeError) as exc:
        raise HTTPException(422,'Check the tracker data: use valid set loads, reps, effort, timestamps and body weights in kilograms.') from None
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        old=c.execute('SELECT revision FROM tracker_state WHERE id=1').fetchone()
        if not old or old['revision']!=body.revision:
            raise HTTPException(409,'This tracker changed in another tab. Reload its latest version before saving your changes.')
        known=[]
        for w in models:
            known.append(w.external_id)
            digest=hashlib.sha256(w.model_dump_json().encode()).hexdigest()
            previous=c.execute("SELECT * FROM workouts WHERE source='opengym' AND external_id=?",(w.external_id,)).fetchone()
            if previous and previous['payload_hash']==digest: continue
            fields=(w.name,w.started_at.isoformat(),w.ended_at.isoformat(),w.started_at.astimezone(timezone()).date().isoformat(),w.detail_level,digest)
            if previous:
                wid=previous['id']
                c.execute('UPDATE workouts SET name=?,started_at=?,ended_at=?,local_date=?,detail_level=?,payload_hash=?,revision=revision+1 WHERE id=?',(*fields,wid))
                c.execute('DELETE FROM exercise_sets WHERE workout_id=?',(wid,))
            else:
                wid=c.execute("INSERT INTO workouts(name,started_at,ended_at,local_date,detail_level,payload_hash,source,external_id,revision) VALUES (?,?,?,?,?,?,'opengym',?,1)",(*fields,w.external_id)).lastrowid
            for i,s in enumerate(w.sets):
                target,secondary=targets(s.exercise)
                c.execute('''INSERT INTO exercise_sets(workout_id,ordinal,exercise,target,secondary,reps,load_kg,rir,warmup,side,equipment_id,resistance_mode,technique_json)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)''',(wid,i,s.exercise,target,secondary,s.reps,s.load*(0.45359237 if s.unit=='lb' else 1),s.rir,s.warmup,s.side,s.equipment_id,s.resistance_mode,s.technique.model_dump_json() if s.technique else None))
        known_set=set(known)
        for row in c.execute("SELECT id,external_id FROM workouts WHERE source='opengym'").fetchall():
            if row['external_id'] not in known_set: c.execute('DELETE FROM workouts WHERE id=?',(row['id'],))
        revision=old['revision']+1
        c.execute('UPDATE tracker_state SET payload=?,revision=? WHERE id=1',(payload,revision))
    return {'revision':revision,'saved':True}


@router.post('/api/live')
@router.post('/api/activity')
def live():
    return {'ok':True}
