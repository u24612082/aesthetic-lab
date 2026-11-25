#!/usr/bin/env python3
"""Launch a frozen IP Method trial without changing the personal application."""
import argparse
import hashlib
import json
import os
import secrets
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
PORT = 8767
URL = f"http://127.0.0.1:{PORT}"
WORKSPACE = ROOT / "var/ip-method-trial"
COPY_DIRECTORIES = ("aesthetic_lab", "opengym/frontend", "scripts")
IGNORE = shutil.ignore_patterns("node_modules", "dist", "__pycache__", ".pytest_cache", ".env", ".env.*", "*.sqlite3*", "*.pyc")


def clone_database(source, destination):
    """SQLite's online backup includes committed WAL data; source stays read-only."""
    source, destination = source.resolve(), destination.resolve()
    if not source.is_file() or destination.exists() or source == destination:
        raise RuntimeError("Choose a new trial database separate from the personal database.")
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as live:
        live.execute("PRAGMA query_only=ON")
        with sqlite3.connect(destination) as trial:
            live.backup(trial)
    destination.chmod(0o600)


def protected_files(root):
    paths = [root / ".env"]
    for relative in COPY_DIRECTORIES:
        paths.extend(p for p in (root / relative).rglob("*") if p.is_file() and not any(
            part in {"node_modules", "__pycache__", "dist", ".pytest_cache"} for part in p.relative_to(root).parts))
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths if p.is_file()}


def verify_personal_files(root, manifest):
    changed = [name for name, digest in manifest["protected_files"].items()
               if not (root / name).is_file() or hashlib.sha256((root / name).read_bytes()).hexdigest() != digest]
    return changed


def environment(workspace, manifest):
    # Do not inherit live database/listener/inbox/Claude credentials or Vite API targets.
    env = {k: v for k, v in os.environ.items() if not k.startswith(
        ("APP_", "ANTHROPIC_", "CLAUDE_", "COACH_", "AUTO_COACH", "VITE_")) and k not in {"API_TARGET", "MEDIA_TARGET", "PYTHONPATH"}}
    env.update({k: str(v) for k, v in dotenv_values(workspace / "app/.env").items() if v is not None})
    env.update(APP_DB=str(workspace / "data.sqlite3"), APP_TOKEN=manifest["token"], APP_BIND="127.0.0.1",
               APP_HOSTS="127.0.0.1,localhost", APP_PORT=str(PORT), APP_DEMO="true", APP_INBOX="",
               APP_TRACKER_MODE="native", APP_PHONE_INTERFACE="", APP_PHONE_TLS_CERT="", APP_PHONE_TLS_KEY="",
               APP_TLS_CERT="", APP_TLS_KEY="", APP_PHONE_HOST="", AUTO_COACH="false", CLAUDE_AUTO_COACH="false",
               COACH_PROVIDER="api", ANTHROPIC_API_KEY="", APP_TRIAL_ROOT=str(workspace),
               APP_TRIAL_ID=manifest["id"], APP_TRIAL_SNAPSHOT=manifest["created_at"],
               APP_LIVE_URL=manifest["personal_url"], PYTHONPATH=str(workspace / "app"))
    return env


def replace_once(path, before, after):
    content = path.read_text(encoding='utf-8')
    if after in content:
        return
    if content.count(before) != 1:
        raise RuntimeError(f"The frozen app has changed; cannot safely patch {path.name}.")
    path.write_text(content.replace(before, after, 1),encoding='utf-8')


def apply_overlay(root, workspace):
    app = workspace / "app"
    overlay = root / "experiments/ip_method/overlay"
    shutil.copytree(overlay, app, dirs_exist_ok=True)
    backend = app / "aesthetic_lab/app.py"
    # Cookies are host-scoped, not port-scoped. A different port alone is insufficient.
    backend.write_text(backend.read_text(encoding='utf-8').replace('"lab_session"', '"lab_ip_trial_session"'))
    replace_once(backend, 'hosts = list({', 'from .trial import install_trial\ninstall_trial(app)\n\nhosts = list({')
    replace_once(backend, 'return {"status": "ok", "schema_version": 1}',
                 'return {"status": "ok", "schema_version": 1, "trial": True, "trial_id": os.environ["APP_TRIAL_ID"]}')
    # No background workers, inbox ingestion, macro adjustments or Claude processes in the trial.
    (app / "aesthetic_lab/worker.py").write_text('import asyncio\n\nasync def background_worker():\n    await asyncio.Event().wait()\n',encoding='utf-8')
    tracker = app / "aesthetic_lab/tracker.py"
    replace_once(tracker, "'tracker':'opengym','demo':", "'tracker':'opengym','trial':True,'snapshot_at':os.environ['APP_TRIAL_SNAPSHOT'],'personal_url':os.environ['APP_LIVE_URL'],'demo':")
    frontend = app / "opengym/frontend/src/App.jsx"
    replace_once(frontend, "import './lab.css'", "import './lab.css'\nimport './trial.css'\nimport TrialBanner from './components/TrialBanner.jsx'\nimport ProgressionBlocks from './views/ProgressionBlocks.jsx'")
    replace_once(frontend, '      <RestTimer />', '      <TrialBanner />\n      <RestTimer />')
    replace_once(frontend, "'SYNTHETIC DEMO WORKSPACE'", "'IP METHOD · ISOLATED TRIAL'")
    replace_once(frontend, '<Route path="/home" element={<Home />} />', '<Route path="/progression-blocks" element={<ProgressionBlocks />} />\n              <Route path="/home" element={<Home />} />')
    sheets = app / "opengym/frontend/src/sheets.jsx"
    replace_once(sheets, 'name: A.name, bw: A.bw,', 'name: A.name, bw: A.bw, ...(A.ipTrial ? {ipTrial: A.ipTrial} : {}),')
    index = app / "opengym/frontend/index.html"
    content = index.read_text(encoding='utf-8')
    import re
    index.write_text(re.sub(r"<title>.*?</title>", "<title>IP Method Trial · Aesthetic Lab</title>", content),encoding='utf-8')


def prepare(root=ROOT, workspace=WORKSPACE, build=True):
    workspace = workspace.resolve()
    manifest_path = workspace / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        if manifest.get("kind") != "aesthetic-ip-trial-v1" or manifest.get("workspace") != str(workspace):
            raise RuntimeError("This folder is not the expected isolated trial.")
        if not (workspace / "data.sqlite3").is_file():
            raise RuntimeError("The trial database is missing. Existing trial files have been preserved.")
        return manifest
    if workspace.exists():
        raise RuntimeError("An incomplete trial folder exists. It has been preserved; choose a fresh folder.")
    settings = dotenv_values(root / ".env")
    source = Path(settings.get("APP_DB") or root / "var/aesthetic.sqlite3").expanduser()
    if not source.is_absolute():
        source = root / source
    workspace.mkdir(parents=True, mode=0o700)
    workspace.chmod(0o700)
    manifest = {"kind": "aesthetic-ip-trial-v1", "id": secrets.token_hex(16), "token": secrets.token_urlsafe(48),
                "workspace": str(workspace), "created_at": datetime.now(timezone.utc).isoformat(),
                "personal_url": "http://127.0.0.1:" + str(int(settings.get("APP_PORT") or 8765)),
                "protected_files": protected_files(root)}
    clone_database(source, workspace / "data.sqlite3")
    clone_database(workspace / "data.sqlite3", workspace / "baseline.sqlite3")
    for relative in COPY_DIRECTORIES:
        shutil.copytree(root / relative, workspace / "app" / relative, ignore=IGNORE)
    for name in ("pyproject.toml", "LICENSE", "NOTICE.md", "README.md", "opengym/LICENSE", "opengym/README.md"):
        if (root / name).is_file():
            (workspace / "app" / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(root / name, workspace / "app" / name)
    # Only fresh trial credentials are written. Never copy the personal .env.
    env_file = workspace / "app/.env"
    env_file.write_text("\n".join(f"{k}={v}" for k, v in {
        "APP_TOKEN": manifest["token"], "APP_DB": str(workspace / "data.sqlite3"),
        "APP_TIMEZONE": settings.get("APP_TIMEZONE") or "Africa/Johannesburg",
        "COACH_PROVIDER": "api", "AUTO_COACH": "false", "CLAUDE_AUTO_COACH": "false"}.items()) + "\n")
    env_file.chmod(0o600)
    apply_overlay(root, workspace)
    if build:
        dependencies = root / "opengym/frontend/node_modules"
        if not dependencies.is_dir():
            raise RuntimeError("Install the existing frontend dependencies before building this isolated trial.")
        shutil.copytree(dependencies, workspace / "app/opengym/frontend/node_modules", symlinks=True)
        subprocess.run([str(root / ".venv/bin/python"), "scripts/build_tracker.py"], cwd=workspace / "app",
                       env=environment(workspace, manifest), check=True)
        subprocess.run([str(root / ".venv/bin/python"), "scripts/package_source.py"], cwd=workspace / "app",
                       env=environment(workspace, manifest), check=True)
    if verify_personal_files(root, manifest):
        raise RuntimeError("Personal source files changed during preparation. Trial files are retained for review.")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n",encoding='utf-8')
    manifest_path.chmod(0o600)
    return manifest


def health():
    try:
        with build_opener(ProxyHandler({})).open(URL + "/api/health", timeout=2) as response:
            return json.load(response)
    except (OSError, ValueError, URLError):
        return None


def ensure_running(workspace, manifest):
    current = health()
    if current:
        if current.get("trial_id") != manifest["id"]:
            raise RuntimeError("Port 8767 is already in use by another app. No process was changed.")
        return
    with (workspace / "server.log").open("ab") as log:
        process = subprocess.Popen([str(ROOT / ".venv/bin/python"), "-m", "aesthetic_lab.server"],
                                   cwd=workspace / "app", env=environment(workspace, manifest),
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    (workspace / "server.pid").write_text(str(process.pid),encoding='utf-8')
    for _ in range(80):
        current = health()
        if current and current.get("trial_id") == manifest["id"]:
            return
        if process.poll() is not None:
            break
        time.sleep(0.15)
    raise RuntimeError("The trial did not start. See var/ip-method-trial/server.log. Your usual app was not restarted.")


def open_trial(workspace):
    ticket = secrets.token_urlsafe(32)
    temporary = workspace / ".open-ticket.tmp"
    temporary.write_text(json.dumps({"digest": hashlib.sha256(ticket.encode()).hexdigest(), "expires": time.time() + 60}))
    temporary.chmod(0o600)
    temporary.replace(workspace / "open-ticket.json")
    subprocess.run(["/usr/bin/open", URL + "/trial/open?ticket=" + ticket], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", action="store_true", help="Create and build the frozen copy without starting it")
    parser.add_argument("--no-open", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--stop", action="store_true", help="Stop only the identified trial server")
    args = parser.parse_args()
    try:
        manifest = prepare()
        if args.prepare:
            print("Isolated trial prepared. Your personal application files are unchanged.")
            return 0
        if args.stop:
            if health() and health().get("trial_id") == manifest["id"]:
                os.kill(int((WORKSPACE / "server.pid").read_text(encoding='utf-8')), signal.SIGTERM)
            print("Trial stopped. Personal app left running.")
            return 0
        if args.check:
            if not health() or health().get("trial_id") != manifest["id"]:
                raise RuntimeError("The isolated trial is not running.")
        else:
            ensure_running(WORKSPACE, manifest)
        print(f"IP Method trial: {URL}/#/progression-blocks")
        print("Separate app files, database and browser storage. No changes are sent to your personal app.")
        if not args.no_open and not args.check:
            open_trial(WORKSPACE)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"Trial setup: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
