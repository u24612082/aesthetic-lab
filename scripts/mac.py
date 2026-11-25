#!/usr/bin/env python3
"""Open, start or check this Mac's private dashboard without exposing credentials."""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from aesthetic_lab.config import db_path, token
from aesthetic_lab.server import validated_binds


def local_url():
    addresses, cert, _ = validated_binds()
    address = next((a for a in addresses if a == "127.0.0.1"), None)
    if address is None:
        address = next((a for a in addresses if a == "::1"), None)
    if address is None:
        raise ValueError("Mac setup requires APP_BIND to include 127.0.0.1 in .env.")
    host = f"[{address}]" if ":" in address else address
    return f"{'https' if cert else 'http'}://{host}:{int(os.getenv('APP_PORT', '8765'))}"


def get_json(base, path, authenticated=False):
    headers = {"Authorization": "Bearer " + token()} if authenticated else {}
    # A system HTTP proxy must never receive the private token for this local service.
    opener = build_opener(ProxyHandler({}))
    with opener.open(Request(base + path, headers=headers), timeout=3) as response:
        return json.load(response)


def ready(base):
    try:
        health = get_json(base, "/api/health")
        return health.get("status") == "ok" and health.get("schema_version") == 1
    except (OSError, ValueError, HTTPError, URLError):
        return False


def ensure_running(base):
    if ready(base):
        return
    if sys.platform != "darwin":
        raise RuntimeError("Start the server with: .venv/bin/python -m aesthetic_lab.server")
    label = f"gui/{os.getuid()}/local.aesthetic-lab"
    loaded = subprocess.run(["launchctl", "print", label], capture_output=True).returncode == 0
    if loaded:
        subprocess.run(["launchctl", "kickstart", label], check=True, capture_output=True)
    else:
        subprocess.run([str(ROOT / ".venv/bin/python"), str(ROOT / "scripts/launchagent.py"), "install"], check=True)
    for _ in range(20):
        if ready(base):
            return
        time.sleep(0.25)
    raise RuntimeError("The background server did not become ready. Check var/logs/server-error.log.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check the running service without starting it or opening a browser")
    parser.add_argument("--no-open", action="store_true", help="Start/check the service without opening a browser")
    parser.add_argument("--copy-token", action="store_true", help="Copy the pairing token to your Mac clipboard for the first login")
    args = parser.parse_args()
    try:
        base = local_url()
        token()
        if args.check:
            if not ready(base):
                raise RuntimeError("The dashboard is not reachable. Double-click Start Aesthetic Lab.command.")
        else:
            ensure_running(base)
        status = get_json(base, "/api/status", authenticated=True)
        catalogue = get_json(base, "/api/foods", authenticated=True)
        nutrition = get_json(base, '/api/nutrition/settings', authenticated=True)
        get_json(base, "/api/dashboard", authenticated=True)
        print(f"Mac dashboard ready: {base}")
        print(f"Database: {db_path()}")
        food_count=nutrition.get('food_count',len(catalogue)) if isinstance(nutrition,dict) else len(catalogue)
        print(f"Food catalogue: {food_count} items | Workouts: {status['workouts']}")
        print("Coaching: " + ("Automatic Claude Pro reviews" if status.get('subscription_auto') else "Claude enabled" if status["auto_coach"] else "Local rules; no API key required"))
        if args.copy_token:
            if sys.platform != "darwin":
                raise RuntimeError("Clipboard pairing is available on macOS only.")
            subprocess.run(["/usr/bin/pbcopy"], input=token().encode(), check=True)
            print("Pairing token copied to your clipboard. Paste it into the device pairing box.")
        elif not args.check:
            print("First login: copy APP_TOKEN from .env, or run this script with --copy-token.")
        if not args.check and not args.no_open:
            subprocess.run(["/usr/bin/open", base], check=True)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"Mac setup: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
