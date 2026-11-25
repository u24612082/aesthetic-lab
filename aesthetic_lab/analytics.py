from collections import defaultdict
import os
from datetime import datetime, timedelta

from .config import timezone
from .db import connect
from .ingest import MOVEMENTS
from .progression import technique_gates
from .body_metrics import body_metrics


def today():
    return datetime.now(timezone()).date()


def dashboard(days=7, end=None):
    end = end or today()
    start = end - timedelta(days=days - 1)
    previous = start - timedelta(days=days)
    with connect() as c:
        workouts = [dict(r) for r in c.execute("SELECT * FROM workouts WHERE local_date BETWEEN ? AND ? ORDER BY started_at DESC", (previous.isoformat(), end.isoformat()))]
        sets = [dict(r) for r in c.execute("""SELECT s.*,w.local_date,w.started_at FROM exercise_sets s
            JOIN workouts w ON w.id=s.workout_id WHERE w.local_date BETWEEN ? AND ? ORDER BY w.started_at,s.ordinal""",
                                         (previous.isoformat(), end.isoformat()))]
        logs = [dict(r) for r in c.execute("SELECT * FROM food_logs WHERE local_date BETWEEN ? AND ? ORDER BY id DESC", (start.isoformat(), end.isoformat()))]
        last_sync = c.execute("SELECT * FROM sync_events ORDER BY id DESC LIMIT 1").fetchone()
        latest = c.execute("SELECT * FROM coach_reports ORDER BY id DESC LIMIT 1").fetchone()
        if os.getenv('COACH_PROVIDER')=='subscription':
            pro = c.execute("SELECT * FROM coach_reports WHERE mode='claude_pro' ORDER BY id DESC LIMIT 1").fetchone()
            if pro: latest=pro
    current = [w for w in workouts if w["local_date"] >= start.isoformat()]
    active = [s for s in sets if s["local_date"] >= start.isoformat() and not s["warmup"]]
    groups = {target for pair in MOVEMENTS.values() for target in pair if target}
    volume = {g: {"target": g, "direct_sets": 0, "secondary_sets": 0, "known_hard_sets": 0, "unknown_rir_sets": 0} for g in sorted(groups)}
    unmapped = set()
    for s in active:
        if s["target"] == "Unmapped":
            unmapped.add(s["exercise"])
            continue
        v = volume[s["target"]]
        v["direct_sets"] += 1
        v["known_hard_sets"] += int(s["rir"] is not None and s["rir"] <= 4)
        v["unknown_rir_sets"] += int(s["rir"] is None)
        if s["secondary"]:
            volume[s["secondary"]]["secondary_sets"] += 1
    # Compare best Epley estimates from two distinct sessions, same movement and side.
    sessions = defaultdict(dict)
    for s in sets:
        if s["warmup"] or s["load_kg"] == 0 or s["reps"] > 12 or s["rir"] is None or s["rir"] > 2:
            continue
        key = (s["exercise"].lower(), s["side"], s["equipment_id"], s["resistance_mode"])
        estimate = s["load_kg"] * (1 + s["reps"] / 30)
        old = sessions[key].get(s["workout_id"])
        if not old or estimate > old["e1rm"]:
            sessions[key][s["workout_id"]] = {"date": s["started_at"], "local_date": s["local_date"], "e1rm": estimate, "exercise": s["exercise"]}
    fatigue = []
    for (_, side, _, _), values in sessions.items():
        points = sorted(values.values(), key=lambda s: s["date"])
        if len(points) >= 2 and points[-1]["local_date"] >= start.isoformat():
            delta = (points[-1]["e1rm"] / points[-2]["e1rm"] - 1) * 100
            if delta <= -5:
                fatigue.append({"exercise": points[-1]["exercise"], "side": side, "change_pct": round(delta, 1)})
    # Within-session left/right comparisons only, never infer visual symmetry from group volume.
    bilateral = defaultdict(lambda: defaultdict(list))
    for s in active:
        if s["side"] in ("left", "right") and s["rir"] is not None and s["rir"] <= 2 and s["reps"] <= 12:
            bilateral[(s["workout_id"], s["exercise"], s["equipment_id"], s["resistance_mode"])][s["side"]].append(s["load_kg"] * (1 + s["reps"] / 30))
    symmetry = []
    for (_, exercise, _, _), sides in bilateral.items():
        if sides["left"] and sides["right"]:
            left, right = max(sides["left"]), max(sides["right"])
            if max(left, right) > 0:
                symmetry.append({"exercise": exercise, "gap_pct": round(abs(left-right)/max(left,right)*100, 1)})
    daily = []
    for offset in range(days):
        day = (start + timedelta(days=offset)).isoformat()
        food = [l for l in logs if l["local_date"] == day]
        daily.append({"date": day, "sets": sum(s["local_date"] == day for s in active),
                      "food_entries": len(food), **{k: round(sum(l[k] for l in food), 1) for k in ("kcal", "protein", "carbs", "fat")}})
    body=body_metrics(days,end)
    from .nutrition_plan import plan_status
    plan=plan_status(training={'fatigue':fatigue})
    plan_context={k:plan[k] for k in ('configured','profile','targets','estimated_maintenance_kcal','started_at','assessment','intake_quality','policy')}
    return {"bodyweight":body,"nutrition_plan":plan_context,"period": {"start": start.isoformat(), "end": end.isoformat(), "days": days},
            "workouts": current, "volume": sorted(volume.values(), key=lambda g: -g["direct_sets"]),
            "daily": daily, "food_logs": logs, "fatigue": fatigue, "symmetry": symmetry,
            "stats": {"sessions": len(current), "working_sets": len(active),
                      "known_hard_sets": sum(s["rir"] is not None and s["rir"] <= 4 for s in active),
                      "tonnage_kg": round(sum(s["load_kg"]*s["reps"] for s in active)),
                      "summary_only": sum(w["detail_level"] == "summary" for w in current),
                      "logged_days": sum(d["food_entries"] > 0 for d in daily)},
            "unmapped_exercises": sorted(unmapped), "last_sync": dict(last_sync) if last_sync else None,
            "progression_gates": technique_gates(active),
            "coach": dict(latest) if latest else None,
            "methodology": "Direct working sets exclude warmups. Hard sets require reported RIR ≤4. Secondary sets are shown separately, not added. Tonnage uses reported load, without unilateral doubling. Fatigue is a performance flag, not a diagnosis. No intake inferred on unlogged days."}
