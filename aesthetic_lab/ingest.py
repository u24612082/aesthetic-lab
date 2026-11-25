"""Versioned, atomic ingestion. No fabricated exercise detail from HealthKit summaries."""
import hashlib
import json
import re
from pathlib import Path

from .config import timezone
from .db import connect
from .models import IngestBatch

# Exact normalized aliases keep ambiguous movements out of specific aesthetic groups.
MOVEMENTS = {
    "incline dumbbell press": ("Upper Chest", "Triceps"),
    "incline bench press": ("Upper Chest", "Triceps"),
    "incline barbell bench press": ("Upper Chest", "Triceps"),
    "low to high cable fly": ("Upper Chest", None),
    "bench press": ("Chest", "Triceps"),
    "flat dumbbell press": ("Chest", "Triceps"),
    "cable lateral raise": ("Lateral Deltoids", None),
    "dumbbell lateral raise": ("Lateral Deltoids", None),
    "lateral raise": ("Lateral Deltoids", None),
    "reverse pec deck": ("Rear Deltoids", None),
    "rear delt fly": ("Rear Deltoids", None),
    "overhead press": ("Anterior Deltoids", "Triceps"),
    "lat pulldown": ("Lats", "Biceps"),
    "pull up": ("Lats", "Biceps"),
    "chest supported row": ("Upper Back", "Biceps"),
    "seated cable row": ("Upper Back", "Biceps"),
    "barbell row": ("Upper Back", "Biceps"),
    "squat": ("Quadriceps", "Glutes"),
    "barbell squat": ("Quadriceps", "Glutes"),
    "hack squat": ("Quadriceps", "Glutes"),
    "leg press": ("Quadriceps", "Glutes"),
    "leg extension": ("Quadriceps", None),
    "romanian deadlift": ("Hamstrings", "Glutes"),
    "seated leg curl": ("Hamstrings", None),
    "lying leg curl": ("Hamstrings", None),
    "hip thrust": ("Glutes", None),
    "standing calf raise": ("Calves", None),
    "seated calf raise": ("Calves", None),
    "incline dumbbell curl": ("Biceps", None),
    "dumbbell curl": ("Biceps", None),
    "cable curl": ("Biceps", None),
    "triceps pushdown": ("Triceps", None),
    "overhead triceps extension": ("Triceps", None),
    "cable crunch": ("Abdominals", None),
}


def normalize(name):
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


# User-reviewed programme aliases are available to the API, CLI and background coach alike.
for routine in json.loads((Path(__file__).parent/'data/program.json').read_text(encoding='utf-8')):
    for name,_,_,_,_,target,_,_ in routine['exercises']:
        MOVEMENTS[normalize(name)]=(target, 'Biceps' if target in ('Lats','Upper Back') else 'Triceps' if 'Press' in name else None)


def targets(name):
    return MOVEMENTS.get(normalize(name), ("Unmapped", None))


class RevisionConflict(ValueError):
    pass


def ingest(batch: IngestBatch):
    counts = {"inserted": 0, "updated": 0, "unchanged": 0, "stale": 0}
    with connect() as c:
        # Serialise read/compare/write as one transaction across all listeners.
        c.execute("BEGIN IMMEDIATE")
        for w in batch.workouts:
            digest = hashlib.sha256(json.dumps(w.model_dump(mode="json"), sort_keys=True).encode()).hexdigest()
            old = c.execute("SELECT * FROM workouts WHERE source=? AND external_id=?", (batch.source, w.external_id)).fetchone()
            if old:
                if w.revision < old["revision"]:
                    counts["stale"] += 1
                    continue
                if w.revision == old["revision"]:
                    if digest != old["payload_hash"]:
                        raise RevisionConflict("Changed payload requires a higher revision; batch rolled back")
                    counts["unchanged"] += 1
                    continue
            fields = (w.revision, digest, w.name, w.started_at.isoformat(), w.ended_at.isoformat(),
                      w.started_at.astimezone(timezone()).date().isoformat(), w.detail_level, w.source_bundle)
            if old:
                workout_id = old["id"]
                c.execute("""UPDATE workouts SET revision=?,payload_hash=?,name=?,started_at=?,ended_at=?,local_date=?,
                    detail_level=?,source_bundle=?,received_at=CURRENT_TIMESTAMP WHERE id=?""", (*fields, workout_id))
                c.execute("DELETE FROM exercise_sets WHERE workout_id=?", (workout_id,))
                counts["updated"] += 1
            else:
                workout_id = c.execute("""INSERT INTO workouts (revision,payload_hash,name,started_at,ended_at,
                    local_date,detail_level,source_bundle,source,external_id) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                                       (*fields, batch.source, w.external_id)).lastrowid
                counts["inserted"] += 1
            for i, s in enumerate(w.sets):
                target, secondary = targets(s.exercise)
                c.execute("""INSERT INTO exercise_sets
                    (workout_id,ordinal,exercise,target,secondary,reps,load_kg,rir,warmup,side,equipment_id,resistance_mode,technique_json)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                          (workout_id, i, s.exercise, target, secondary, s.reps,
                           s.load * (0.45359237 if s.unit == "lb" else 1), s.rir, s.warmup, s.side,
                           s.equipment_id, s.resistance_mode, s.technique.model_dump_json() if s.technique else None))
    return counts
