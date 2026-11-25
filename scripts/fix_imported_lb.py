#!/usr/bin/env python3
"""One-off repair: imported OpenGym sessions hold pound values in the kilogram fields.

Dry run by default. With --apply it backs up the database, scales every imported workout (and the
legacy "last used" cache entries that came from them) by lb->kg, and saves through the tracker's own
write path so exercise_sets is regenerated and the sync revision moves forward.
"""
import argparse
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from aesthetic_lab.config import db_path  # noqa: E402  (path set above)

LB_TO_KG = 0.45359237
NATIVE_FROM = '2026-11-01'  # first session logged natively in kg


def kg(value):
    return round(value * LB_TO_KG, 2)


def is_imported(workout):
    return workout.get('name') == 'Imported' and str(workout.get('id', '')).startswith('iwmvx4wf9')


def convert(state):
    changed = {'workouts': 0, 'sets': 0, 'exWeights': []}
    for workout in state['workouts']:
        if not is_imported(workout):
            continue
        changed['workouts'] += 1
        for entry in workout['entries']:
            for s in entry['sets']:
                if isinstance(s.get('w'), (int, float)):
                    s['w'] = kg(s['w'])
                    changed['sets'] += 1
            if isinstance(entry.get('topW'), (int, float)):
                entry['topW'] = kg(entry['topW'])
        workout['vol'] = round(sum((s.get('w') or 0) * (s.get('r') or 0)
                                   for e in workout['entries'] for s in e['sets'] if s.get('done')), 2)
    for key, value in state['exWeights'].items():
        # Identity keys ("exercise:...") are written by the kg tracker itself; legacy id keys with a
        # pre-November date are the import's personal-best cache.
        if key.startswith('exercise:') or 'at' in value or str(value.get('d', '')) >= NATIVE_FROM:
            continue
        before = value['w']
        value['w'] = kg(before)
        changed['exWeights'].append((key, before, value['w']))
    return changed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    db = db_path()
    con = sqlite3.connect(db)
    payload, revision = con.execute('SELECT payload,revision FROM tracker_state WHERE id=1').fetchone()
    state = json.loads(payload)
    imported = sum(1 for w in state['workouts'] if is_imported(w))
    if imported != 27:
        raise SystemExit(f'Expected 27 imported workouts, found {imported}; refusing to continue.')
    peak_before = max(s['w'] for w in state['workouts'] if is_imported(w) for e in w['entries'] for s in e['sets'])
    changed = convert(state)
    peak_after = max(s['w'] for w in state['workouts'] if is_imported(w) for e in w['entries'] for s in e['sets'])
    print(f"database: {db}  revision: {revision}")
    print(f"workouts: {changed['workouts']}  sets: {changed['sets']}  legacy cache entries: {len(changed['exWeights'])}")
    print(f"heaviest imported set: {peak_before} -> {peak_after}")
    if not args.apply:
        print('Dry run only. Re-run with --apply.')
        return
    backup = ROOT / 'var/backups' / f"pre-lb-fix-{__import__('time').strftime('%Y%m%d-%H%M%S')}.sqlite3"
    out = sqlite3.connect(backup)
    con.backup(out)
    assert out.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    out.close()
    print('backup:', backup)
    from aesthetic_lab.tracker import StateUpdate, put_data
    print(put_data(StateUpdate(state=state, revision=revision)))


if __name__ == '__main__':
    main()
