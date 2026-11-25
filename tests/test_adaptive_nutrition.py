import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import pytest
from aesthetic_lab.analytics import today
from aesthetic_lab.db import connect
from aesthetic_lab.body_metrics import body_metrics
from aesthetic_lab import nutrition_plan as planner

PROFILE={'phase':'lean_gain','age':30,'height_cm':180,'equation_sex':'male','activity':1.55,'starting_weight_kg':80,'automatic':True}


def weights(client,rate=0):
    data=client.get('/api/data').json()
    data['state']['bodyweight']=[{'d':str(today()-timedelta(days=13-i)),'w':80+rate*i,'t':i} for i in range(14)]
    data['state']['targetW']=85
    assert client.put('/api/data',json=data).status_code==200


def ready_plan(client,phase='lean_gain',rate=0):
    weights(client,rate)
    r=client.put('/api/nutrition/plan',json={**PROFILE,'phase':phase});assert r.status_code==200
    targets=r.json()['targets']
    f=client.post('/api/foods',json={'name':'Calibrated test food','brand':'Test fixture','kcal':500,'protein':25,'carbs':50,'fat':20,'basis':'per 100 g'}).json()['id']
    for i in range(14):
        day=str(today()-timedelta(days=i))
        assert client.post('/api/food-logs',json={'food_id':f,'grams':targets['kcal']/5,'meal':'Dinner','local_date':day,'request_id':str(uuid.uuid4())}).status_code==201
        assert client.put('/api/nutrition/day',json={'local_date':day,'complete':True}).status_code==200
    with connect() as c:c.execute('UPDATE nutrition_plan SET started_at=?,last_adjusted=?',(time.time()-15*86400,time.time()-8*86400))
    return targets


def test_setup_is_explicit_and_uses_recent_recorded_weight(client):
    assert not client.get('/api/nutrition/plan').json()['configured']
    assert client.put('/api/nutrition/plan',json={**PROFILE,'starting_weight_kg':None}).status_code==422
    weights(client)
    data=client.put('/api/nutrition/plan',json={**PROFILE,'starting_weight_kg':100}).json()
    assert data['targets']['kcal']==2900 and data['targets']['protein']==160
    assert data['estimated_maintenance_kcal']==2759
    assert 4*(data['targets']['protein']+data['targets']['carbs'])+9*data['targets']['fat']==pytest.approx(2900,abs=.3)
    assert data['assessment']['state']=='holding'
    assert data['history'][0]['reason'].startswith('Phase started')


def test_partial_days_never_count_as_complete_intake(client):
    ready_plan(client)
    with connect() as c:c.execute('DELETE FROM nutrition_days')
    result=planner.consider_adjustment({'fatigue':[]})
    assert result['intake_quality']['complete_food_days']==0
    assert result['assessment']['state']=='holding' and len(result['history'])==1


@pytest.mark.parametrize('phase,direction',[('lean_gain',1),('slow_cut',-1)])
def test_feedback_follows_phase_and_only_adjusts_once(client,phase,direction):
    old=ready_plan(client,phase)
    with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(lambda _:planner.consider_adjustment({'fatigue':[]}),range(2)))
    result=planner.plan_status();delta=result['targets']['kcal']-old['kcal']
    assert direction*delta>0 and abs(delta)<=100
    assert len(result['history'])==2
    planner.consider_adjustment({'fatigue':[]})
    assert len(planner.plan_status()['history'])==2
    assert planner.plan_status()['assessment']['state']=='holding'


def test_performance_flags_hold_additional_cut_but_not_a_protective_increase(client):
    old=ready_plan(client,'slow_cut')
    result=planner.consider_adjustment({'fatigue':[{'exercise':'Press'},{'exercise':'Row'}]})
    assert result['targets']==old and result['assessment']['state']=='holding'
    assert any('performance' in r for r in result['assessment']['reasons'])


def test_cut_raises_calories_when_scale_loss_is_too_fast(client):
    old=ready_plan(client,'slow_cut',rate=-.10)
    result=planner.consider_adjustment({'fatigue':[{},{}]})
    assert 0<result['targets']['kcal']-old['kcal']<=100


def test_phase_switch_restarts_observation_and_preserves_history(client):
    ready_plan(client)
    result=client.put('/api/nutrition/plan',json={**PROFILE,'phase':'slow_cut'}).json()
    assert result['profile']['phase']=='slow_cut' and result['targets']['protein']==176
    assert result['targets']['kcal']==2475 and result['assessment']['state']=='holding'
    assert len(result['history'])==2 and result['started_at']>time.time()-5


def test_missing_weights_adherence_and_large_swings_hold_adjustments(client):
    ready_plan(client)
    data=client.get('/api/data').json();data['state']['bodyweight']=data['state']['bodyweight'][-2:]
    client.put('/api/data',json=data)
    assert planner.plan_status()['assessment']['state']=='holding'
    weights(client,rate=.35)
    assert any('swings' in r for r in planner.plan_status()['assessment']['reasons'])
    weights(client)
    with connect() as c:c.execute('UPDATE food_logs SET kcal=kcal*.5')
    assert any('intake differs' in r for r in planner.plan_status()['assessment']['reasons'])


def test_manual_targets_pause_controller_and_day_status_replays_once(client):
    ready_plan(client)
    assert client.put('/api/nutrition/settings',json={'kcal':2600,'protein':170,'carbs':300,'fat':80}).status_code==200
    assert not planner.plan_status()['profile']['automatic']
    key=str(uuid.uuid4());payload={'kind':'day.complete','payload':{'local_date':str(today()),'complete':False},'base':{'complete':True}}
    r=client.put('/api/offline/changes/'+key,json=payload);assert r.status_code==200
    assert client.put('/api/offline/changes/'+key,json=payload).json()==r.json()
    assert planner.plan_status()['intake_quality']['complete_food_days']==13
    assert client.put('/api/offline/changes/'+str(uuid.uuid4()),json=payload).status_code==409
    assert 'nutrition_days' in client.get('/api/offline/snapshot').json()


def test_bodyweight_reaches_analytics_and_both_coach_contexts(client):
    weights(client,rate=.01)
    data=client.get('/api/dashboard').json();body=data['bodyweight']
    assert body['goal_kg']==85 and body['latest']['kg']==pytest.approx(80.13)
    assert body['change_kg_per_week']==pytest.approx(.07)
    from aesthetic_lab.subscription import snapshot
    assert snapshot()['context']['bodyweight']==body
    from aesthetic_lab.coaching import coach_status
    assert coach_status()['has_data']
    assert len(client.get('/api/offline/snapshot').json()['nutrition_plan']['bodyweight']['records'])==14


def test_weight_deduplication_and_profile_validation(client):
    state={'bodyweight':[{'d':str(today()),'w':80,'t':1},{'d':str(today()),'w':81,'t':2},{'d':'invalid','w':90},{'d':str(today()),'w':float('nan')}]}
    b=body_metrics(state=state)
    assert b['latest']['kg']==81 and len(b['records'])==1 and b['ignored_records']==2
    for patch in ({'age':17},{'height_cm':0},{'activity':1},{'equation_sex':'guess'},{'phase':'crash_cut'},{'starting_weight_kg':20}):
        assert client.put('/api/nutrition/plan',json={**PROFILE,**patch}).status_code==422


def test_irregular_weigh_ins_are_normalized_to_a_week():
    end=today();points=[]
    for days_ago in (13,12,11,2,1,0):points.append({'d':str(end-timedelta(days=days_ago)),'w':80+(13-days_ago)*.01})
    b=body_metrics(state={'bodyweight':points})
    assert b['change_kg_per_week']==pytest.approx(.07)


def test_food_correction_during_assessment_defers_the_adjustment(client,monkeypatch):
    old=ready_plan(client);original=planner.plan_status
    def changed_during_read(training=None):
        status=original(training)
        with connect() as c:c.execute('UPDATE food_logs SET kcal=kcal*.5')
        return status
    monkeypatch.setattr(planner,'plan_status',changed_during_read)
    planner.consider_adjustment({'fatigue':[]})
    with connect() as c:
        assert c.execute('SELECT kcal FROM nutrition_settings WHERE id=1').fetchone()[0]==old['kcal']
        assert c.execute('SELECT COUNT(*) FROM nutrition_plan_history').fetchone()[0]==1
