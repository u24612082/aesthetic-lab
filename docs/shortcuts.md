# Automatic Liftoff ingestion

## What this scaffold can and cannot read

The user confirmed the source app is **Liftoff – Ranked Gym Workouts**, published by Liftoff Labs Inc. ([App Store ID 6448081563](https://apps.apple.com/us/app/liftoff-ranked-gym-workouts/id6448081563)), not the similarly named Liftoff: Workout Tracker or Lifto. Browser pairing only authorizes this local dashboard; it does not connect a Liftoff account. The initial audit on 1 November 2026 found no real workouts and an unconfigured inbox. The receiver has since been enabled as described below; no phone import has been verified. No read API for the full account history was identified in the official public material reviewed.

The user subsequently confirmed dated Liftoff workout records in Apple Health. The Mac's iCloud receiver is now configured for `iCloud Drive/AestheticLab/inbox`; no phone records have reached it yet. Follow the [recommended native bridge setup](iphone-setup.md): it includes an initial history query and a single **Sync Liftoff to Mac** Shortcut action that writes to the shared folder automatically. The older recipes below are optional alternatives. A Mac-only browser cannot read the iPhone's HealthKit store. This Mac currently has Command Line Tools but no iOS SDK, so the bridge still needs full Xcode installation/signing.

Liftoff also documents [Strava sharing](https://info.liftoffrank.com/strava), but that requires the Post to Strava setting on workouts and is not established here as a complete, silent, set-level history feed. No Strava account has been connected to this dashboard.

[Liftoff](https://liftoffrank.com/) advertises writing workouts to Apple Health. Its public description does not promise exercise sets, RIR or technique scores in HealthKit. [HKWorkout](https://developer.apple.com/documentation/healthkit/hkworkout) stores a summary and can associate additional samples/custom metadata, but those details depend on the source app. No public Liftoff API or exercise-level metadata contract was supplied. This project therefore includes a functioning **summary query bridge** and a versioned set-level adapter contract, not an invented Liftoff private API.

The iOS bridge returns workout UUID, times and source automatically. It does not invent movements or reverse-engineer a private database. Summary records produce session counts and durations, never hypertrophy volume, technique scores or fatigue estimates. Full analysis needs Liftoff (or another authorized automatic integration) to supply the richer payload. No manual workout export or entry workflow is provided.

## One-time native bridge setup

The PWA cannot call HealthKit. `ios/AestheticBridge/` provides a small SwiftUI app and a native AppIntent named **Collect Liftoff Workouts**; the Shortcut invokes this rather than relying on a generic Shortcuts action exposing arbitrary HKWorkout metadata.

1. Install full Xcode, run `python3 scripts/prepare_ios.py`, then open `ios/AestheticBridge.xcodeproj`. XcodeGen is optional; the retained `ios/project.yml` supports that workflow too.
2. Set a unique bundle identifier and your signing team; enable the HealthKit capability. Build to your physical iPhone. The project needs the iOS SDK, signing and on-device authorization; it is not a pre-signed installable app. Free development signing may require periodic reinstallation.
3. Launch Aesthetic Bridge once. Tap **Authorize HealthKit & find sources** and grant workout read access. Copy the **actual Liftoff source bundle identifier** shown in the list. Liftoff must itself have permission to write workouts to Apple Health. Denied Health read permission can look like an empty result.
4. Configure trusted HTTPS from [network.md](network.md), or configure the iCloud transport below.

## Shortcut recipe: iCloud queue (survives a disconnected Mac)

Create a Shortcut named **Sync Liftoff to Aesthetic Lab**:

1. Add **Collect Liftoff Workouts** (Aesthetic Bridge). Set the exact source bundle identifier and a 14-day lookback. UUIDs remain stable across repeated runs.
2. **If** the returned text has any value, continue; otherwise end. No matches returns an empty string; do not send an empty/non-JSON string.
3. **Current Date** → **Format Date** with a filename-safe timestamp such as `yyyyMMdd-HHmmss-SSS`.
4. **Set Name** of the returned JSON text to `liftoff-[Formatted Date].json`.
5. **Save File** to `iCloud Drive/Shortcuts/AestheticLab/inbox`, with **Ask Where to Save** off. Preselect the folder once and allow its file permissions. Use unique filenames, not overwrite. Native file synchronization will deliver files when the Mac reconnects.
6. On the Mac set `APP_INBOX` in `.env` to the actual Finder folder, typically `~/Library/Mobile Documents/com~apple~CloudDocs/Shortcuts/AestheticLab/inbox`. Restart the server. Mark that folder **Keep Downloaded** in Finder if available.

The importer treats repeat workout IDs/revisions as unchanged. Files are transport envelopes, not database replicas. Initial permissions are interactive; subsequent scheduled runs need no export taps. A 14-day overlap catches most missed runs; if offline for longer, temporarily expand the **setup** lookback to at most 31 days. This bridge does not backfill all-time history or propagate deletions. Use the same source/external ID and a higher revision for later corrections from a richer adapter.

## Shortcut recipe: direct HTTPS

After collecting a nonempty JSON string:

1. Use **Get Dictionary from Input** to parse it.
2. **Get Contents of URL** → `https://YOUR-MAC-LAN-IP:8765/api/ingest/workouts`.
3. Method **POST**; header **Authorization** = `Bearer YOUR_APP_TOKEN`; header **Content-Type** = `application/json`.
4. Request body **JSON**. Populate `schema_version` = 1 (number), `source` = `liftoff-healthkit` (text), and `workouts` = the `workouts` **list** from the parsed dictionary. Pass a list, not JSON-encoded text. Alternatively use a JSON file body with the collected UTF-8 text; preserve the exact envelope.
5. Check the JSON response for inserted/updated/unchanged/stale counts. A network failure must not advance a cursor; the overlapping lookback retries stable UUIDs on the next trigger. For disconnected-Mac reliability, prefer the iCloud queue as the single transport. Do not configure independent adapters using different workout IDs for the same session.

The token grants access to private data: do not share a Shortcut containing it. Do not turn off TLS verification. The Mac must be awake/reachable for direct HTTPS. A failed direct URL action may terminate a Shortcut; iCloud-first avoids needing a fragile error fallback.

## Automation triggers

In Shortcuts → Automation, create **App → Liftoff → Is Closed → Run Immediately** to run the sync Shortcut. Add a daily **Time of Day** retry (for example after your normal training time) and optionally a **Wi-Fi** home-network trigger. Disable notifications where iOS permits. Run it once while unlocked to grant Health, network and file permissions. The bridge never asks for authorization from its background action.

[Apple permits some automations to run without asking](https://support.apple.com/guide/shortcuts/enable-or-disable-a-personal-automation-apd602971e63/ios), but scheduling, device locking, permissions and low-power settings affect execution. [Apple documents locked HealthKit access limitations](https://developer.apple.com/documentation/healthkit/protecting-user-privacy) and native background-delivery requirements. This is eventual, hands-off transfer after setup, **not a guarantee of silent real-time reads while locked**. No macOS process or web page can override iOS privacy or background execution rules. The bridge uses scheduled AppIntents, not an HKObserverQuery push entitlement.

## Rich adapter contract

See [schema.json](schema.json), [summary example](../examples/workout-summary.json), [set example](../examples/workout-sets.json), and [technique example](../examples/workout-technique.json). The endpoint and inbox accept the same envelope. Timestamps need offsets; kg/lb are accepted and stored in kg. Unknown exercise aliases remain Unmapped. RIR and technique are nullable and never inferred. `equipment_id`, `resistance_mode` and `side` preserve comparable conditions.

`external_id` must be stable in its source namespace. Repeat identical content with the same revision. Increment `revision` for edits; same revision with changed data returns **409 and rolls the whole batch back**. Older revisions are ignored. Maximum 100 workouts, 1,000 sets per workout, 2 MB per request/file. Normalize output in the adapter rather than putting an entire vendor export into this endpoint. Keep the same namespace and workout UUID when upgrading a summary to detail; otherwise it becomes a second session. A source changing a HealthKit UUID on editing needs a stable ID mapping in the adapter.

This is a scaffold for one person's append/update history. Source deletion tombstones, all-time paginated backfill, signed Shortcut distribution and a vendor-specific exercise adapter remain extensions requiring the actual source API/data contract.
