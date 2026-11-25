import copy
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from aesthetic_lab.app import app
from aesthetic_lab.config import timezone
from aesthetic_lab.db import connect


def completed(state, identifier='session-real'):
    start=datetime.now(timezone())-timedelta(minutes=25)
    eid=state['routines'][0]['ex'][0]['id']
    return {'id':identifier,'name':'Delts + Abs + Width','d':start.date().isoformat(),'start':int(start.timestamp()*1000),
            'end':int((start+timedelta(minutes=20)).timestamp()*1000),'entries':[{'id':eid,'target':{'mode':'reps'},'sets':[
                {'w':77,'r':12,'done':True,'rir':2},{'w':77,'r':11,'done':False}]}]}


def test_seeded_program_is_a_plan_not_workout_history(client):
    r=client.get('/api/data').json()
    assert len(r['state']['routines'])==5 and len(r['state']['customEx'])==41
    assert r['state']['unit']=='kg' and not r['state']['workouts'] and not r['state']['week']
    assert r['state']['routines'][0]['ex'][0]['weight']==77
    assert r['state']['routines'][0]['ex'][2]['weight']==0
    assert '1 from 89' in r['state']['routines'][0]['ex'][2]['notes']
    assert client.get('/api/data').json()==r
    assert client.get('/api/dashboard').json()['stats']['sessions']==0


def test_temporary_swap_logs_actual_exercise_without_editing_the_routine(client):
    r=client.get('/api/data').json();plan=copy.deepcopy(r['state']['routines'])
    workout=completed(r['state']);original=workout['entries'][0]['id']
    workout['entries'].append({'id':'0334','n':'dumbbell lateral raise','target':{'mode':'reps','sets':2},
        'swap':{'plannedId':original,'plannedName':'Machine Lateral Raises'},
        'sets':[{'w':15,'r':10,'done':True},{'w':15,'r':10,'done':False}]})
    r['state']['workouts']=[workout]
    assert client.put('/api/data',json=r).status_code==200
    saved=client.get('/api/data').json()['state']
    assert saved['routines']==plan and saved['workouts'][0]['entries'][1]['swap']['plannedId']==original
    with connect() as c:
        row=c.execute("SELECT exercise,load_kg,reps FROM exercise_sets WHERE equipment_id='0334'").fetchone()
        assert tuple(row)==('dumbbell lateral raise',15,10)


def test_complete_session_feeds_sql_analytics_without_counting_unchecked_sets(client):
    r=client.get('/api/data').json();r['state']['workouts']=[completed(r['state'])]
    assert client.put('/api/data',json=r).status_code==200
    dashboard=client.get('/api/dashboard').json()
    assert dashboard['stats']['sessions']==1 and dashboard['stats']['working_sets']==1
    assert dashboard['stats']['known_hard_sets']==1 and dashboard['stats']['tonnage_kg']==924
    assert next(g for g in dashboard['volume'] if g['target']=='Lateral Deltoids')['direct_sets']==1
    assert dashboard['progression_gates'][0]['status']=='insufficient_data'
    r['revision']+=1
    assert client.put('/api/data',json=r).status_code==200
    with connect() as c:
        assert c.execute("SELECT COUNT(*) FROM workouts WHERE source='opengym'").fetchone()[0]==1
        assert c.execute('SELECT COUNT(*) FROM exercise_sets').fetchone()[0]==1


def test_draft_workout_can_resume_without_becoming_history(client):
    r=client.get('/api/data').json();r['state']['active']=completed(r['state'])
    assert client.put('/api/data',json=r).status_code==200
    assert client.get('/api/data').json()['state']['active']['id']=='session-real'
    assert client.get('/api/dashboard').json()['stats']['sessions']==0


def test_stale_snapshot_cannot_overwrite_another_tab(client):
    r=client.get('/api/data').json();first=copy.deepcopy(r)
    first['state']['workouts']=[completed(first['state'])]
    assert client.put('/api/data',json=first).status_code==200
    r['state']['routines']=[]
    assert client.put('/api/data',json=r).status_code==409
    assert len(client.get('/api/data').json()['state']['workouts'])==1


def test_simultaneous_workout_saves_do_not_clobber(client):
    r=client.get('/api/data').json()
    def save(i):
        c=TestClient(app,base_url='http://localhost',headers=client.headers)
        snapshot=copy.deepcopy(r);snapshot['state']['workouts']=[completed(snapshot['state'],f'concurrent-{i}')]
        return c.put('/api/data',json=snapshot).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(save,range(2)))==[200,409]


def test_deleting_a_logged_session_updates_analytics(client):
    r=client.get('/api/data').json();r['state']['workouts']=[completed(r['state'])]
    assert client.put('/api/data',json=r).status_code==200
    r=client.get('/api/data').json();r['state']['workouts']=[]
    assert client.put('/api/data',json=r).status_code==200
    assert client.get('/api/dashboard').json()['stats']['sessions']==0


def test_invalid_set_rolls_back_state_and_analytics(client):
    r=client.get('/api/data').json();r['state']['workouts']=[completed(r['state'])]
    r['state']['workouts'][0]['entries'][0]['sets'][0]['r']=0
    assert client.put('/api/data',json=r).status_code==422
    assert client.get('/api/data').json()['revision']==1
    assert client.get('/api/dashboard').json()['stats']['sessions']==0
