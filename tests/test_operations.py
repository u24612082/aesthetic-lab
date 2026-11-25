import json
import os
import time

import pytest

from aesthetic_lab.db import connect
from aesthetic_lab.worker import scan_inbox
from aesthetic_lab.server import validated_binds


def test_inbox_archives_and_rejects(tmp_path,monkeypatch,batch):
    inbox=tmp_path/'inbox';inbox.mkdir()
    monkeypatch.setenv('APP_INBOX',str(inbox))
    for name,payload in [('valid.json',json.dumps(batch)),('bad.json','{"invalid":true}')]:
        p=inbox/name;p.write_text(payload);os.utime(p,(time.time()-15,time.time()-15))
    scan_inbox()
    assert len(list((inbox/'processed').glob('*.json')))==1
    assert len(list((inbox/'rejected').glob('*.json')))==1
    with connect() as c:
        assert c.execute('SELECT COUNT(*) FROM workouts').fetchone()[0]==1


def test_demo_does_not_consume_real_inbox(tmp_path,monkeypatch,batch):
    inbox=tmp_path/'inbox';inbox.mkdir()
    p=inbox/'real-workout.json';p.write_text(json.dumps(batch));os.utime(p,(time.time()-15,time.time()-15))
    monkeypatch.setenv('APP_INBOX',str(inbox));monkeypatch.setenv('APP_DEMO','true')
    scan_inbox()
    assert p.is_file() and not (inbox/'processed').exists()
    with connect() as c:
        assert c.execute('SELECT COUNT(*) FROM workouts').fetchone()[0]==0


@pytest.mark.parametrize('address',['0.0.0.0','::','8.8.8.8','169.254.1.2'])
def test_refuses_wildcard_and_public_binds(monkeypatch,address):
    monkeypatch.setenv('APP_BIND',address)
    with pytest.raises(ValueError):validated_binds()


def test_lan_requires_tls(monkeypatch):
    monkeypatch.setenv('APP_BIND','127.0.0.1,192.168.1.50')
    monkeypatch.setenv('APP_TLS_CERT','');monkeypatch.setenv('APP_TLS_KEY','')
    with pytest.raises(ValueError,match='HTTPS'):validated_binds()
    monkeypatch.setenv('APP_TLS_CERT','cert.pem');monkeypatch.setenv('APP_TLS_KEY','key.pem')
    assert validated_binds()[0]==['127.0.0.1','192.168.1.50']


def test_coach_deduplicates_unchanged_data():
    from aesthetic_lab.claude_analyser import analyse
    analyse();analyse()
    with connect() as c:
        records=c.execute('SELECT * FROM coach_reports').fetchall()
        assert len(records)==1 and records[0]['mode']=='local'
        assert json.loads(records[0]['report'])['adjustments']==[]
