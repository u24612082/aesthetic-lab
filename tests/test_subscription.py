import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from aesthetic_lab import coaching
from aesthetic_lab.analytics import dashboard
from aesthetic_lab.claude_analyser import local_report
from aesthetic_lab.db import connect
from aesthetic_lab.subscription import snapshot, save_review, connection_status


def test_subscription_never_uses_paid_api_even_with_key_and_records(client,monkeypatch):
    monkeypatch.setenv('COACH_PROVIDER','subscription')
    monkeypatch.setenv('AUTO_COACH','true')
    monkeypatch.setenv('ANTHROPIC_API_KEY','sk-ant-must-never-be-used')
    factory=MagicMock(side_effect=AssertionError('Paid API must not be used'))
    monkeypatch.setattr(coaching.anthropic,'Anthropic',factory)
    food=client.get('/api/foods').json()[0]
    from aesthetic_lab.analytics import today
    assert client.post('/api/food-logs',json={'request_id':'subscription-no-paid','food_id':food['id'],'local_date':str(today()),'meal':'Lunch','grams':100}).status_code==201
    assert coaching.run_coach()['mode']=='local'
    assert client.post('/api/coach/connect',json={'api_key':'sk-ant-not-used-'+'x'*25}).status_code==422
    assert client.get('/api/coach/status').json()['provider']=='subscription'
    factory.assert_not_called()


def test_plan_context_is_not_claimed_as_completed_training(client):
    data=snapshot()['context']
    assert len(data['routine_plan'])==5 and not data['stats']['working_sets']
    counts=data['planned_direct_sets_per_rotation']
    assert counts['Upper Chest']==15 and counts['Lateral Deltoids']==13 and counts['Rear Deltoids']==9
    assert data['recent_performance']==[]
    assert 'APP_TOKEN' not in str(data) and 'ANTHROPIC_API_KEY' not in str(data)


def test_agent_review_persists_without_worker_overwrite_and_is_deduplicated(client,monkeypatch):
    monkeypatch.setenv('COACH_PROVIDER','subscription')
    current=snapshot()
    report=local_report(dashboard(28)).model_dump();report['summary']='Synthetic subscription test review.'
    report['adjustments']=[{'target':'Upper Chest','weekly_set_delta':2,'reason':'Not enough evidence; must be removed.'}]
    first=save_review(report,current['context_fingerprint'])
    assert save_review(report,current['context_fingerprint'])['unchanged']
    assert coaching.run_coach()['mode']=='local'
    audit=client.get('/api/dashboard').json()['coach']
    assert audit['mode']=='claude_pro' and audit['id']==first['id']
    assert connection_status()['stale'] is False
    with connect() as c:
        assert '"adjustments":[]' in c.execute('SELECT report FROM coach_reports WHERE id=?',(first['id'],)).fetchone()[0]


def test_stale_context_cannot_publish_review(client):
    current=snapshot()
    report=local_report(dashboard(28)).model_dump()
    state=client.get('/api/data').json();state['state']['routines'][0]['ex'][0]['sets']=4
    assert client.put('/api/data',json=state).status_code==200
    with pytest.raises(ValueError,match='changed'):save_review(report,current['context_fingerprint'])
    assert not connection_status()['has_review']


def test_demo_cannot_launch_native_agent(client,monkeypatch):
    monkeypatch.setenv('APP_DEMO','true')
    assert client.post('/api/coach/open-subscription').status_code==409


def test_real_stdio_mcp_handshake_and_live_context(monkeypatch):
    monkeypatch.setenv('COACH_PROVIDER','subscription')
    async def exercise():
        params=StdioServerParameters(command=sys.executable,args=[str(Path(__file__).parents[1]/'scripts/run_mcp.py')],env=dict(os.environ))
        async with stdio_client(params) as (read,write):
            async with ClientSession(read,write) as session:
                await session.initialize()
                tools=await session.list_tools()
                assert {t.name for t in tools.tools}=={'get_aesthetic_context','get_review_schema','save_aesthetic_review'}
                result=await session.call_tool('get_aesthetic_context',{})
                assert not result.isError
                import json
                data=json.loads(result.content[0].text)
                assert data['context']['stats']['sessions']==0 and len(data['context']['routine_plan'])==5
                report=local_report(dashboard(28)).model_dump()
                result=await session.call_tool('save_aesthetic_review',{'report':report,'context_fingerprint':data['context_fingerprint']})
                assert not result.isError
    asyncio.run(exercise())


def test_subscription_launcher_strips_credentials_and_does_not_send_a_prompt(monkeypatch,capsys):
    import importlib.util
    from types import SimpleNamespace
    spec=importlib.util.spec_from_file_location('claude_coach_launcher',Path(__file__).parents[1]/'scripts/claude_coach.py')
    launcher=importlib.util.module_from_spec(spec);spec.loader.exec_module(launcher)
    monkeypatch.setenv('ANTHROPIC_API_KEY','must-not-be-forwarded')
    monkeypatch.setenv('ANTHROPIC_AUTH_TOKEN','must-not-be-forwarded')
    monkeypatch.setattr(launcher,'find_claude',lambda _: '/test/claude')
    def run(args,**kwargs):
        assert args==['/test/claude','auth','status','--json']
        assert not any(k in kwargs['env'] for k in ('APP_TOKEN','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN'))
        return SimpleNamespace(stdout='{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"pro","email":"private@example.invalid"}')
    monkeypatch.setattr(launcher.subprocess,'run',run)
    monkeypatch.setattr(launcher.os,'chdir',lambda _:None)
    executed=[]
    monkeypatch.setattr(launcher.os,'execve',lambda *args:executed.append(args))
    launcher.main()
    assert executed[0][1]==['/test/claude']
    assert 'private@example.invalid' not in capsys.readouterr().out
