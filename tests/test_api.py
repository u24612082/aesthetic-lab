from concurrent.futures import ThreadPoolExecutor
from fastapi.testclient import TestClient

from aesthetic_lab.app import app
from aesthetic_lab.db import connect


def test_sync_status_distinguishes_pairing_from_received_data(client,batch):
    status=client.get('/api/status').json()
    assert status['workout_sync']['state']=='no_data_received'
    assert status['workout_sync']['last_received_at'] is None
    assert not status['inbox_enabled']
    workout=batch['workouts'][0]
    sets=workout['sets']
    workout['detail_level']='summary';workout['sets']=[]
    assert client.post('/api/ingest/workouts',json=batch).status_code==200
    sync=client.get('/api/status').json()['workout_sync']
    assert sync['state']=='summaries_received' and sync['detailed_workouts']==0
    assert sync['last_received_at'] is not None
    workout['detail_level']='sets';workout['sets']=sets;workout['revision']=2
    assert client.post('/api/ingest/workouts',json=batch).status_code==200
    sync=client.get('/api/status').json()['workout_sync']
    assert sync['state']=='set_data_received' and sync['received_workouts']==1 and sync['detailed_workouts']==1


def test_private_endpoints_and_origin_guard():
    c=TestClient(app,base_url="http://localhost")
    assert c.get('/').status_code==200
    assert c.get('/api/health').status_code==200
    assert c.get('/api/dashboard').status_code==401
    assert c.get('/api/schema').status_code==401
    assert c.post('/api/login',json={"token":"💪"}).status_code==401
    assert c.post('/api/login',json={"token":"test-only-secret-"+"x"*40},headers={"Origin":"http://evil.example"}).status_code==403
    assert c.get('/api/health',headers={"Host":"evil.example"}).status_code==400
    assert c.post('/api/login',json={"token":"test-only-secret-"+"x"*40}).status_code==200
    r=c.get('/api/dashboard')
    assert r.status_code==200 and r.headers['Cache-Control']=='no-store'
    assert 'HttpOnly' in c.post('/api/login',json={"token":"test-only-secret-"+"x"*40}).headers['set-cookie']


def test_request_size_limit(client):
    assert client.post('/api/ingest/workouts',content=b'x'*2_000_001).status_code==413


def test_food_weight_snapshots_and_idempotency(client):
    food=client.get('/api/foods').json()[0]
    body={"request_id":"stable-food-uuid", "food_id":food['id'], "local_date":"2026-10-31", "meal":"Dinner", "grams":250}
    assert client.post('/api/food-logs',json=body).status_code==201
    assert client.post('/api/food-logs',json=body).json()['unchanged']
    body['grams']=300
    assert client.post('/api/food-logs',json=body).status_code==409
    label={k:food[k] for k in ('name','brand','kcal','protein','carbs','fat','basis')}
    label['kcal']=999
    assert client.patch(f"/api/foods/{food['id']}",json=label).status_code==200
    data=client.get('/api/dashboard?days=7&end=2026-10-31').json()
    assert len(data['food_logs'])==1
    assert data['food_logs'][0]['kcal']==food['kcal']*2.5
    assert client.delete(f"/api/food-logs/{data['food_logs'][0]['id']}").status_code==200


def test_concurrent_phone_and_mac_food_writes(client):
    food=client.get('/api/foods').json()[0]
    def write(i):
        c=TestClient(app,base_url="http://localhost",headers=client.headers)
        return c.post('/api/food-logs',json={"request_id":f"concurrent-{i}","food_id":food['id'],"grams":100,"local_date":"2026-10-31","meal":"Lunch"}).status_code
    with ThreadPoolExecutor(max_workers=6) as pool:
        assert list(pool.map(write,range(18)))==[201]*18
    with connect() as c:
        assert c.execute('SELECT COUNT(*) FROM food_logs').fetchone()[0]==18


def test_off_filter_registration_and_missing_nutrients(client,monkeypatch):
    from aesthetic_lab import foods
    calls=[]
    async def fake(path,params,kind):
        calls.append(params)
        p={"code":"6001234567890","product_name":"Test oats","brands":"ZA test","countries_tags":["en:south-africa"],"nutriments":{"energy-kcal_100g":380,"proteins_100g":12,"carbohydrates_100g":60,"fat_100g":7}}
        if kind=='barcode':return {'product':p}
        wrong=dict(p,countries_tags=['en:france'])
        incomplete=dict(p,nutriments={})
        return {'products':[p,wrong,incomplete]}
    monkeypatch.setattr(foods,'request_off',fake)
    result=client.get('/api/foods/search/za?q=oats')
    assert result.status_code==200 and len(result.json())==1
    assert calls[0]['cc']=='za' and calls[0]['countries_tags']=='en:south-africa'
    assert client.post('/api/foods/barcode/6001234567890').status_code==200
    assert client.post('/api/foods/barcode/6001234567890').status_code==200
    assert client.post('/api/foods/barcode/abc').status_code==422
    with connect() as c:
        assert c.execute('SELECT COUNT(*) FROM foods WHERE barcode=?',('6001234567890',)).fetchone()[0]==1
