import pytest
from fastapi.testclient import TestClient

from aesthetic_lab.app import app
from aesthetic_lab.db import initialize


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DB", str(tmp_path / "test.sqlite3"))
    monkeypatch.setenv("APP_TOKEN", "test-only-secret-" + "x" * 40)
    monkeypatch.setenv("AUTO_COACH", "false")
    monkeypatch.setenv("COACH_PROVIDER", "api")
    monkeypatch.setenv("CLAUDE_AUTO_COACH", "false")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    monkeypatch.setenv("APP_INBOX", "")
    monkeypatch.setenv("APP_TRACKER_MODE", "external")
    monkeypatch.setenv('APP_PHONE_INTERFACE','')
    from aesthetic_lab import coaching
    monkeypatch.setattr(coaching, "ENV_PATH", tmp_path / ".env")
    monkeypatch.setattr(coaching, "_last_failure_at", None)
    initialize()


@pytest.fixture
def client():
    return TestClient(app, base_url="http://localhost", headers={"Authorization": "Bearer test-only-secret-" + "x" * 40})


@pytest.fixture
def batch():
    return {"source":"liftoff-adapter", "schema_version":1, "workouts":[{
        "external_id":"uuid-1", "revision":1, "name":"Push", "started_at":"2026-10-31T00:30:00+02:00",
        "ended_at":"2026-10-31T01:30:00+02:00", "detail_level":"sets", "sets":[
            {"exercise":"Incline Dumbbell Press", "reps":10, "load":100, "unit":"lb", "rir":2, "side":"bilateral"},
            {"exercise":"Cable Lateral Raise", "reps":12, "load":10, "rir":None, "side":"left"},
            {"exercise":"Bench Press", "reps":10, "load":20, "warmup":True}
        ]}]}
