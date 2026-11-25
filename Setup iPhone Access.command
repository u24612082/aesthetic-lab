#!/bin/zsh
set -eu
cd -- "${0:A:h}"
.venv/bin/python scripts/setup_phone.py
launchctl kickstart -k "gui/$(id -u)/local.aesthetic-lab"
.venv/bin/python scripts/mac.py --no-open
open 'http://127.0.0.1:8765/#/phone'
