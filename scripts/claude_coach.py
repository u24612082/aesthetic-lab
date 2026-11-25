#!/usr/bin/env python3
"""Launch the official Claude Code client with subscription authentication only."""
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent


import sys
sys.path.insert(0,str(ROOT))
from aesthetic_lab.claude_client import candidate_binaries, find_claude, clean_environment


def main(check_only=False):
    clean=clean_environment()
    binary=find_claude(clean)
    if not binary:raise SystemExit('No working Claude Code executable was found in PATH, standard install locations or your official IDE extension. Repair/install Claude Code: https://code.claude.com/docs/en/quickstart')
    check=subprocess.run([binary,'auth','status','--json'],capture_output=True,text=True,env=clean,timeout=15)
    try:auth=json.loads(check.stdout)
    except ValueError:auth={}
    if not auth.get('loggedIn') or auth.get('authMethod')!='claude.ai' or auth.get('subscriptionType') not in ('pro','max','team','enterprise'):
        if check_only:raise SystemExit('Claude Code was found, but subscription sign-in is needed. Open the coach launcher to sign in through Claude.')
        print('Sign in through Claude’s own browser flow with your subscription account. No API credentials are accepted here.')
        subprocess.run([binary,'auth','login'],env=clean,check=True)
        return main(check_only=check_only)
    print('Using Claude Code: '+binary,flush=True)
    print('Claude subscription sign-in confirmed. Usage is subject to your plan limits; do not opt into extra usage or API billing.')
    print('Approve the local aesthetic-lab MCP server if prompted. Then enter /aesthetic-audit to review live data and save an audit to your dashboard.')
    if check_only:return
    os.chdir(ROOT)
    os.execve(binary,[binary],clean)


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true',help='Verify discovery and subscription sign-in without starting a chat')
    main(check_only=parser.parse_args().check)
