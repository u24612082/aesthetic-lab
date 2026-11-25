# Isolated automatic IP Method trial

Double-click **Try IP Method.command**. The trial opens at `http://127.0.0.1:8767/#/progression-blocks`, with a gold banner on every page. Your usual Mac app and iPhone installation keep their original addresses and data.

## Use it

1. Choose **Upper chest**, **Shoulder width**, or **Back width** and tap **Use this focus**. The app selects a main lift and related variations from the local catalogue, favouring exercises in your routine and training history. No block setup forms are required.
2. Start and log your normal workouts. The focus automatically attaches to the appropriate exercise, including equivalent exercise IDs in other routines. Each variation keeps its own last weight and records.
3. Finish the workout normally. The local guidance reviews the completed sets and shows a short explanation. There are no manual stage-advance controls in the guided flow.
4. Improving results keep the current lift. Repeated comparable stalls can move from the main lift to a support variation, then a bridge variation and finally two return sessions. Changes apply to the active workout only; saved routine templates stay intact.

**Show a quick preview** is read-only and never adds example workouts to your log. **Pause focus** stops automatic slot changes. **Training lighter today** marks a recovery session so it cannot trigger progression. Gym-only exercise swaps remain temporary and are never undone by the focus engine. A workout already underway when the focus is selected stays as started.

## What the rules establish

This is a deterministic local prototype, not an autonomous diagnosis of a weak muscle. It uses actual completed working sets and reported RIR/RPE. It never invents technique scores or automatically approves a load increase. The existing technique gate remains separate.

A review looks for four consecutive exposures with at least two working sets and the same first-set load, reps and reported effort. At least two exposures must be new to the stage. Progress retains the lift. An immediate performance decline, a recorded deload, a slow-cut context, or a sufficiently recent downward weight trend can hold rotation. Missing effort holds comparison. Changed known rest targets or nutrition phases break the comparable sequence.

Four exposures is a conservative prototype choice, not a validated optimal IP dose. Planned rest and setup are not sensor measurements. Return-test results describe recorded performance with its limitations; they do not establish causal transfer, muscle growth or visual symmetry.

The nutrition phase is read from the trial's macro plan, with `Unspecified` retained when unavailable. Scale records supply additional context when sufficiently recent. No macro targets are changed by the focus engine. Guidance works offline; Claude requests and phone connection changes remain disabled in this first Mac trial.

## Isolation and backups

The application source and compiled assets live in `var/ip-method-trial/app`. `data.sqlite3` is a consistent read-only-source online backup of the Mac database, including committed WAL transactions. `baseline.sqlite3` preserves the original snapshot. Pending iPhone-only logs are not included in the Mac snapshot.

The trial uses fresh credentials, a different cookie name, and a separate browser origin for local storage, IndexedDB and service workers. All background workers are disabled. Trial setup does not change the personal `.env`, launch agents, certificates or iPhone installation. Nothing automatically merges back.

Reopening the launcher retains your trial records. Closing the browser leaves the separate trial server available. `./.venv/bin/python scripts/ip_trial.py --stop` stops only the identified trial server.

Experimental source lives in `experiments/ip_method/overlay`. To apply later source changes to the existing copy, run `./.venv/bin/python scripts/update_ip_trial.py`; it creates a consistent pre-update database backup under `var/ip-method-trial/backups` and preserves existing workouts and blocks. The experimental state-store overlay integrates guidance into the existing durable save transaction, so offline saves and stage decisions are journaled together.

Browser QA uses a third, disposable workspace at `var/ip-guidance-qa` on port 8768. It never writes to either user workspace. `scripts/guided_trial_browser_qa.mjs` checks one-choice setup, normal-routine logging, automatic rotation, session-only replacement, the original set budget, offline reload/reconnect, and phone-width layout. It also checks the personal application's file hashes and training/nutrition fingerprints.

Inspired by [Jon Walland's IP Method](https://www.youtube.com/watch?v=u7DGzd1ZdI8). This independent trial tests the workflow; it does not reproduce the creator's coaching service or guarantee infinite progression.
