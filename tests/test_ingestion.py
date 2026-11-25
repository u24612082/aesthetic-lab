import copy
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import pytest
from pydantic import ValidationError

from aesthetic_lab.analytics import dashboard
from aesthetic_lab.db import connect
from aesthetic_lab.ingest import ingest, RevisionConflict
from aesthetic_lab.models import IngestBatch


def test_atomic_retry_units_dates_and_unknown_effort(batch):
    assert ingest(IngestBatch.model_validate(batch))["inserted"] == 1
    assert ingest(IngestBatch.model_validate(batch))["unchanged"] == 1
    result = dashboard(7, date(2026,10,31))
    assert result["workouts"][0]["local_date"] == "2026-10-31"
    assert result["stats"]["working_sets"] == 2
    assert result["stats"]["known_hard_sets"] == 1
    upper = next(v for v in result["volume"] if v["target"] == "Upper Chest")
    assert upper["direct_sets"] == 1
    with connect() as c:
        assert c.execute("SELECT load_kg FROM exercise_sets ORDER BY ordinal LIMIT 1").fetchone()[0] == pytest.approx(45.359237)


def test_revision_replaces_sets_and_stale_never_overwrites(batch):
    original = IngestBatch.model_validate(batch)
    ingest(original)
    batch["workouts"][0]["revision"] = 2
    batch["workouts"][0]["sets"] = batch["workouts"][0]["sets"][:1]
    assert ingest(IngestBatch.model_validate(batch))["updated"] == 1
    assert ingest(original)["stale"] == 1
    with connect() as c:
        assert c.execute("SELECT COUNT(*) FROM exercise_sets").fetchone()[0] == 1


def test_conflicting_batch_rolls_back_all_changes(batch):
    ingest(IngestBatch.model_validate(batch))
    fresh=copy.deepcopy(batch["workouts"][0]);fresh["external_id"]="new"
    batch["workouts"][0]["name"]="Changed without revision"
    batch["workouts"].insert(0,fresh)
    with pytest.raises(RevisionConflict):
        ingest(IngestBatch.model_validate(batch))
    with connect() as c:
        assert c.execute("SELECT COUNT(*) FROM workouts").fetchone()[0] == 1


def test_concurrent_import_retries_create_one_workout(batch):
    payload=IngestBatch.model_validate(batch)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results=list(pool.map(lambda _: ingest(payload),range(24)))
    assert sum(r["inserted"] for r in results)==1
    assert sum(r["unchanged"] for r in results)==23
    with connect() as c:
        assert c.execute("PRAGMA journal_mode").fetchone()[0]=="wal"
        assert c.execute("PRAGMA foreign_keys").fetchone()[0]==1


def test_summary_does_not_fabricate_volume(batch):
    w=batch["workouts"][0];w["detail_level"]="summary";w["sets"]=[]
    ingest(IngestBatch.model_validate(batch))
    data=dashboard(7,date(2026,10,31))
    assert data["stats"]["sessions"]==1 and data["stats"]["working_sets"]==0
    assert data["progression_gates"]==[]


@pytest.mark.parametrize("change",["naive","nan","summary_with_sets","empty_sets"])
def test_invalid_records_rejected(batch,change):
    w=batch["workouts"][0]
    if change=="naive":w["started_at"]="2026-10-31T17:00:00"
    elif change=="nan":w["sets"][0]["load"]=float('nan')
    elif change=="summary_with_sets":w["detail_level"]="summary"
    else:w["sets"]=[]
    with pytest.raises(ValidationError):IngestBatch.model_validate(batch)
