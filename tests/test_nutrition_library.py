import pytest
from aesthetic_lab.analytics import today
from aesthetic_lab.db import connect,initialize


def test_large_reference_catalogue_has_eggs_and_real_portion_weights(client):
    settings=client.get('/api/nutrition/settings').json()
    assert settings['food_count']>=7800
    eggs=client.get('/api/foods?q=whole%20eggs%20raw').json()
    egg=next(f for f in eggs if f['name']=='Eggs · whole, raw')
    assert egg['kcal']==143 and egg['protein']==pytest.approx(12.56)
    assert next(p['grams'] for p in egg['portions'] if p['label']=='1 large')==50
    assert egg['source_url'].startswith('https://fdc.nal.usda.gov/')
    assert client.get('/api/foods?q=chicken%20breast%20raw').json()
    assert client.get('/api/foods?q=rice%20cooked').json()
    count=settings['food_count'];initialize()
    assert client.get('/api/nutrition/settings').json()['food_count']==count


def test_favorites_recent_and_categories_are_persistent(client):
    egg=next(f for f in client.get('/api/foods?q=whole%20eggs%20raw').json() if f['name']=='Eggs · whole, raw')
    assert client.patch(f"/api/foods/{egg['id']}/favorite",json={'favorite':True}).status_code==200
    assert client.get('/api/foods?view=favorites').json()[0]['id']==egg['id']
    body={'food_id':egg['id'],'grams':100,'local_date':str(today()),'meal':'Breakfast','request_id':'two-large-eggs-test'}
    assert client.post('/api/food-logs',json=body).status_code==201
    assert client.get('/api/foods?view=recent').json()[0]['id']==egg['id']
    assert client.get('/api/foods?q=eggs&category=Dairy%20and%20Egg%20Products').json()


def test_editing_grams_keeps_historical_nutrition_even_after_label_change(client):
    egg=next(f for f in client.get('/api/foods?q=whole%20eggs%20raw').json() if f['name']=='Eggs · whole, raw')
    body={'food_id':egg['id'],'grams':100,'local_date':str(today()),'meal':'Breakfast','request_id':'egg-original-snapshot'}
    log=client.post('/api/food-logs',json=body).json()
    label={k:egg[k] for k in ('name','brand','kcal','protein','carbs','fat','basis')};label['kcal']=999
    client.patch(f"/api/foods/{egg['id']}",json=label)
    assert client.patch(f"/api/food-logs/{log['id']}",json={'grams':150,'meal':'Lunch','local_date':str(today())}).status_code==200
    with connect() as c:
        saved=c.execute('SELECT * FROM food_logs WHERE id=?',(log['id'],)).fetchone()
    assert saved['kcal']==pytest.approx(214.5) and saved['protein']==pytest.approx(18.84)
    assert saved['meal']=='Lunch'


def test_daily_targets_require_explicit_valid_values(client):
    assert client.get('/api/nutrition/settings').json()['targets']['kcal'] is None
    body={'kcal':2700,'protein':180,'carbs':None,'fat':80}
    assert client.put('/api/nutrition/settings',json=body).status_code==200
    assert client.get('/api/nutrition/settings').json()['targets']==body
    from aesthetic_lab.subscription import snapshot
    assert snapshot()['context']['nutrition_targets']==body
    assert client.put('/api/nutrition/settings',json={'kcal':-1}).status_code==422
