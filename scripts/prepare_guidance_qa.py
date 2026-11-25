#!/usr/bin/env python3
"""Prepare a disposable browser-QA workspace separate from both user workspaces."""
import json
import secrets
import shutil
import sqlite3
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from scripts.ip_trial import clone_database

QA=ROOT/'var/ip-guidance-qa'


def main():
    trial=ROOT/'var/ip-method-trial'
    original=json.loads((trial/'manifest.json').read_text(encoding='utf-8'))
    manifest_path=QA/'manifest.json'
    if manifest_path.exists():
        manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
        if manifest.get('qa') is not True or manifest.get('workspace')!=str(QA):
            raise RuntimeError('Refusing to modify an unrecognized QA directory.')
    else:
        if QA.exists():raise RuntimeError('An unidentified QA folder exists; it is preserved.')
        QA.mkdir(mode=0o700)
        clone_database(trial/'data.sqlite3',QA/'data.sqlite3')
        manifest={**original,'id':'guidance-qa-'+secrets.token_hex(12),'token':secrets.token_urlsafe(48),'workspace':str(QA),'qa':True}
        manifest_path.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8');manifest_path.chmod(0o600)
    shutil.copytree(trial/'app/aesthetic_lab',QA/'app/aesthetic_lab',dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('__pycache__','*.pyc','*.sqlite3*'))
    # Remove only the QA copy's nutrition configuration so phase-hold tests are deterministic.
    with sqlite3.connect(QA/'data.sqlite3') as c:c.execute('DELETE FROM nutrition_plan')
    print('Prepared disposable guidance QA on port 8768. Personal and trial databases are read-only sources.')


if __name__=='__main__':main()
