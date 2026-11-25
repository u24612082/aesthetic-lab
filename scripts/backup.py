#!/usr/bin/env python3
"""Consistent online SQLite backup; suitable for copying to iCloud afterward."""
import argparse
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from aesthetic_lab.config import db_path

parser = argparse.ArgumentParser()
parser.add_argument("destination", type=Path)
args = parser.parse_args()
if not db_path().exists():
    raise SystemExit("Database not initialized")
destination = args.destination.expanduser().resolve()
if destination == db_path() or destination.exists():
    raise SystemExit("Choose a new backup file, separate from the live database")
destination.parent.mkdir(parents=True, exist_ok=True)
with sqlite3.connect(db_path()) as source, sqlite3.connect(destination) as backup:
    source.backup(backup)
destination.chmod(0o600)
print(f"Backup written to {destination}")
