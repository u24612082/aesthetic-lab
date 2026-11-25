"""Local tools for the user's own Claude client; never authenticates to a model provider."""
import hashlib
import json
from collections import defaultdict

from .analytics import dashboard
from .db import connect
from .models import CoachReport
from .tracker import initial_state

CONTEXT_KEYS=('period','volume','daily','fatigue','symmetry','stats','unmapped_exercises','progression_gates','methodology','bodyweight','nutrition_plan')


def snapshot():
    """Bounded coaching evidence, without credentials, integration IDs or unchecked drafts."""
    data=dashboard(28)
    with connect() as c:
        row=c.execute('SELECT payload FROM tracker_state WHERE id=1').fetchone()
        state=json.loads(row['payload']) if row else initial_state()
        target_row=c.execute('SELECT kcal,protein,carbs,fat FROM nutrition_settings WHERE id=1').fetchone()
        rows=c.execute('''SELECT s.exercise,s.equipment_id,s.resistance_mode,s.side,s.workout_id,w.started_at,
            s.reps,s.load_kg,s.rir FROM exercise_sets s JOIN workouts w ON w.id=s.workout_id
            WHERE s.warmup=0 AND w.local_date BETWEEN ? AND ? ORDER BY w.started_at DESC,s.ordinal LIMIT 800''',
            (data['period']['start'],data['period']['end'])).fetchall()
    library={e['id']:e for e in state.get('customEx',[])}
    plan=[];planned=defaultdict(int)
    for routine in state.get('routines',[]):
        exercises=[]
        for e in routine.get('ex',[]):
            meta=library.get(e['id'],{})
            target=meta.get('aestheticTarget','Unmapped')
            planned[target]+=e.get('sets',0)
            exercises.append({'exercise':meta.get('n',e['id']),'target':target,'sets':e.get('sets'),
                              'reps':e.get('reps'),'reference_load_kg':None if e.get('loadUnconfirmed') else e.get('weight'),
                              'notes':e.get('notes',''),'targets_incomplete':e.get('needsReview',False)})
        plan.append({'name':routine['name'],'exercises':exercises})
    movements={}
    for row in rows:
        r=dict(row);key=(r['exercise'],r['equipment_id'],r['side'],r['resistance_mode'])
        if key not in movements:
            if len(movements)>=50:continue
            movements[key]={'exercise':r['exercise'],'equipment_id':r['equipment_id'],'side':r['side'],'mode':r['resistance_mode'],'sessions':{}}
        sessions=movements[key]['sessions'];wid=r['workout_id']
        if wid not in sessions and len(sessions)<2:sessions[wid]={'date':r['started_at'],'sets':[]}
        if wid in sessions and len(sessions[wid]['sets'])<8:
            sessions[wid]['sets'].append({k:r[k] for k in ('reps','load_kg','rir')})
    context={k:data[k] for k in CONTEXT_KEYS}
    if target_row and any(v is not None for v in target_row):context['nutrition_targets']=dict(target_row)
    context.update({'routine_plan':plan,'planned_direct_sets_per_rotation':dict(planned),
                    'recent_performance':[{**{k:v for k,v in m.items() if k!='sessions'},'sessions':list(m['sessions'].values())} for m in movements.values()],
                    'evidence_limits':['Plan is one rotation, not automatically a calendar week. Drafts and unchecked sets are excluded.',
                                       'Recent performance is bounded to 800 scanned working sets, 50 movements, two sessions per movement and eight sets per session.',
                                       'Scale-weight records and configured macro targets are supplied when available. Body composition, circumferences and physique photos are not supplied; scale changes cannot distinguish muscle, fat and water. Technique cannot be inferred from reps or RIR.']})
    fingerprint=hashlib.sha256(json.dumps(context,sort_keys=True).encode()).hexdigest()
    return {'context_fingerprint':fingerprint,'context':context}


def save_review(report, context_fingerprint):
    validated=CoachReport.model_validate(report)
    if len(validated.model_dump_json())>100000:raise ValueError('Keep the review under 100 KB.')
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        current=snapshot()
        if current['context_fingerprint']!=context_fingerprint:
            raise ValueError('Training, food or routine data changed. Read get_aesthetic_context again before saving.')
        data=current['context'];targets={v['target'] for v in data['volume']}
        validated.adjustments=[a for a in validated.adjustments if a.target in targets]
        if data['stats']['sessions']-data['stats']['summary_only']<3 or data['stats']['known_hard_sets']<10:
            validated.adjustments=[]
        latest=c.execute("SELECT * FROM coach_reports WHERE mode='claude_pro' ORDER BY id DESC LIMIT 1").fetchone()
        if latest and latest['fingerprint']==context_fingerprint and latest['report']==validated.model_dump_json():
            return {'saved':True,'id':latest['id'],'unchanged':True}
        rid=c.execute("INSERT INTO coach_reports(fingerprint,mode,report) VALUES (?,'claude_pro',?)",(context_fingerprint,validated.model_dump_json())).lastrowid
    return {'saved':True,'id':rid,'programme_changed':False}


def connection_status():
    current=snapshot()
    with connect() as c:
        row=c.execute("SELECT fingerprint,created_at FROM coach_reports WHERE mode='claude_pro' ORDER BY id DESC LIMIT 1").fetchone()
    return {'has_review':bool(row),'created_at':row['created_at'] if row else None,
            'stale':bool(row and row['fingerprint']!=current['context_fingerprint'])}
