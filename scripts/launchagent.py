#!/usr/bin/env python3
"""Install/start or remove a per-user macOS background service."""
import argparse
import os
import plistlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LABEL = "local.aesthetic-lab"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["install", "uninstall", "status"])
    args = parser.parse_args()
    if sys.platform != "darwin":
        raise SystemExit("LaunchAgents require macOS. Use python -m aesthetic_lab.server elsewhere.")
    target = f"gui/{os.getuid()}"
    plist_path = Path.home() / "Library/LaunchAgents" / f"{LABEL}.plist"
    if args.action == "status":
        subprocess.run(["launchctl", "print", f"{target}/{LABEL}"], check=False)
        return
    if args.action == "uninstall":
        subprocess.run(["launchctl", "bootout", f"{target}/{LABEL}"], check=False, capture_output=True)
        plist_path.unlink(missing_ok=True)
        print("Background service removed. Local data is preserved.")
        return
    if not (ROOT / ".env").exists():
        raise SystemExit("Run scripts/bootstrap.py first.")
    sys.path.insert(0, str(ROOT))
    from aesthetic_lab.config import token
    from aesthetic_lab.server import validated_binds
    token()
    validated_binds()
    logs = ROOT / "var/logs"
    logs.mkdir(parents=True, exist_ok=True, mode=0o700)
    plist_path.parent.mkdir(parents=True, exist_ok=True)
    config = {"Label": LABEL, "ProgramArguments": [str(ROOT / ".venv/bin/python"), "-m", "aesthetic_lab.server"],
              "WorkingDirectory": str(ROOT), "RunAtLoad": True, "KeepAlive": True, "ThrottleInterval": 15,
              "Umask": 0o077, "StandardOutPath": str(logs / "server.log"), "StandardErrorPath": str(logs / "server-error.log"),
              "EnvironmentVariables": {"PYTHONUNBUFFERED": "1"}}
    plist_path.write_bytes(plistlib.dumps(config))
    plist_path.chmod(0o600)
    subprocess.run(["launchctl", "bootout", f"{target}/{LABEL}"], check=False, capture_output=True)
    subprocess.run(["launchctl", "bootstrap", target, str(plist_path)], check=True)
    print(f"Started {LABEL}. Logs: {logs}")


if __name__ == "__main__":
    main()
