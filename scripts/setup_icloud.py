#!/usr/bin/env python3
"""Prepare an iCloud JSON inbox; the live SQLite database stays on local disk."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from dotenv import dotenv_values, set_key


def prepare(root=ROOT, cloud_root=None):
    cloud_root = cloud_root or Path.home() / "Library/Mobile Documents/com~apple~CloudDocs"
    if not cloud_root.is_dir():
        raise RuntimeError("iCloud Drive is not available on this Mac. Enable it in System Settings first.")
    env_path = root / ".env"
    if not env_path.exists():
        raise RuntimeError("Run scripts/bootstrap.py first.")
    inbox = cloud_root / "AestheticLab/inbox"
    previous = dotenv_values(env_path).get("APP_INBOX")
    if previous and Path(previous).expanduser().resolve() != inbox.resolve():
        raise RuntimeError("An alternative APP_INBOX is already configured; preserve it or update .env explicitly.")
    inbox.mkdir(parents=True, exist_ok=True, mode=0o700)
    set_key(str(env_path), "APP_INBOX", str(inbox), quote_mode="always")
    env_path.chmod(0o600)
    return inbox


if __name__ == "__main__":
    try:
        folder = prepare()
        print(f"Mac inbox prepared: {folder}")
        print("On your iPhone choose iCloud Drive → AestheticLab → inbox in Aesthetic Bridge.")
        print("Restart the Mac service after this setting change. No workouts have been transferred by setup.")
    except (OSError, RuntimeError) as exc:
        raise SystemExit(f"iCloud setup: {exc}")
