# Exercise images

Workout cards use **64 px illustrated icons beside exercise names**, with the set table below. Tap an icon or the information button for larger start/peak illustrations. All exercise cards remain visible throughout a workout. The nutrition search uses a full-width field with a fixed-size search button on phones; local matches appear while typing, and submitting searches online products.

**[Exercise data by RepDB (repdb.co)](https://repdb.co)**. Selected flat WebP artwork is bundled for use inside this app, pinned to [RepDB/exercise-dataset](https://github.com/RepDB/exercise-dataset) revision `66c4298af8d99b9dc397dad6699e508fb871d249`. Its separate free-tier licence permits personal and commercial in-app use with attribution; it does not permit redistributing a standalone dataset/API or generative-AI derivation. The supplied image bytes are unchanged. Licence and attribution are in `aesthetic_lab/exercise_media/RepDB-LICENSE-DATA.md` and `RepDB-ATTRIBUTION.md`; Settings also displays the required credit. No paid preview animations are used.

Original vector references cover rare movements such as serratus punches, tibialis raises, lean-away laterals and Garhammer raises. Unsupported custom movements receive an explicitly labelled **target-area guide**. Machine/cable and Smith/dumbbell alternatives have separate references in details. Apparatus differences are noted. Images never produce technique scores or approve progression.

The existing public-domain [Free Exercise DB](https://github.com/yuhonas/free-exercise-db) photo references are retained for other catalogue entries that lack a reviewed illustration, pinned at `f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5`, with its Unlicense. These entries use target-area icons in compact lists; photos are available in details. Older Gym visual image/GIF URLs remain unused. No runtime image CDN, API subscription or image-generation charge is required.

The application bundles 162 illustration files for 82 movements, 368 photos, 12 original vector frames and 11 target-area guides: **553 files, about 25 MB**. Reviewed visual references cover all 41 supplied programme entries plus the 17 additional standard exercises. Existing IDs, custom definitions, loads, technique scores, routines and completed workouts are preserved.

## Offline preparation

Opening the paired app at home automatically downloads the media bundle. **Settings → Connect your iPhone → Prepare this device for the gym** also prepares the device and shows readiness. Keep the Mac awake and the phone connected until the download finishes. Once prepared, illustrations load without a Mac connection, including exercises not previously opened on the phone.

Images use a separate persistent Cache Storage cache, `aesthetic-exercise-media-v1`. App-shell updates retain that cache; health records and credentials are never stored there. Preparation validates each file's length and SHA-256 against the manifest, uses four parallel local downloads and reports ready only when all files are present. It resumes verified files after interrupted preparation. Failed image downloads preserve the food/workout outbox and can be retried at home. Browser storage eviction can require downloading again.

## Rebuild

```sh
.venv/bin/python scripts/fetch_exercise_media.py
.venv/bin/python scripts/fetch_exercise_illustrations.py
.venv/bin/python scripts/build_tracker.py
```

Run both fetchers in this order: the illustration fetcher extends the base media catalogue and rebuilds the complete manifest. Reviewed mappings are in `aesthetic_lab/data/exercise_media_aliases.json` and `exercise_illustration_aliases.json`; conservative exact-name matching covers additional catalogue movements. The fetchers validate file signatures and retain supplied image bytes. `scripts/build_exercise_diagrams.py` contains the application's original SVG artwork. The source archive and Python package include the assets needed by this app and their separate licences, not the complete RepDB dataset.
