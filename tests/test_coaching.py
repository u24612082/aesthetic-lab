import json
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock

import anthropic
import httpx
from dotenv import dotenv_values

from aesthetic_lab import coaching
from aesthetic_lab.analytics import dashboard, today
from aesthetic_lab.claude_analyser import local_report
from aesthetic_lab.db import connect
from aesthetic_lab.config import token

KEY = "sk-ant-test-only-" + "x" * 32


def fake_sdk(monkeypatch, report=None, error=None):
    client=MagicMock()
    client.__enter__.return_value=client
    if error:
        client.models.retrieve.side_effect=error
        client.messages.create.side_effect=error
    elif report is not None:
        client.messages.create.return_value=SimpleNamespace(content=[SimpleNamespace(type='tool_use',name='report',input=report)])
    factory=MagicMock(return_value=client)
    monkeypatch.setattr(anthropic,'Anthropic',factory)
    return factory,client


def log_food(client):
    food=client.get('/api/foods').json()[0]
    return client.post('/api/food-logs',json={'request_id':'coach-test-food','food_id':food['id'],
        'local_date':today().isoformat(),'meal':'Breakfast','grams':100})


def test_status_explains_missing_connection_and_empty_data(client):
    result=client.get('/api/coach/status')
    assert result.status_code==200
    state=result.json()
    assert state['state']=='not_configured'
    assert state['data_status']=='empty' and not state['has_data']
    assert not state['api_key_configured'] and 'api_key' not in state


def test_configured_but_empty_database_never_makes_paid_audit(monkeypatch,client):
    monkeypatch.setenv('ANTHROPIC_API_KEY',KEY)
    monkeypatch.setenv('AUTO_COACH','true')
    factory,_=fake_sdk(monkeypatch)
    assert client.get('/api/coach/status').json()['state']=='waiting_for_data'
    result=client.post('/api/coach/run')
    assert result.status_code==200 and result.json()['state']=='waiting_for_data'
    factory.assert_not_called()
    assert client.get('/api/dashboard').json()['coach']['mode']=='local'


def test_connection_verified_then_saved_without_returning_secret(monkeypatch,client):
    factory,sdk=fake_sdk(monkeypatch)
    coaching.ENV_PATH.write_text('APP_TOKEN=keep-private\nAPP_DB=var/personal.sqlite3\n')
    result=client.post('/api/coach/connect',json={'api_key':KEY})
    assert result.status_code==200 and KEY not in result.text
    sdk.models.retrieve.assert_called_once()
    sdk.messages.create.assert_not_called()
    values=dotenv_values(coaching.ENV_PATH)
    assert values['ANTHROPIC_API_KEY']==KEY and values['AUTO_COACH']=='true'
    assert values['APP_TOKEN']=='keep-private' and values['APP_DB']=='var/personal.sqlite3'
    assert coaching.ENV_PATH.stat().st_mode & 0o777==0o600
    assert KEY not in client.get('/api/coach/status').text


def test_invalid_key_error_preserves_existing_configuration(monkeypatch,client):
    response=httpx.Response(401,request=httpx.Request('GET','https://api.anthropic.com/v1/models/test'))
    error=anthropic.AuthenticationError('upstream included '+KEY,response=response,body={'secret':KEY})
    fake_sdk(monkeypatch,error=error)
    coaching.ENV_PATH.write_text('ANTHROPIC_API_KEY=preserve-existing-key\n')
    result=client.post('/api/coach/connect',json={'api_key':KEY})
    assert result.status_code==502 and result.json()['code']=='authentication'
    assert KEY not in result.text
    assert dotenv_values(coaching.ENV_PATH)['ANTHROPIC_API_KEY']=='preserve-existing-key'


def test_credential_validation_does_not_echo_request_values(client):
    result=client.post('/api/coach/connect',json={'api_key':{'nested_secret':KEY}})
    assert result.status_code==422 and KEY not in result.text
    result=client.post('/api/coach/connect',json={'api_key':'short'})
    assert result.status_code==422 and 'short' not in result.text


def test_pairing_token_is_never_forwarded_to_anthropic(monkeypatch,client):
    factory,_=fake_sdk(monkeypatch)
    result=client.post('/api/coach/connect',json={'api_key':token()})
    assert result.status_code==422 and token() not in result.text
    assert 'pairing token' in result.json()['detail']
    factory.assert_not_called()


def test_real_analysis_path_validates_output_caches_and_holds_volume(monkeypatch,client):
    assert log_food(client).status_code==201
    monkeypatch.setenv('ANTHROPIC_API_KEY',KEY)
    monkeypatch.setenv('AUTO_COACH','true')
    report=local_report(dashboard(28)).model_dump()
    report['summary']='A structured test audit from the mocked provider.'
    report['adjustments']=[{'target':'Upper Chest','weekly_set_delta':2,'reason':'Would require actual training evidence.'}]
    _,sdk=fake_sdk(monkeypatch,report=report)
    first=client.post('/api/coach/run')
    second=client.post('/api/coach/run')
    assert first.status_code==200 and first.json()['mode']=='claude'
    assert second.json()['state']=='cached'
    sdk.messages.create.assert_called_once()
    audit=client.get('/api/dashboard').json()['coach']
    assert audit['mode']=='claude' and json.loads(audit['report'])['adjustments']==[]
    state=client.get('/api/coach/status').json()
    assert state['state']=='ready' and state['data_status']=='nutrition_only'


def test_failed_remote_report_is_visible_and_previous_report_preserved(monkeypatch,client):
    log_food(client)
    assert client.post('/api/coach/run').status_code==200
    old=client.get('/api/dashboard').json()['coach']['id']
    monkeypatch.setenv('ANTHROPIC_API_KEY',KEY)
    monkeypatch.setenv('AUTO_COACH','true')
    response=httpx.Response(429,request=httpx.Request('POST','https://api.anthropic.com/v1/messages'))
    error=anthropic.RateLimitError('do not expose '+KEY,response=response,body={})
    fake_sdk(monkeypatch,error=error)
    result=client.post('/api/coach/run')
    assert result.status_code==502 and KEY not in result.text
    state=client.get('/api/coach/status').json()
    assert state['state']=='error' and 'rate-limited' in state['last_error']['message']
    assert client.get('/api/dashboard').json()['coach']['id']==old
    assert client.post('/api/coach/run').status_code==429


def test_connection_lock_prevents_duplicate_generations(client):
    coaching._lock.acquire()
    try:
        result=client.post('/api/coach/run')
        assert result.status_code==200 and result.json()['state']=='running'
    finally:
        coaching._lock.release()


def test_disconnect_removes_key_without_touching_other_settings(monkeypatch,client):
    monkeypatch.setenv('ANTHROPIC_API_KEY',KEY)
    monkeypatch.setenv('AUTO_COACH','true')
    coaching.ENV_PATH.write_text('APP_TOKEN=preserve-token\nANTHROPIC_API_KEY='+KEY+'\nAUTO_COACH=true\n')
    result=client.post('/api/coach/disconnect')
    assert result.status_code==200
    values=dotenv_values(coaching.ENV_PATH)
    assert values['ANTHROPIC_API_KEY']=='' and values['APP_TOKEN']=='preserve-token'
    assert client.get('/api/coach/status').json()['state']=='not_configured'


def test_demo_cannot_change_personal_credentials_or_call_ai(monkeypatch,client):
    monkeypatch.setenv('APP_DEMO','true')
    monkeypatch.setenv('AUTO_COACH','true')
    monkeypatch.setenv('ANTHROPIC_API_KEY',KEY)
    coaching.ENV_PATH.write_text('APP_TOKEN=preserve\n')
    factory,_=fake_sdk(monkeypatch)
    log_food(client)
    assert client.post('/api/coach/connect',json={'api_key':KEY}).status_code==409
    assert client.post('/api/coach/disconnect').status_code==409
    assert client.post('/api/coach/run').json()['mode']=='local'
    assert coaching.ENV_PATH.read_text()=='APP_TOKEN=preserve\n'
    factory.assert_not_called()


def test_invalid_structured_report_is_rejected(monkeypatch,client):
    log_food(client)
    monkeypatch.setenv('AUTO_COACH','true')
    monkeypatch.setenv('ANTHROPIC_API_KEY',KEY)
    _,sdk=fake_sdk(monkeypatch,report={'summary':'Incomplete report'})
    result=client.post('/api/coach/run')
    assert result.status_code==502 and result.json()['code']=='invalid_report'
    with connect() as c:
        assert c.execute('SELECT COUNT(*) FROM coach_reports').fetchone()[0]==0
