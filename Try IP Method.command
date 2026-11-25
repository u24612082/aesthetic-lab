#!/bin/zsh
set -eu
cd -- "${0:A:h}"
if ! .venv/bin/python scripts/ip_trial.py; then
  print '\nThe trial could not open. Your normal app has been left as it was.'
  read -r '?Press Return to close.'
fi
