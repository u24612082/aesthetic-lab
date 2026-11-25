import json
import sqlite3
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path

from .config import db_path

SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_versions (version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO schema_versions VALUES (1);
CREATE TABLE IF NOT EXISTS workouts (
 id INTEGER PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL,
 revision INTEGER NOT NULL, payload_hash TEXT NOT NULL, name TEXT NOT NULL,
 started_at TEXT NOT NULL, ended_at TEXT NOT NULL, local_date TEXT NOT NULL,
 detail_level TEXT NOT NULL CHECK(detail_level IN ('summary','sets')),
 source_bundle TEXT, received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(source, external_id)
);
CREATE TABLE IF NOT EXISTS exercise_sets (
 id INTEGER PRIMARY KEY, workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
 ordinal INTEGER NOT NULL, exercise TEXT NOT NULL, target TEXT NOT NULL,
 secondary TEXT, reps INTEGER NOT NULL CHECK(reps>0), load_kg REAL NOT NULL CHECK(load_kg>=0),
 rir REAL, warmup INTEGER NOT NULL DEFAULT 0, side TEXT NOT NULL,
 UNIQUE(workout_id,ordinal)
);
CREATE INDEX IF NOT EXISTS sets_workout ON exercise_sets(workout_id);
CREATE INDEX IF NOT EXISTS workouts_date ON workouts(local_date);
CREATE TABLE IF NOT EXISTS foods (
 id INTEGER PRIMARY KEY, barcode TEXT UNIQUE, name TEXT NOT NULL, brand TEXT NOT NULL,
 kcal REAL NOT NULL CHECK(kcal>=0), protein REAL NOT NULL CHECK(protein>=0),
 carbs REAL NOT NULL CHECK(carbs>=0), fat REAL NOT NULL CHECK(fat>=0),
 basis TEXT NOT NULL DEFAULT 'per 100 g as sold', provenance TEXT NOT NULL,
 verified INTEGER NOT NULL DEFAULT 0, source_url TEXT, seed_key TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS food_logs (
 id INTEGER PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, food_id INTEGER REFERENCES foods(id),
 local_date TEXT NOT NULL, meal TEXT NOT NULL, grams REAL NOT NULL CHECK(grams>0),
 food_name TEXT NOT NULL, kcal REAL NOT NULL, protein REAL NOT NULL,
 carbs REAL NOT NULL, fat REAL NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS food_logs_date ON food_logs(local_date);
CREATE TABLE IF NOT EXISTS coach_reports (
 id INTEGER PRIMARY KEY, fingerprint TEXT NOT NULL, mode TEXT NOT NULL,
 report TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sync_events (
 id INTEGER PRIMARY KEY, transport TEXT NOT NULL, status TEXT NOT NULL,
 message TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tracker_state (
 id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS coach_jobs (
 id INTEGER PRIMARY KEY, fingerprint TEXT NOT NULL, state TEXT NOT NULL,
 requested_at REAL NOT NULL, started_at REAL, finished_at REAL, retry_after REAL,
 message TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_coach ON coach_jobs((1)) WHERE state IN ('queued','running');
CREATE TABLE IF NOT EXISTS nutrition_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), kcal REAL, protein REAL, carbs REAL, fat REAL
);
CREATE TABLE IF NOT EXISTS device_pairing (
 id INTEGER PRIMARY KEY CHECK(id=1), code_hash TEXT NOT NULL, expires_at REAL NOT NULL
);
"""


@contextmanager
def connect():
    connection = sqlite3.connect(db_path(), timeout=15)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA busy_timeout=15000")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize():
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with connect() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(SCHEMA)
        columns = {r[1] for r in c.execute("PRAGMA table_info(exercise_sets)")}
        for name, declaration in {"equipment_id": "TEXT", "resistance_mode": "TEXT NOT NULL DEFAULT 'unknown'", "technique_json": "TEXT"}.items():
            if name not in columns:
                c.execute(f"ALTER TABLE exercise_sets ADD COLUMN {name} {declaration}")
        c.execute("INSERT OR IGNORE INTO schema_versions VALUES (2)")
        c.execute("INSERT OR IGNORE INTO schema_versions VALUES (3)")
        c.execute("INSERT OR IGNORE INTO schema_versions VALUES (4)")
        food_columns={r[1] for r in c.execute('PRAGMA table_info(foods)')}
        for name,decl in {'category':"TEXT NOT NULL DEFAULT 'Other'",'featured':'INTEGER NOT NULL DEFAULT 0',
                          'favorite':'INTEGER NOT NULL DEFAULT 0','portions_json':"TEXT NOT NULL DEFAULT '[]'",'search_terms':"TEXT NOT NULL DEFAULT ''"}.items():
            if name not in food_columns:c.execute(f'ALTER TABLE foods ADD COLUMN {name} {decl}')
        c.execute('INSERT OR IGNORE INTO schema_versions VALUES (5)')
        c.execute('CREATE TABLE IF NOT EXISTS offline_receipts(id TEXT PRIMARY KEY,digest TEXT NOT NULL,response TEXT NOT NULL)')
        c.execute('CREATE TABLE IF NOT EXISTS offline_food_ids(local_id INTEGER PRIMARY KEY,food_id INTEGER NOT NULL REFERENCES foods(id))')
        c.execute('INSERT OR IGNORE INTO schema_versions VALUES (6)')
        c.execute("CREATE TABLE IF NOT EXISTS nutrition_plan(id INTEGER PRIMARY KEY CHECK(id=1),profile TEXT NOT NULL,starting_weight REAL NOT NULL,initial_tdee REAL NOT NULL,started_at REAL NOT NULL,last_adjusted REAL NOT NULL)")
        c.execute("CREATE TABLE IF NOT EXISTS nutrition_plan_history(id INTEGER PRIMARY KEY,fingerprint TEXT NOT NULL UNIQUE,created_at REAL NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,reason TEXT NOT NULL,evidence_json TEXT NOT NULL)")
        c.execute("CREATE TABLE IF NOT EXISTS nutrition_days(local_date TEXT PRIMARY KEY,complete INTEGER NOT NULL DEFAULT 0)")
        c.execute('INSERT OR IGNORE INTO schema_versions VALUES (7)')
        foods = json.loads((Path(__file__).parent / "data/foods.json").read_text(encoding='utf-8'))
        for food in foods:
            c.execute("""INSERT OR IGNORE INTO foods
                (seed_key,name,brand,kcal,protein,carbs,fat,basis,provenance)
                VALUES (:key,:name,:brand,:kcal,:protein,:carbs,:fat,:basis,:provenance)""", food)
            c.execute("UPDATE foods SET featured=1,category='South African staples' WHERE seed_key=?",(food['key'],))
        c.executemany('''INSERT OR IGNORE INTO foods(seed_key,name,brand,kcal,protein,carbs,fat,basis,provenance,source_url,category,featured,portions_json,search_terms)
            VALUES (:key,:name,:brand,:kcal,:protein,:carbs,:fat,:basis,:provenance,:source_url,:category,:featured,:portions_json,:search_terms)''',reference_foods())
        supplements=json.loads((Path(__file__).parent/'data/supplement_foods.json').read_text(encoding='utf-8'))
        c.executemany('INSERT OR IGNORE INTO foods(seed_key,barcode,name,brand,kcal,protein,carbs,fat,basis,provenance,source_url,category,featured,portions_json,search_terms) VALUES(:key,:barcode,:name,:brand,:kcal,:protein,:carbs,:fat,:basis,:provenance,:source_url,:category,:featured,:portions_json,:search_terms)',supplements)
        plan_products=json.loads((Path(__file__).parent/'data/diet_plan_foods.json').read_text(encoding='utf-8'))['products']
        c.executemany('''INSERT OR IGNORE INTO foods(seed_key,name,brand,kcal,protein,carbs,fat,basis,provenance,source_url,category,featured,portions_json,search_terms)
            VALUES (:key,:name,:brand,:kcal,:protein,:carbs,:fat,:basis,:provenance,:source_url,:category,:featured,:portions_json,:search_terms)''',plan_products)
    path.chmod(0o600)


@lru_cache(maxsize=1)
def reference_foods():
    rows=json.loads((Path(__file__).parent/'data/usda_foods.json').read_text(encoding='utf-8'))
    return tuple({**r,'portions_json':json.dumps(r['portions'])} for r in rows)


def event(transport: str, status: str, message: str):
    with connect() as c:
        c.execute("INSERT INTO sync_events(transport,status,message) VALUES (?,?,?)", (transport, status, message[:300]))
        c.execute("DELETE FROM sync_events WHERE id NOT IN (SELECT id FROM sync_events ORDER BY id DESC LIMIT 200)")
