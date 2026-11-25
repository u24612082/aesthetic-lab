import importlib.util
from pathlib import Path

import pytest
from dotenv import dotenv_values

spec = importlib.util.spec_from_file_location("icloud_setup", Path(__file__).parents[1] / "scripts/setup_icloud.py")
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


def test_prepares_shared_inbox_preserving_private_settings(tmp_path):
    root=tmp_path/'workspace';root.mkdir()
    cloud=tmp_path/'cloud';cloud.mkdir()
    env=root/'.env'
    env.write_text("APP_TOKEN=test-secret\nAPP_DB=var/personal.sqlite3\nAPP_INBOX=\n")
    inbox=setup.prepare(root,cloud)
    assert inbox==cloud/'AestheticLab/inbox' and inbox.is_dir()
    values=dotenv_values(env)
    assert values['APP_TOKEN']=='test-secret'
    assert values['APP_DB']=='var/personal.sqlite3'
    assert values['APP_INBOX']==str(inbox)
    assert setup.prepare(root,cloud)==inbox


def test_preserves_previously_configured_inbox(tmp_path):
    cloud=tmp_path/'cloud';cloud.mkdir()
    env=tmp_path/'.env';env.write_text('APP_INBOX=/existing/inbox\n')
    with pytest.raises(RuntimeError,match='alternative'):
        setup.prepare(tmp_path,cloud)
    assert env.read_text()=='APP_INBOX=/existing/inbox\n'


def test_does_not_fake_an_unavailable_icloud_root(tmp_path):
    missing=tmp_path/'missing-cloud'
    with pytest.raises(RuntimeError,match='not available'):
        setup.prepare(tmp_path,missing)
    assert not missing.exists()
