#!/bin/zsh
set -eu
cd -- "${0:A:h}"

if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
fi

if ! .venv/bin/python -c 'import aesthetic_lab.server, aesthetic_lab.app' >/dev/null 2>&1; then
  .venv/bin/python -m pip install -e .
fi

if [[ ! -f .env ]]; then
  .venv/bin/python scripts/bootstrap.py
fi

if [[ ! -f aesthetic_lab/opengym_static/index.html ]]; then
  if ! command -v npm >/dev/null 2>&1; then
    print 'Install Node.js 22.12+ to build the OpenGym frontend, then reopen this launcher.'
    read -r
    exit 1
  fi
  (cd opengym/frontend && npm ci --ignore-scripts)
  .venv/bin/python scripts/build_tracker.py
fi

if ! .venv/bin/python scripts/mac.py; then
  print '\nPress Return to close this window.'
  read -r
  exit 1
fi
