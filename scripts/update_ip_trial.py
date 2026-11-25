#!/usr/bin/env python3
"""Update only the existing isolated trial; preserve its database and the live app."""
import argparse
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from scripts.ip_trial import WORKSPACE,prepare,apply_overlay,replace_once,clone_database,environment,verify_personal_files,ensure_running,open_trial


def install_guidance_hooks(app):
    store=app/'opengym/frontend/src/store/useStore.js'
    replace_once(store,"import { create } from 'zustand'","import { create } from 'zustand'\nimport {reconcileGuidance} from '../lib/guided-progression.js'")
    replace_once(store,' const persist=(S,push=true)=>{',' const persist=(S,push=true)=>{\n  reconcileGuidance(S)')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--no-open',action='store_true')
    parser.add_argument('--no-build',action='store_true',help='Apply source overlay for tests before publishing')
    args=parser.parse_args()
    manifest=prepare()
    if verify_personal_files(ROOT,manifest):
        raise RuntimeError('Personal application files have changed since the snapshot. Review them before updating the trial; nothing was overwritten.')
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    clone_database(WORKSPACE/'data.sqlite3',WORKSPACE/'backups'/('before-guidance-'+stamp+'.sqlite3'))
    apply_overlay(ROOT,WORKSPACE)
    install_guidance_hooks(WORKSPACE/'app')
    if not args.no_build:
        for script in ('scripts/build_tracker.py','scripts/package_source.py'):
            subprocess.run([str(ROOT/'.venv/bin/python'),script],cwd=WORKSPACE/'app',env=environment(WORKSPACE,manifest),check=True)
    if verify_personal_files(ROOT,manifest):
        raise RuntimeError('Personal file verification changed during the trial build. No personal files were restored or overwritten.')
    print('Updated the isolated trial. Existing workouts and blocks are preserved; a pre-update backup is saved.')
    if not args.no_open and not args.no_build:
        ensure_running(WORKSPACE,manifest);open_trial(WORKSPACE)


if __name__=='__main__':
    raise SystemExit(main())
