from fastapi import HTTPException
import pytest
from aesthetic_lab import foods


def test_plain_pasta_and_common_spellings_rank_ahead_of_unrequested_meals(client):
    for q in ('spaghetti','spagetti','pasta'):
        rows=client.get('/api/foods',params={'q':q}).json()
        assert rows and rows[0]['name'].lower().startswith(('pasta, cooked','pasta, dry','spaghetti, dry','spaghetti, cooked'))
        assert not any('babyfood' in r['name'].lower() or 'carrabba' in r['name'].lower() or r['category'] in ('Restaurant Foods','Fast Foods') for r in rows[:5])
    assert client.get('/api/foods?q=nutritec%20mass%20gainer').json()
    assert client.get('/api/foods?q=beef%20mince').json()


def test_unified_search_includes_global_products_and_uses_za_context(client,monkeypatch):
    calls=[]
    async def fake(path,params,kind):
        calls.append(params)
        return {'products':[{'code':'1234567890123','product_name':'Nutritech imported gainer','countries_tags':['en:united-states'],'brands':'Nutritech','nutriments':{'energy-kj_100g':1673.6,'proteins_100g':25,'carbohydrates_100g':60,'fat_100g':7}}]}
    monkeypatch.setattr(foods,'request_off',fake)
    r=client.get('/api/foods/discover?q=nutritec%20gainer').json()
    assert r['online'] and any(f.get('barcode')=='1234567890123' for f in r['foods'])
    assert calls[0]['cc']=='za' and 'countries_tags' not in calls[0]
    assert calls[0]['search_terms']=='nutritech gainer'
    item=next(f for f in r['foods'] if f.get('barcode')=='1234567890123')
    assert item['kcal']==pytest.approx(400)


def test_remote_failure_preserves_local_results_and_missing_macros_are_not_invented(client,monkeypatch):
    async def unavailable(*args):raise HTTPException(502,'Source temporarily unavailable')
    monkeypatch.setattr(foods,'request_off',unavailable)
    result=client.get('/api/foods/discover?q=spaghetti').json()
    assert result['foods'] and not result['online'] and 'unavailable' in result['message']
    assert foods.product({'code':'1234567890123','product_name':'Missing fat','nutriments':{'energy-kcal_100g':400,'proteins_100g':25,'carbohydrates_100g':60}}) is None
