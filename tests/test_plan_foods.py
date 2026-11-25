import pytest

from aesthetic_lab.db import initialize


@pytest.mark.parametrize('query',[
    'Coco Pops','cocopops','Jungle Oats','milk','Greek yoghurt','protein powder',
    'banana','fruit','eggs','rice cooked','rice dry','rice cakes',
    'chocolate hazelnut spread','chicken breast','veggies','spaghetti dry',
    'tomato sauce','cheese','honey','olive oil','cooking spray','sugarfree syrup',
    'black coffee','energy drink','creatine','water','salt',
])
def test_every_plan_ingredient_is_available_without_online_search(client,query):
    rows=client.get('/api/foods',params={'q':query}).json()
    assert any(f['plan_food'] for f in rows[:6]),query


def test_plan_collection_has_quick_weights_and_distinct_preparations(client):
    rows=client.get('/api/foods?view=plan').json()
    assert len(rows)==32 and rows[0]['plan_name']=='Coco Pops · dry'
    by_key={f['seed_key']:f for f in rows}
    cooked=by_key['usda-sr-168878'];dry=by_key['usda-sr-168877']
    assert cooked['id']!=dry['id'] and cooked['kcal']==130 and dry['kcal']==365
    assert {p['grams'] for p in cooked['plan_portions']}=={80,100,150,250,300}
    assert {p['grams'] for p in by_key['usda-sr-169736']['plan_portions']}=={50,120,150}
    assert by_key['diet-clover-authentikos-plain']['protein']==5.5
    assert by_key['diet-pnp-low-fat-uht']['fat']==1
    powder=by_key['diet-nutritech-premium-mass-vanilla']
    assert not powder['plan_portions'] and 'scoop' in powder['plan_note']
    assert by_key['usda-sr-171430']['kcal']>0  # Spray oil is not calorie-free.
    assert by_key['usda-sr-169878']['kcal']>0  # Sugar-free syrup is not assumed zero.


def test_users_actual_brands_rank_ahead_of_generic_substitutes(client):
    for query,key in [('clover greek','diet-clover-authentikos-plain'),
                      ('pnp milk','diet-pnp-low-fat-uht'),
                      ('nutritech premium mass vanilla soft serve','diet-nutritech-premium-mass-vanilla')]:
        f=client.get('/api/foods',params={'q':query}).json()[0]
        assert f['seed_key']==key and f['plan_food'] and not f['verified']
    yoghurt=client.get('/api/foods?q=clover%20greek').json()[0]
    assert yoghurt['kcal']==pytest.approx(383/4.184,abs=.01)
    assert yoghurt['protein']==5.5
    gainer=client.get('/api/foods?q=nutritech%20vanilla').json()[0]
    assert gainer['protein']==37.5 and gainer['carbs']==50
    assert 'not independently verified' in gainer['provenance']


def test_reseeding_preserves_corrected_pack_labels_favorites_and_targets(client):
    food=client.get('/api/foods?q=Coco%20Pops').json()[0]
    label={k:food[k] for k in ('name','brand','kcal','protein','carbs','fat','basis')}
    label.update(name='My current Coco Pops pack',kcal=340)
    assert client.patch(f"/api/foods/{food['id']}",json=label).status_code==200
    client.patch(f"/api/foods/{food['id']}/favorite",json={'favorite':True})
    client.put('/api/nutrition/settings',json={'kcal':2600,'protein':170})
    count=client.get('/api/nutrition/settings').json()['food_count']
    initialize();initialize()
    saved=client.get(f"/api/foods/{food['id']}").json()
    assert saved['kcal']==340 and saved['verified'] and saved['favorite']
    assert saved['plan_name']=='My current Coco Pops pack'
    settings=client.get('/api/nutrition/settings').json()
    assert settings['food_count']==count and settings['targets']['kcal']==2600
    assert not client.get('/api/offline/snapshot').json()['logs']


def test_plan_weights_scale_the_reference_and_metadata_is_downloaded(client):
    snapshot=client.get('/api/offline/snapshot').json()
    foods=[f for f in snapshot['foods'] if f['plan_food']]
    assert len(foods)==32 and all('plan_portions' in f for f in foods)
    # Already paired phones also receive the collection through ordinary sync,
    # even if an older full-catalogue download is still considered recent.
    updates=client.get('/api/offline/diary').json()['foods']
    assert {f['id'] for f in updates if f['plan_food']}=={f['id'] for f in foods}
    rice=next(f for f in foods if f['seed_key']=='usda-sr-168878')
    r=client.post('/api/food-logs',json={'food_id':rice['id'],'grams':250,
        'local_date':'2026-11-02','meal':'Lunch','request_id':'plan-rice-250'})
    assert r.status_code==201
    log=client.get('/api/offline/snapshot').json()['logs'][0]
    assert log['kcal']==pytest.approx(325) and log['protein']==pytest.approx(6.725)
