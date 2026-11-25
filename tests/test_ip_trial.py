import json
import sqlite3

import pytest

from scripts.ip_trial import clone_database, environment, verify_personal_files


def test_online_snapshot_includes_committed_wal_and_never_writes_back(tmp_path):
    source, destination = tmp_path / 'personal.sqlite3', tmp_path / 'trial.sqlite3'
    with sqlite3.connect(source) as live:
        live.execute('PRAGMA journal_mode=WAL')
        live.execute('CREATE TABLE lifts(weight REAL)')
        live.execute('INSERT INTO lifts VALUES(38)')
        live.commit()
        clone_database(source, destination)
        with sqlite3.connect(destination) as trial:
            assert trial.execute('SELECT weight FROM lifts').fetchall() == [(38,)]
            trial.execute('UPDATE lifts SET weight=20')
        assert live.execute('SELECT weight FROM lifts').fetchall() == [(38,)]


def test_snapshot_cannot_overwrite_either_database(tmp_path):
    source = tmp_path / 'personal.sqlite3'
    with sqlite3.connect(source) as c:
        c.execute('CREATE TABLE lifts(weight REAL)')
    with pytest.raises(RuntimeError):
        clone_database(source, source)
    destination = tmp_path / 'existing.sqlite3'
    destination.write_text('already exists')
    with pytest.raises(RuntimeError):
        clone_database(source, destination)
    assert destination.read_text() == 'already exists'


def test_trial_scrubs_live_paths_and_credentials(tmp_path, monkeypatch):
    (tmp_path / 'app').mkdir()
    (tmp_path / 'app/.env').write_text('APP_DB=/personal/database\nCOACH_PROVIDER=subscription\n')
    for key, value in {'APP_DB':'/personal/database', 'APP_INBOX':'/real/icloud', 'APP_PHONE_INTERFACE':'en0',
                       'APP_TLS_CERT':'/real/cert', 'CLAUDE_AUTO_COACH':'true','ANTHROPIC_API_KEY':'private-key',
                       'API_TARGET':'http://127.0.0.1:8765','VITE_API_URL':'http://127.0.0.1:8765'}.items():
        monkeypatch.setenv(key, value)
    env = environment(tmp_path, {'id':'test-id','token':'independent-token','created_at':'date','personal_url':'http://127.0.0.1:8765'})
    assert env['APP_DB'] == str(tmp_path / 'data.sqlite3')
    assert env['APP_TOKEN'] == 'independent-token'
    assert env['APP_BIND'] == '127.0.0.1' and env['APP_PORT'] == '8767'
    assert env['APP_DEMO'] == 'true'
    assert env['AUTO_COACH'] == env['CLAUDE_AUTO_COACH'] == 'false'
    assert env['COACH_PROVIDER'] == 'api'
    assert not env['APP_INBOX'] and not env['ANTHROPIC_API_KEY'] and not env['APP_PHONE_INTERFACE']
    assert 'API_TARGET' not in env and 'VITE_API_URL' not in env


def test_frozen_trial_is_reused_without_overwriting_experiments(tmp_path):
    from scripts.ip_trial import prepare
    workspace = tmp_path / 'trial'
    workspace.mkdir()
    database = workspace / 'data.sqlite3'
    database.write_text('trial state must be preserved')
    manifest = {'kind':'aesthetic-ip-trial-v1','workspace':str(workspace),'id':'same-instance'}
    (workspace / 'manifest.json').write_text(json.dumps(manifest))
    assert prepare(tmp_path / 'missing-original', workspace, build=False) == manifest
    assert database.read_text() == 'trial state must be preserved'


def test_incomplete_trial_is_never_silently_replaced(tmp_path):
    from scripts.ip_trial import prepare
    workspace = tmp_path / 'trial'
    workspace.mkdir()
    (workspace / 'precious-log').write_text('retain')
    with pytest.raises(RuntimeError, match='preserved'):
        prepare(tmp_path, workspace, build=False)
    assert (workspace / 'precious-log').read_text() == 'retain'


def test_source_check_reports_changed_files_without_restoring_or_editing_them(tmp_path):
    import hashlib
    path = tmp_path / 'app.py'
    path.write_text('current app')
    manifest = {'protected_files': {'app.py':hashlib.sha256(path.read_bytes()).hexdigest()}}
    assert verify_personal_files(tmp_path, manifest) == []
    path.write_text('legitimate later edit')
    assert verify_personal_files(tmp_path, manifest) == ['app.py']
    assert path.read_text() == 'legitimate later edit'
