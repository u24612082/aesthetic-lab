import json
import time
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from aesthetic_lab import auto_coach
from aesthetic_lab.analytics import dashboard,today
from aesthetic_lab.claude_analyser import local_report
from aesthetic_lab.subscription import snapshot


def food(client,request_id='automatic-coach-food'):
    item=client.get('/api/foods').json()[0]
    assert client.post('/api/food-logs',json={'request_id':request_id,'food_id':item['id'],'local_date':str(today()),'meal':'Lunch','grams':100}).status_code==201


def synchronous(monkeypatch):
    class Immediate:
        def __init__(self,target,args,**kwargs):self.target=target;self.args=args
        def start(self):self.target(*self.args)
    monkeypatch.setattr(auto_coach.threading,'Thread',Immediate)
    monkeypatch.setenv('COACH_PROVIDER','subscription')
    monkeypatch.setenv('CLAUDE_AUTO_COACH','true')
    monkeypatch.setattr(auto_coach,'generate',lambda current:local_report(dashboard(28)))


def test_saves_background_review_and_skips_unchanged_data(client,monkeypatch):
    synchronous(monkeypatch);food(client)
    first=auto_coach.request_review()
    assert first['state']=='queued'
    assert auto_coach.status()['job']['state']=='complete'
    assert client.get('/api/dashboard').json()['coach']['mode']=='claude_pro'
    assert auto_coach.request_review()['state']=='cached'


def test_changes_debounce_and_automatic_interval(client,monkeypatch):
    synchronous(monkeypatch);food(client)
    now=[time.time()];monkeypatch.setattr(auto_coach.time,'time',lambda:now[0])
    assert auto_coach.request_review(automatic=True)['state']=='settling'
    now[0]+=21
    assert auto_coach.request_review(automatic=True)['state']=='queued'
    food(client,'automatic-second-food')
    assert auto_coach.request_review(automatic=True)['state']=='settling'
    now[0]+=21
    assert auto_coach.request_review(automatic=True)['state']=='scheduled'
    now[0]+=901
    assert auto_coach.request_review(automatic=True)['state']=='queued'


def test_paused_and_demo_never_generate(client,monkeypatch):
    mocked=MagicMock();monkeypatch.setattr(auto_coach,'generate',mocked)
    assert auto_coach.request_review(automatic=True)['state']=='disabled'
    monkeypatch.setenv('APP_DEMO','true')
    assert auto_coach.request_review()['state']=='demo'
    mocked.assert_not_called()


def test_simultaneous_requests_share_one_queued_job(client,monkeypatch):
    food(client)
    class Pending:
        def __init__(self,**kwargs):pass
        def start(self):pass
    monkeypatch.setattr(auto_coach.threading,'Thread',Pending)
    first=auto_coach.request_review()
    second=auto_coach.request_review()
    assert first['job_id']==second['job_id'] and second['state']=='queued'


def test_rate_limit_is_visible_and_backed_off(client,monkeypatch):
    synchronous(monkeypatch);food(client)
    def limited(current):raise auto_coach.AgentFailure('rate_limited','Subscription limit reached.')
    monkeypatch.setattr(auto_coach,'generate',limited)
    auto_coach.request_review()
    job=auto_coach.status()['job']
    assert job['state']=='rate_limited' and job['retry_after']>time.time()+3500
    assert auto_coach.request_review()['state']=='rate_limited'


def test_context_changes_during_generation_are_not_published(client,monkeypatch):
    synchronous(monkeypatch);food(client)
    def changed(current):
        food(client,'changed-during-generation')
        return local_report(dashboard(28))
    monkeypatch.setattr(auto_coach,'generate',changed)
    auto_coach.request_review()
    assert auto_coach.status()['job']['state']=='superseded'
    assert client.get('/api/dashboard').json()['coach'] is None


def test_noninteractive_command_strips_credentials_disables_tools_and_uses_stdin(monkeypatch):
    monkeypatch.setenv('ANTHROPIC_API_KEY','never-forward-this')
    monkeypatch.setattr(auto_coach,'find_claude',lambda env:'/test/claude')
    monkeypatch.setattr(auto_coach.subprocess,'run',lambda *args,**kw:SimpleNamespace(stdout=json.dumps({'loggedIn':True,'authMethod':'claude.ai','subscriptionType':'pro'})))
    report=local_report(dashboard(28)).model_dump()
    class Process:
        pid=123456;returncode=0
        def __init__(self,args,**kw):
            assert args[0:2]==['/test/claude','-p']
            assert args[args.index('--tools')+1]==''
            assert '--bare' not in args and '--dangerously-skip-permissions' not in args
            assert not any(k in kw['env'] for k in ('ANTHROPIC_API_KEY','APP_TOKEN','ANTHROPIC_AUTH_TOKEN'))
        def communicate(self,payload,**kw):
            assert 'routine_plan' in payload
            return json.dumps({'structured_output':report}),''
    monkeypatch.setattr(auto_coach.subprocess,'Popen',Process)
    assert auto_coach.generate(snapshot()).summary==report['summary']


def test_api_authenticated_client_is_rejected_before_generation(monkeypatch):
    monkeypatch.setattr(auto_coach,'find_claude',lambda env:'/test/claude')
    monkeypatch.setattr(auto_coach.subprocess,'run',lambda *args,**kw:SimpleNamespace(stdout='{"loggedIn":true,"authMethod":"api_key"}'))
    native=MagicMock();monkeypatch.setattr(auto_coach.subprocess,'Popen',native)
    with pytest.raises(auto_coach.AgentFailure,match='API-key fallback is disabled'):auto_coach.generate(snapshot())
    native.assert_not_called()


def test_app_review_action_queues_without_opening_terminal(client,monkeypatch):
    monkeypatch.setenv('COACH_PROVIDER','subscription')
    monkeypatch.setattr(auto_coach,'request_review',lambda **kwargs:{'state':'queued','message':'Review started.'})
    assert client.post('/api/coach/run').json()['state']=='queued'
    assert client.post('/api/coach/open-subscription').json()['state']=='queued'
