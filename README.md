# Aesthetic Lab

A private workout and nutrition tracker that runs on your own computer. Log lifts and sets, track food in grams (with South African products), see weekly muscle-group volume, and optionally get automatic coaching reviews from your own Claude subscription. One local database; nothing is uploaded unless you switch the coach on.

Built from [OpenGym](https://github.com/alexpcosta/opengym) with a FastAPI + SQLite backend. Licensed AGPL-3.0-or-later.

| | macOS | Windows 10/11 | Linux |
|---|---|---|---|
| Tracker, nutrition, analytics | yes | yes | should work (not tested by the author) |
| One-click launcher | `Start Aesthetic Lab.command` | `Start Aesthetic Lab.bat` | `python3 scripts/run.py` |
| Background service at login | yes (launchd) | no, start it when you need it | no |
| iPhone home-network pairing | yes | no | no |
| Automatic Claude reviews | yes, needs Claude Code | yes, needs Claude Code | yes, needs Claude Code |

---

## Install (humans)

You need **Python 3.11 or newer** and nothing else. Node.js is *not* required: the built web interface is included.

### macOS

1. Install Python if `python3 --version` shows less than 3.11: `brew install python`, or download it from [python.org](https://www.python.org/downloads/).
2. Get the code:
   ```sh
   git clone https://github.com/u24612082/aesthetic-lab.git
   cd aesthetic-lab
   ```
3. Start it, either by double-clicking **Start Aesthetic Lab.command** (first run: right-click, Open, Open) or with:
   ```sh
   python3 scripts/run.py
   ```

### Windows

1. Install Python: `winget install Python.Python.3.12`, or download it from [python.org](https://www.python.org/downloads/) and tick **Add python.exe to PATH**.
2. Get the code (`git clone https://github.com/u24612082/aesthetic-lab.git`) or use **Code, Download ZIP** on GitHub and unzip it somewhere permanent, for example `C:\Users\you\aesthetic-lab`.
3. Double-click **Start Aesthetic Lab.bat**. If SmartScreen warns, choose More info, then Run anyway. Or from PowerShell:
   ```powershell
   py -3 scripts\run.py
   ```

### What the first run does

It creates a private Python environment in `.venv`, installs dependencies, generates your private `.env` (including a random pairing token) and an empty database in `var/`, starts the server in the background and opens **http://127.0.0.1:8765**. Takes a minute or two. Later runs start in seconds.

### First login

The page asks for a pairing token. The launcher has already copied it to your clipboard, so paste it. If not, open the `.env` file in the project folder and copy the value after `APP_TOKEN=`. Your browser remembers you for 30 days.

### Everyday use

- Start: the same launcher, or `python3 scripts/run.py` (Windows: `py -3 scripts\run.py`). If it is already running it just opens the page.
- Stop: `python3 scripts/run.py --stop`, or **Stop Aesthetic Lab.bat** on Windows.
- Update: `git pull`, then start it again. Your data in `var/` and `.env` are never touched by updates.
- Backup: `.venv/bin/python scripts/backup.py var/backups/manual.sqlite3` (Windows: `.venv\Scripts\python.exe scripts\backup.py var\backups\manual.sqlite3`).
- Uninstall: stop it, then delete the folder. Nothing is installed system-wide on Windows; on macOS, if you used the background service, first run `.venv/bin/python scripts/launchagent.py uninstall`.

### If something goes wrong

| Symptom | Fix |
|---|---|
| `Python 3.11 or newer is required` | Install a newer Python (above), then rerun. On macOS check `python3 --version`; on Windows run `py -0` to list versions. |
| Browser says it cannot connect | Look at `var/logs/server.log`. The usual cause is port 8765 in use: set `APP_PORT=8770` in `.env` and rerun. |
| Pairing token rejected | Copy `APP_TOKEN` from `.env` again, with no spaces or quotes. |
| `pip install` fails on a very new Python | Use Python 3.12 or 3.13. |
| Windows says the script cannot be run | Use the `.bat` file or `py -3 scripts\run.py`; nothing needs administrator rights. |
| Weird characters or decode errors on Windows | Use the launcher (it sets UTF-8). If you start the server by hand, set `PYTHONUTF8=1` first. |
| The page shows an old version after an update | Hard refresh (Ctrl+Shift+R / Cmd+Shift+R). |

### Privacy

The server listens on `127.0.0.1` only. Data lives in `var/aesthetic.sqlite3` on your machine. `.env`, the database, backups and certificates are git-ignored; never commit them. Food search can query Open Food Facts when you press Search. Automatic Claude reviews send your training and food summary through your own Claude Code sign-in, and only when enabled.

### Optional: automatic Claude coaching

Install and sign in to [Claude Code](https://code.claude.com/docs/en/quickstart) with a Pro or Max account. The app detects it and writes reviews into the **Coach** tab after you save workouts. Set `CLAUDE_AUTO_COACH=false` in `.env` to turn it off. No API key is used or needed. Details in [docs/claude-pro.md](docs/claude-pro.md).

---

## AI context (for coding assistants and automation)

Read this before changing anything. It is the authoritative short briefing for an AI agent working in this repository.

**What this is.** A single-user, local-first web app. Python 3.11+ FastAPI backend (`aesthetic_lab/`), SQLite via `aesthetic_lab/db.py`, React frontend adapted from OpenGym (`opengym/frontend/`, built output committed in `aesthetic_lab/opengym_static/`). One process, one database, one user.

**Commands** (use the venv interpreter: `.venv/bin/python` on macOS/Linux, `.venv\Scripts\python.exe` on Windows):

| Task | Command |
|---|---|
| Install / repair | `python3 scripts/install.py` (Windows: `py -3 scripts\install.py`) |
| Start / stop | `python3 scripts/run.py` / `python3 scripts/run.py --stop` |
| Run in foreground | `.venv/bin/python -m aesthetic_lab.server` (set `PYTHONUTF8=1` on Windows) |
| Backend tests | `.venv/bin/pytest -q` |
| Frontend tests | `(cd opengym/frontend && npm test)` |
| Rebuild frontend after editing `opengym/frontend/src` (Node 22.12+) | `.venv/bin/python scripts/build_tracker.py`, then commit `aesthetic_lab/opengym_static/` |
| Isolated demo data (UI testing) | `scripts/demo.py`, then `APP_DB=var/demo.sqlite3 APP_DEMO=true APP_PORT=8766 .venv/bin/python -m aesthetic_lab.server` |

**Map.**
- `aesthetic_lab/app.py` routes, same-origin pairing and security; `server.py` socket binding (loopback or RFC1918 only, never wildcard).
- `aesthetic_lab/tracker.py` OpenGym state adapter (`/api/data`, revision checks return HTTP 409 on stale writes).
- `aesthetic_lab/db.py` schema, seeds and transactions. `analytics.py`, `progression.py` volume and progression gates.
- `aesthetic_lab/foods.py`, `nutrition_plan.py`, `data/*.json` food catalogue (USDA SR Legacy + South African seeds) and macro planner.
- `aesthetic_lab/auto_coach.py`, `claude_client.py`, `subscription.py` background reviews through the installed, signed-in Claude Code CLI. `mcp_server.py` optional MCP bridge.
- `scripts/` install/run/backup/build/QA tools. `tests/` pytest suite (about 150 tests). `docs/` topic documentation. `ios/` and `experiments/` are optional and macOS-only.
- `opengym/` is a vendored copy of upstream OpenGym with local changes (upstream commit `678bf5b`); see `NOTICE.md`.

**Rules that matter.**
1. **Never touch personal data.** Do not read or print `.env`, `var/`, `certs/` or any `*.sqlite*` file, and do not paste the pairing token anywhere. Never add fake sessions to the personal database; use the demo database on port 8766 for UI testing.
2. **No API billing path.** Coaching must use the user's signed-in Claude Code client (`COACH_PROVIDER=subscription`). Do not add code that reads OAuth tokens, loads an API key, or calls the Anthropic API directly for coaching. `claude_client.clean_environment()` strips provider credentials from the child environment; keep it that way.
3. **Training-data semantics.** Distinguish planned sets per rotation from completed calendar-period exposure. Drafts and unchecked sets are not performed training. Do not infer form quality, visual symmetry, physique change or fatigue from volume alone. Load increases need the documented technique prerequisite and enough performance context. Coaching reviews may propose bounded adjustments; programme changes are never applied automatically.
4. **Cross-platform code.** Keep it working on macOS, Windows and Linux: build paths with `pathlib`, pass `encoding='utf-8'` to every text read/write (Windows defaults to a legacy code page), avoid POSIX-only calls without an `os.name == 'nt'` branch (see `_stop()` in `auto_coach.py` and the signal handling in `server.py`), and keep the `.venv/bin` versus `.venv/Scripts` difference inside `scripts/install.py:venv_python()`.
5. **Licences.** The project is AGPL-3.0-or-later. Exercise artwork (RepDB, free-exercise-db) and food data carry separate terms listed in `NOTICE.md` and `aesthetic_lab/exercise_media/`; keep those files and the in-app credit.
6. **Before finishing a change** run the backend tests, and the frontend tests if `opengym/frontend` changed. The workflow in `.github/workflows/ci.yml` runs the same on Ubuntu, macOS and Windows plus a one-command install smoke test.

**Do not commit:** `.env`, `var/`, `certs/`, `.mcp.json`, databases, backups, `.venv/`, `node_modules/`, or editor/assistant config directories.

---

## Features and reference

A local hypertrophy tracker built from [alexpcosta/opengym](https://github.com/alexpcosta/opengym), with a FastAPI/SQLite backend, South African gram-weight food diary and aesthetic coaching. Your Mac hosts one private database and the responsive web interface. **Log workouts directly in this app; Liftoff, HealthKit, Xcode and manual workout exports are no longer needed.**

The five supplied sessions are editable templates: **41 exercise entries, kilograms, no invented training history**. Start a day to see every exercise and its sets in one scrollable session. Enter the performed reps/load, check sets in any order and finish the session. Completing an exercise never forces a Next screen or working-weight popup. Active sessions save automatically and resume after a refresh. Original working notes are retained; ambiguous machine/plate loads and missing targets require confirmation before those sets can be checked off. Days follow your supplied rotation without assuming a weekday schedule.

Workout cards show small flat exercise illustrations beside each name; tap one for larger start/peak views. All supplied routine entries and the added standard exercises have reviewed references. The phone downloads the 25 MB media bundle at home for offline use. **Exercise data by [RepDB (repdb.co)](https://repdb.co)**; selected artwork is used inside this app under its separate attribution licence. See [exercise images and source](docs/exercise-images.md).

## Daily use (macOS details)

Open **http://127.0.0.1:8765**, or double-click **Start Aesthetic Lab.command**. The existing login service runs in the background. If already paired, refresh the page to see the tracker. On first use, pair with `APP_TOKEN` from `.env`, or copy it privately to the clipboard:

```sh
.venv/bin/python scripts/mac.py --copy-token
```

**Home → Your aesthetic rotation → Start** opens a session. **Plan** edits routines and schedules; workout controls log sets, optional RIR and exercise-specific rest timers; **History/Stats** review completed sessions. **Nutrition**, **Coach** and **Analytics** use the same Mac database. Only checked sets in completed sessions enter coaching/analytics; unfinished drafts and planned targets do not.

**Claude reviews now run automatically inside the app.** The Mac starts your installed, unmodified Claude Code client in non-interactive mode using its existing subscription sign-in. Saved workouts, food entries and routine changes trigger a background review; the result appears directly in **Coach**. There is no Terminal window, copied prompt or workout export in the normal workflow.

Nearby edits are batched for 20 seconds. Automatic runs are limited to one per 15 minutes and 12 in a rolling 24 hours, and unchanged evidence is skipped. The coach panel shows progress/errors, **Review now**, and pause/resume controls. Subscription quota errors pause retries for an hour; other failures wait 15 minutes. Previous reviews remain visible, and inputs changed during generation cannot publish a stale review.

`COACH_PROVIDER=subscription` keeps the API SDK path disabled. `CLAUDE_AUTO_COACH=true` enables automatic personal-client reviews. The app removes API/provider credential overrides from its child process and verifies Claude-account subscription authentication before generation. It never extracts OAuth tokens or enables extra usage. Pro plan limits still apply. One-time sign-in through the official client may be needed after credentials expire; routine reviews require no terminal interaction.

The local MCP bridge and `/aesthetic-audit` remain optional for interactive IDE conversations. They are no longer required to get reviews in the dashboard. See [automatic Claude setup](docs/claude-pro.md).

Automatic progression is conservative: the tracker holds automatic weight increases when measured technique evidence is missing. The backend gate applies the documented isolation/compound thresholds. Native load increases are manual unless sufficient technique evidence is supplied. Checking off sets supplies performance evidence, not technique scores. You can explicitly edit training loads; the app does not claim to assess lifting form from reps alone.

The manual diary now includes **7,793 USDA SR Legacy reference foods plus the South African starter catalogue**. Use one field for foods, brands and barcodes; the search icon or keyboard Search adds worldwide Open Food Facts products with South African results prioritized. Search eggs, chicken, rice, oats and other basics offline; use gram weights or database portion weights (for example, one large raw egg = 50 g edible portion). Keep the named raw/cooked preparation consistent. Original South African brand seeds remain illustrative until checked against packaging; generic USDA reference data is not a local product label.

**Log food** now opens **Plan foods**, with 32 ingredient/preparation choices from the bulk and cut PDFs and quick gram weights for common portions. Typing still searches all foods in one field. Plan foods and weights are downloaded for offline use; published references stay labelled until matched to your pack. Your diary history, favorites and macro targets are preserved.

The diary has optional calorie/macro targets, meal groups, recent foods, favorites, editing and repeat logging. Calorie progress uses only logged intake and user-supplied targets; no calorie requirement is invented. Unified Open Food Facts product/barcode lookup and custom label entry remain available. Editing an existing diary weight scales its original nutrient snapshot instead of rewriting history with a later catalogue label. See [food data and rest rules](docs/food-and-rest.md).

An optional **Nutrition → Calculate my macros** planner supports slow lean surplus, slow cut and maintenance. Enter your adult profile once; weight recordings in Stats feed the estimate and later trend checks. Mark food days complete to enable evidence-gated weekly adjustments. Phase switches restart the observation period; manual targets pause automation. See [adaptive nutrition and sources](docs/adaptive-nutrition.md).

## Rebuild the frontend (developers only)

The repository ships the built interface, so Node.js is **not** needed to run the app. Only rebuild after editing `opengym/frontend/` (Node.js 22.12+):

```sh
(cd opengym/frontend && npm ci --ignore-scripts)
python scripts/build_tracker.py     # use .venv/bin/python (macOS/Linux) or .venv\Scripts\python.exe (Windows)
```

Restart the server after configuration or frontend changes. `scripts/mac.py --check` (macOS) authenticates and verifies the running service without exposing the pairing token. Python dependency versions are recorded in `requirements.lock`; the frontend uses `package-lock.json`.

`APP_TRACKER_MODE=native` (default) disables the old external inbox watcher. Existing imported records and iCloud folders are preserved. The legacy bridge/contracts remain available for optional future integrations; set `APP_TRACKER_MODE=external` explicitly to use that watcher. They are not required for the tracker.

## Architecture and ownership

- `opengym/`: actual pinned OpenGym checkout, with the React tracker adapted to personal Mac pairing, SQLite persistence, your programme, missing-data handling and native nutrition, coaching and analytics pages. Upstream Node JSON storage, passkeys and Agent SDK coaching are not used.
- `aesthetic_lab/tracker.py`: authenticated `/api/me`, `/api/config`, GET/PUT `/api/data` adapter. State revisions reject stale concurrent writes with HTTP 409; pending local changes remain on the device rather than silently overwriting another tab.
- `aesthetic_lab/db.py`: SQLite WAL, foreign keys, transactions, `tracker_state` for routine/draft state, normalized workouts/sets for analytics, foods/logs/audits. The Mac remains the single writer endpoint; iCloud never replicates the SQLite file.
- `aesthetic_lab/data/program.json`: exact five-day routine seed and retained reference notes. It seeds an absent tracker state once, without overwriting saved edits.
- `aesthetic_lab/app.py`: same-origin pairing/security/API, OpenGym root UI, existing panels at `/analytics/`. The React app's built assets live in `aesthetic_lab/opengym_static/`.
- `analytics.py`, `progression.py`, `claude_analyser.py`: volume, fatigue proxies, evidence-aware technique gate and Anthropic analysis. Missing technique, symmetry or machine-comparability evidence stays unknown.
- `foods.py`, `static/`: South African nutrition and analysis panels. Source download: authenticated `/api/source`.

Programme entries are separate for each day so different prescribed loads do not overwrite one another. A completed session mirrors transactionally into the existing analytics tables; unchanged retries do not duplicate sets, and deleting a native session removes its normalized native records. Existing external-source history is preserved. Workouts and food entries persist locally during a disconnect and sync when the Mac is reachable. Independent completed workouts merge against their saved baseline; overlapping edits pause for review. The conflict banner can load the saved Mac version after confirmation, keeping a browser recovery copy of the pending tab. This is a personal workspace, not a multiuser service.

For a native desktop icon, run `.venv/bin/python scripts/install_desktop.py --install` once on the Mac. Double-click **Aesthetic Lab.app** on the Desktop for daily use; it starts the existing background service if needed and opens the dashboard without Terminal. The workspace must stay in place.

The desktop stays at `http://127.0.0.1:8765`. Open **Setup iPhone Access.command** and follow **Settings → Connect your iPhone** for private local HTTPS, QR setup and one-use pairing. In the installed iPhone app, tap **Prepare for offline use** and wait for **Ready to log lifts and body weight offline**. Lifts, reps and weigh-ins save to IndexedDB and recover after closing and reopening the browser. Completed workouts and food sync automatically while the app is open with the Mac reachable at home. Independent sessions combine; overlapping edits pause for review. See [iPhone setup](docs/iphone-setup.md) and [network details](docs/network.md). Device trust and Home Screen installation require your iPhone; they are not represented as already completed.

## Backup, verification and demo

```sh
.venv/bin/python scripts/backup.py var/backups/manual.sqlite3
.venv/bin/pytest -q
(cd opengym/frontend && npm test)
.venv/bin/python scripts/package_source.py
```

Before switching trackers, a consistent SQLite backup was saved in `var/backups/pre-opengym-20261101.sqlite3`. Keep private `.env`, database and backup files out of source distribution.

For isolated demonstration/testing:

```sh
.venv/bin/python scripts/demo.py
APP_DB=var/demo.sqlite3 APP_DEMO=true APP_PORT=8766 .venv/bin/python -m aesthetic_lab.server
node scripts/tracker_browser_qa.mjs
node scripts/native_pages_browser_qa.mjs
node scripts/offline_browser_qa.mjs
node scripts/workout_offline_browser_qa.mjs
node scripts/workout_offline_browser_qa.mjs --swaps
node scripts/workout_offline_browser_qa.mjs --shared-loads
node scripts/startup_browser_qa.mjs
node scripts/browser_qa.mjs
```

The browser scripts use Node 22+ and installed macOS Chrome. They verify synthetic-demo behavior and write ignored screenshots in `var/qa/`; the tracker script restores the original demo state after exercising a session. Demo mode blocks paid AI calls, credential changes and real inbox consumption. See [verification](docs/verification.md) for tested boundaries.

## License and source

This combined modified application is **AGPL-3.0-or-later**; see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for OpenGym provenance and third-party terms. The original backend's MIT notice is retained in `LICENSE.original-MIT`. Complete modified source, including OpenGym, is available in `dist/aesthetic-lab-source.zip` and through the app's Source link. No user database, `.env`, node_modules or exercise animation archive is included. Open Food Facts data retains its own attribution/license requirements.
