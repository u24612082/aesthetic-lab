import asyncio
import json
import os
import time
from pathlib import Path

from .coaching import CoachError, run_coach
from .db import event
from .ingest import ingest
from .models import IngestBatch
from .auto_coach import request_review


def scan_inbox():
    if os.getenv('APP_TRACKER_MODE','native')=='native':
        return
    if os.getenv("APP_DEMO", "false").lower() == "true":
        return  # A demo must never consume/archive real files from the shared inbox.
    setting = os.getenv("APP_INBOX", "")
    if not setting:
        return
    inbox = Path(setting).expanduser()
    inbox.mkdir(parents=True, exist_ok=True, mode=0o700)
    for path in sorted(inbox.glob("*.json"))[:25]:
        if path.is_symlink() or time.time() - path.stat().st_mtime < 10:
            continue
        try:
            if path.stat().st_size > 2_000_000:
                raise ValueError("Oversized payload")
            batch = IngestBatch.model_validate_json(path.read_bytes())
            result = ingest(batch)
        except (ValueError, json.JSONDecodeError):
            folder = inbox / "rejected"
            folder.mkdir(exist_ok=True)
            path.rename(folder / f"{time.time_ns()}-{path.name}")
            event("icloud", "rejected", "Invalid JSON, schema, or revision. Check rejected file against docs/schema.json.")
        else:
            folder = inbox / "processed"
            folder.mkdir(exist_ok=True)
            path.rename(folder / f"{time.time_ns()}-{path.name}")
            event("icloud", "ok", json.dumps(result))


async def background_worker():
    next_coach = 0
    next_nutrition = 0
    while True:
        if time.monotonic()>=next_nutrition:
            next_nutrition=time.monotonic()+60
            try:
                from .nutrition_plan import consider_adjustment
                await asyncio.to_thread(consider_adjustment)
            except Exception:event('nutrition','error','Macro-plan analysis could not update; existing targets are preserved.')
        if os.getenv('COACH_PROVIDER')=='subscription':
            try:await asyncio.to_thread(request_review,automatic=True)
            except Exception:event('coach','error','Automatic coaching could not check for changes. Retrying later.')
        try:
            await asyncio.to_thread(scan_inbox)
        except Exception as exc:
            event("icloud", "error", f"Inbox unavailable ({type(exc).__name__}); will retry.")
        if time.monotonic() >= next_coach:
            # Throttle failed calls too; no runaway paid API retry loop.
            ai_enabled = os.getenv('COACH_PROVIDER')!='subscription' and os.getenv("AUTO_COACH", "false").lower() == "true" and bool(os.getenv("ANTHROPIC_API_KEY"))
            next_coach = time.monotonic() + (max(60, int(os.getenv("COACH_INTERVAL_SECONDS", "1800"))) if ai_enabled else 5)
            try:
                await asyncio.to_thread(run_coach)
            except CoachError:
                pass  # run_coach persists a safe, actionable error for the dashboard.
        await asyncio.sleep(5)
