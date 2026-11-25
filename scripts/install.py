#!/usr/bin/env python3
"""One-command setup for macOS, Windows and Linux. Safe to re-run.

Creates .venv, installs dependencies, creates the private .env and the local
database, and checks that the prebuilt web interface is present.
"""
import os
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENV = ROOT / ".venv"
STATIC_INDEX = ROOT / "aesthetic_lab/opengym_static/index.html"


def venv_python() -> Path:
    return VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def child_env():
    # The data files contain non-ASCII text; Windows would otherwise guess a legacy code page.
    return {**os.environ, "PYTHONUTF8": "1", "PYTHONUNBUFFERED": "1"}


def step(message):
    print(f"\n==> {message}", flush=True)


def run(args, **kwargs):
    subprocess.run([str(a) for a in args], check=True, cwd=kwargs.pop("cwd", ROOT), env=child_env(), **kwargs)


def main():
    if sys.version_info < (3, 11):
        raise SystemExit(f"Python 3.11 or newer is required (this is {sys.version.split()[0]}). "
                         "Install it from https://www.python.org/downloads/ and run this again.")
    if not (ROOT / "pyproject.toml").exists():
        raise SystemExit("Run this from inside the Aesthetic Lab folder.")

    step("Creating the private Python environment (.venv)")
    if not venv_python().exists():
        venv.EnvBuilder(with_pip=True, clear=False).create(VENV)
    else:
        print("Already exists.")

    step("Installing dependencies (a minute or two the first time)")
    run([venv_python(), "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--upgrade", "pip"])
    run([venv_python(), "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "-e", "."])

    step("Creating your private configuration and database")
    run([venv_python(), "scripts/bootstrap.py"])

    step("Checking the web interface")
    if STATIC_INDEX.exists():
        print("Prebuilt interface found. Node.js is not needed.")
    else:
        npm = "npm.cmd" if os.name == "nt" else "npm"
        try:
            run([npm, "--version"], capture_output=True)
        except (OSError, subprocess.CalledProcessError):
            raise SystemExit("The prebuilt interface is missing and Node.js 22.12+ was not found. "
                             "Install Node.js from https://nodejs.org and run this again.")
        run([npm, "ci", "--ignore-scripts"], cwd=ROOT / "opengym/frontend")
        run([venv_python(), "scripts/build_tracker.py"])

    step("Done")
    print("Start the app with:  python scripts/run.py   (or double-click the Start launcher for your system)")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"\nSetup step failed (exit {exc.returncode}): {' '.join(map(str, exc.cmd))}")
