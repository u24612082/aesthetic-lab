#!/usr/bin/env python3
"""Install if needed, start Aesthetic Lab in the background and open it in your browser.

Works on macOS, Windows and Linux. Use --stop to stop the background server.
"""
import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import webbrowser
from pathlib import Path
from urllib.request import ProxyHandler, build_opener

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import install  # noqa: E402  (sibling script)

PID_FILE = ROOT / "var/server.pid"
LOG_FILE = ROOT / "var/logs/server.log"


def read_env():
    values = {}
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def base_url(env):
    return f"http://127.0.0.1:{int(env.get('APP_PORT', '8765'))}"


def ready(base):
    try:
        # A system proxy must never see this local traffic.
        with build_opener(ProxyHandler({})).open(base + "/api/health", timeout=2) as response:
            return json.load(response).get("status") == "ok"
    except (OSError, ValueError):
        return False


def copy_to_clipboard(text):
    commands = {"darwin": ["pbcopy"], "win32": ["clip"]}
    command = commands.get(sys.platform) or next(([c] for c in ("wl-copy", "xclip") if shutil.which(c)), None)
    if not command:
        return False
    try:
        subprocess.run(command, input=text.encode("utf-16-le" if sys.platform == "win32" else "utf-8"), check=True)
        return True
    except (OSError, subprocess.CalledProcessError):
        return False


def start_server():
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    flags = {}
    if os.name == "nt":
        flags["creationflags"] = (subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
                                  | subprocess.CREATE_NO_WINDOW)
    else:
        flags["start_new_session"] = True
    with LOG_FILE.open("ab") as log:
        process = subprocess.Popen([str(install.venv_python()), "-m", "aesthetic_lab.server"], cwd=ROOT,
                                   env=install.child_env(), stdin=subprocess.DEVNULL, stdout=log, stderr=log, **flags)
    PID_FILE.write_text(str(process.pid), encoding="utf-8")
    return process


def stop_server():
    if not PID_FILE.exists():
        print("No background server started by this script was found.")
        return
    pid = int(PID_FILE.read_text(encoding="utf-8").strip())
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
    else:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    PID_FILE.unlink(missing_ok=True)
    print("Aesthetic Lab stopped. Your data is kept.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stop", action="store_true", help="Stop the background server")
    parser.add_argument("--no-open", action="store_true", help="Do not open a browser window")
    args = parser.parse_args()
    if args.stop:
        return stop_server()

    first_run = not (ROOT / ".env").exists()
    if first_run or not install.venv_python().exists() or not install.STATIC_INDEX.exists():
        install.main()
    env = read_env()
    base = base_url(env)

    if ready(base):
        print(f"Already running: {base}")
    else:
        process = start_server()
        for _ in range(60):
            if ready(base):
                break
            if process.poll() is not None:
                raise SystemExit(f"The server stopped during start-up. See {LOG_FILE}")
            time.sleep(0.5)
        else:
            raise SystemExit(f"The server did not become ready. See {LOG_FILE}")
        print(f"Aesthetic Lab is running: {base}")

    token = env.get("APP_TOKEN", "")
    if token and copy_to_clipboard(token):
        print("Your pairing token is copied to the clipboard. Paste it into the pairing box on first use.")
    else:
        print("On first use, paste APP_TOKEN from the .env file in this folder into the pairing box.")
    if not args.no_open:
        webbrowser.open(base)
    print("Stop it later with:  python scripts/run.py --stop")


if __name__ == "__main__":
    main()
