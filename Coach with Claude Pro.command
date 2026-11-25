#!/bin/zsh
set -eu
cd -- "${0:A:h}"
exec .venv/bin/python scripts/claude_coach.py
