# Connect your existing Liftoff Health records to the Mac

The user confirmed dated Liftoff workout entries are visible in Apple Health. The Mac receiver is configured for **iCloud Drive → AestheticLab → inbox**. No phone records have reached the Mac yet: the remaining step is installing and authorizing the native iPhone bridge.

The dashboard stays on your Mac. The iPhone helper reads the selected Liftoff workout source and writes JSON into the user-selected shared folder. A Shortcut automation invokes one native action; no recurring export taps, JSON editing, network certificates, or Mac LAN exposure are required for this route. SQLite remains local on the Mac.

## Install the native helper

1. Install **full Xcode with iOS support**. Command Line Tools alone cannot build this app. This Mac has macOS 26.3; select a compatible Xcode version using [Apple's requirements table](https://developer.apple.com/xcode/system-requirements) and [developer downloads](https://developer.apple.com/download/all/?q=Xcode). Do not assume the latest App Store release supports your current macOS. Choose an SDK/device support appropriate for the iPhone too. No Xcode download or macOS upgrade was started by this workspace.
2. Open Xcode once and complete its initial component installation, selecting iOS support. Simulator runtimes are not needed to run on your physical iPhone.
3. Double-click **Setup iPhone Bridge.command** in the workspace. It generates and opens `ios/AestheticBridge.xcodeproj` without XcodeGen or extra package dependencies. You can also run `python3 scripts/prepare_ios.py --open`.
4. In the project's **AestheticBridge target → Signing & Capabilities**, choose your Apple signing team and a unique bundle identifier. HealthKit is already declared. Keep Apple credentials in Xcode; do not put them into this dashboard or chat. [Apple's capability table](https://developer.apple.com/help/account/reference/supported-capabilities-ios) currently includes HealthKit for Apple Developer accounts without paid membership. Free Personal Team provisioning expires after seven days and requires reinstalling/reprovisioning; it is not permanent unattended distribution. A properly signed longer-lived distribution is a separate choice.
5. Connect the iPhone by USB, accept its Trust prompt, choose it as the run destination, and press **Run**. Enable Developer Mode on the iPhone if Xcode requests it. Compilation and signing cannot be verified here until full Xcode is installed and the device/team are available.

## One-time authorization and initial history

1. On the iPhone, open **Aesthetic Bridge** → **Authorize HealthKit & find sources**. Grant workout read access and access to the historical range you want imported, if iOS offers that choice.
2. Select the actual **Liftoff** source shown. The app stores the exact bundle identifier; it does not guess based on a similar app name.
3. Tap **Choose shared inbox**, select **iCloud Drive → AestheticLab → inbox**, and allow folder access. Choose the folder that the Mac receiver created, not an On My iPhone folder. Both devices need access to the same iCloud Drive account/folder. Mark the folder Keep Downloaded on the Mac if Finder offers it.
4. Tap **Connect & sync available history** once. It queries the selected source's readable history and queues batches of at most 100 summaries per file. Large histories and retries do not require manual exports. The available history still depends on what Liftoff wrote to Health and what Health permits this helper to read.
5. Keep the devices online for iCloud delivery. The Mac scans every five seconds and waits for files to settle for ten seconds; iCloud itself may add delays. In the Mac dashboard's **Sync & devices**, look for an accepted iCloud event and a nonzero workout count. Choose a broader date filter if the received workouts fall outside the last seven days.

## Hands-off updates

In Shortcuts → Automation:

1. Choose **App → Liftoff → Is Closed → Run Immediately**.
2. Add the native action **Sync Liftoff to Mac** from Aesthetic Bridge. Leave its lookback at 14 days. It reuses the source and inbox saved during setup.
3. Add a daily Time of Day retry that runs the same action. Grant any first-run permissions while unlocked. Disable notifications where your iOS version permits.

The native action queries Health and writes the shared file itself. No Save File or manual JSON steps are needed. Repeated source UUIDs/revisions are idempotent. iOS can defer or block Health reads while locked; a subsequent successful run retries the overlapping window. A sleeping or offline Mac imports files when available again. Source deletions are not propagated. The separate legacy **Collect Liftoff Workouts** action and manual Shortcut assembly remain documented in [shortcuts.md](shortcuts.md) for custom integrations.

## What the dashboard receives

This bridge intentionally imports **workout summaries**: stable UUID, source, start/end time and a generic strength-training label. No set/repetition/weight/RIR/technique contract has been verified for Liftoff's Health records. Summary import fills session history; it cannot fill muscle volume, load progression or technique scores. Those require a separate supported exercise-level source. The app does not infer them from duration or calories.

The bridge source and Xcode project are prepared, with syntax/project-format checks passing. An iPhone SDK build, signing, on-device execution, file bookmark persistence across scheduled runs and actual iCloud phone-to-Mac delivery remain unverified until installation. The Mac inbox alone is not evidence that workout sync is connected.
