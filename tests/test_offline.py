import uuid
from aesthetic_lab.db import connect


def change(client,kind,payload,base=None,key=None):
    return client.put('/api/offline/changes/'+(key or str(uuid.uuid4())),json={'kind':kind,'payload':payload,'base':base})


def food(client):return client.get('/api/foods?q=egg').json()[0]
def log_payload(f):return {'food_id':f['id'],'request_id':str(uuid.uuid4()),'grams':100,'meal':'Breakfast','local_date':'2026-11-01'}
def snapshot(f):return {k:f[k] for k in ('name','brand','basis','kcal','protein','carbs','fat')}
def entry():
    with connect() as c:return dict(c.execute('SELECT * FROM food_logs').fetchone())


def test_snapshot_has_complete_food_library_and_no_credentials(client):
    r=client.get('/api/offline/snapshot');assert r.status_code==200
    assert len(r.json()['foods'])>=7804
    assert 'APP_TOKEN' not in r.text and 'ANTHROPIC_API_KEY' not in r.text


def test_lost_acknowledgment_retry_is_exactly_once(client):
    f=food(client);p=log_payload(f);key=str(uuid.uuid4())
    a=change(client,'log.create',p,snapshot(f),key)
    assert a.status_code==200 and change(client,'log.create',p,snapshot(f),key).json()==a.json()
    with connect() as c:assert c.execute('SELECT COUNT(*) FROM food_logs').fetchone()[0]==1
    assert change(client,'log.create',{**p,'grams':200},snapshot(f),key).status_code==409


def test_offline_custom_label_log_edit_and_delete_replay_in_order(client):
    label={'name':'My eggs','brand':'My pack','basis':'per 100 g','kcal':150,'protein':13,'carbs':1,'fat':10}
    assert change(client,'food.create',{'local_id':-1234,**label}).status_code==200
    p={**log_payload({'id':-1234})}
    assert change(client,'log.create',p,label).status_code==200
    old=entry()
    assert old['food_id']>0 and old['kcal']==150
    patch={'request_id':p['request_id'],'grams':150,'meal':'Lunch','local_date':'2026-11-01'}
    key=str(uuid.uuid4());assert change(client,'log.edit',patch,old,key).status_code==200
    assert change(client,'log.edit',patch,old,key).status_code==200
    assert entry()['kcal']==225
    assert change(client,'log.delete',{'request_id':p['request_id']},entry()).status_code==200
    with connect() as c:assert c.execute('SELECT COUNT(*) FROM food_logs').fetchone()[0]==0


def test_mac_edit_is_not_overwritten_or_deleted_by_stale_phone(client):
    f=food(client);p=log_payload(f);change(client,'log.create',p,snapshot(f));old=entry()
    assert client.patch('/api/food-logs/'+str(old['id']),json={'grams':200,'meal':'Lunch','local_date':'2026-11-01'}).status_code==200
    assert change(client,'log.delete',{'request_id':p['request_id']},old).status_code==409
    assert change(client,'log.edit',{'request_id':p['request_id'],'grams':300,'meal':'Breakfast','local_date':'2026-11-01'},old).status_code==409
    assert entry()['grams']==200


def test_phone_label_snapshot_preserved_when_mac_catalogue_changes(client):
    f=food(client);p=log_payload(f)
    with connect() as c:c.execute('UPDATE foods SET kcal=999 WHERE id=?',(f['id'],))
    assert change(client,'log.create',p,snapshot(f)).status_code==200
    assert entry()['kcal']==f['kcal']


def test_invalid_queued_entry_is_rejected_without_receipt(client):
    f=food(client);p={**log_payload(f),'grams':-3}
    assert change(client,'log.create',p,snapshot(f)).status_code==422
    with connect() as c:
        assert c.execute('SELECT COUNT(*) FROM food_logs').fetchone()[0]==0
        assert c.execute('SELECT COUNT(*) FROM offline_receipts').fetchone()[0]==0


def test_nutrition_goal_conflict_does_not_replace_mac_targets(client):
    base=client.get('/api/nutrition/settings').json()['targets']
    client.put('/api/nutrition/settings',json={'kcal':2500})
    assert change(client,'targets',{'kcal':3000},base).status_code==409
    assert client.get('/api/nutrition/settings').json()['targets']['kcal']==2500
