#!/usr/bin/env python3
"""Create a separate, explicitly synthetic demonstration database."""
import os
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ["APP_DB"] = str(ROOT / "var/demo.sqlite3")
from aesthetic_lab.analytics import today
from aesthetic_lab.claude_analyser import analyse
from aesthetic_lab.config import timezone
from aesthetic_lab.db import connect, initialize
from aesthetic_lab.ingest import ingest
from aesthetic_lab.models import IngestBatch

initialize()
exercises = [[("Incline Dumbbell Press", 32), ("Cable Lateral Raise", 10), ("Triceps Pushdown", 35)],
             [("Lat Pulldown", 70), ("Chest Supported Row", 50), ("Dumbbell Curl", 16)],
             [("Hack Squat", 100), ("Romanian Deadlift", 90), ("Seated Leg Curl", 45), ("Standing Calf Raise", 70)]]
for i, offset in enumerate([26,24,22,19,17,15,12,10,8,5,3,1]):
    start = datetime.combine(today()-timedelta(days=offset), datetime.min.time(), tzinfo=timezone()).replace(hour=17)
    lifts = exercises[i%3]
    workout = {"external_id": f"DEMO-{offset}", "revision":2, "name": ["Upper · Push & delts", "Upper · Back & arms", "Lower · Strength & shape"][i%3],
               "started_at": start.isoformat(), "ended_at": (start+timedelta(minutes=68)).isoformat(), "detail_level": "sets",
               "sets": [{"exercise": exercise,"reps":10-(j%3),"load":load,"rir":2 if j<2 else 1,"side":"bilateral"} for exercise,load in lifts for j in range(3)]}
    ingest(IngestBatch.model_validate({"source":"liftoff-adapter","workouts":[workout]}))
with connect() as c:
    for day in range(7):
        for food,grams,meal in [("ww-ostrich",250,"Dinner"),("sasko-oats",100,"Breakfast"),("tastic-rice",160,"Dinner"),("ww-whites",200,"Breakfast"),("pnp-chicken",250,"Lunch"),("futurelife",100,"Snacks")]:
            item=c.execute("SELECT * FROM foods WHERE seed_key=?",(food,)).fetchone()
            values=[item[k]*grams/100 for k in ("kcal","protein","carbs","fat")]
            date=(today()-timedelta(days=day)).isoformat()
            c.execute("""INSERT OR IGNORE INTO food_logs(request_id,food_id,local_date,meal,grams,food_name,kcal,protein,carbs,fat)
                VALUES (?,?,?,?,?,?,?,?,?,?)""",(f"demo-{date}-{food}",item["id"],date,meal,grams,item["name"],*values))
os.environ["AUTO_COACH"]="false"
analyse()
print("Synthetic demo created in var/demo.sqlite3. Personal database untouched.")
print("APP_DB=var/demo.sqlite3 APP_DEMO=true APP_PORT=8766 .venv/bin/python -m aesthetic_lab.server")
