"""Convenience entry point: python claude_analyser.py."""
from aesthetic_lab.coaching import CoachError, run_coach
from aesthetic_lab.db import initialize

if __name__ == "__main__":
    initialize()
    try:
        print(run_coach()["message"])
    except CoachError as exc:
        raise SystemExit(str(exc)) from None
