#!/usr/bin/env python3
"""Initialize private local state without printing credentials."""
import json
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
env = ROOT / ".env"
if not env.exists():
    template = (ROOT / ".env.example").read_text(encoding='utf-8').replace("replace-with-at-least-32-random-characters", secrets.token_urlsafe(48))
    env.write_text(template,encoding='utf-8')
    env.chmod(0o600)
from aesthetic_lab.db import initialize
from aesthetic_lab.models import IngestBatch

initialize()
(ROOT / "docs/schema.json").write_text(json.dumps(IngestBatch.model_json_schema(), indent=2) + "\n", encoding="utf-8")
print("Initialized local SQLite database and pairing configuration in .env.")
print("Start: python scripts/run.py")
print("Open http://127.0.0.1:8765 and pair using APP_TOKEN from .env.")
