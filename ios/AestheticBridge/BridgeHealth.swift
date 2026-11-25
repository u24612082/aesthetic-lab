import HealthKit
import AppIntents

enum BridgeHealth {
    static let store = HKHealthStore()

    static func authorize() async throws {
        guard HKHealthStore.isHealthDataAvailable() else { throw BridgeError.unavailable }
        try await store.requestAuthorization(toShare: [], read: [HKObjectType.workoutType()])
    }

    static func sources() async throws -> Set<HKSource> {
        try await withCheckedThrowingContinuation { continuation in
            store.execute(HKSourceQuery(sampleType: HKObjectType.workoutType(), samplePredicate: nil) { _, sources, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: sources ?? []) }
            })
        }
    }

    static func payload(sourceBundle: String, days: Int) async throws -> String {
        let matches = try await workouts(sourceBundle: sourceBundle, days: days)
        guard matches.count <= 100 else { throw BridgeError.tooMany }
        guard !matches.isEmpty else { return "" } // Legacy collection action skips empty output.
        return try encode(matches, sourceBundle: sourceBundle)
    }

    static func payloads(sourceBundle: String, days: Int?) async throws -> [String] {
        let matches = try await workouts(sourceBundle: sourceBundle, days: days)
        // Initial history can exceed one server envelope. Stable UUIDs make partial retries safe.
        return try stride(from: 0, to: matches.count, by: 100).map { offset in
            try encode(Array(matches[offset..<min(offset + 100, matches.count)]), sourceBundle: sourceBundle)
        }
    }

    private static func workouts(sourceBundle: String, days: Int?) async throws -> [HKWorkout] {
        guard !sourceBundle.isEmpty else { throw BridgeError.configuration }
        if let days, !(1...31).contains(days) { throw BridgeError.configuration }
        let availableSources = try await sources()
        let selectedSources = Set(availableSources.filter { $0.bundleIdentifier == sourceBundle })
        guard !selectedSources.isEmpty else { return [] }
        var predicates = [HKQuery.predicateForObjects(from: selectedSources)]
        if let days {
            let now = Date()
            let start = Calendar.current.date(byAdding: .day, value: -days, to: now)!
            predicates.append(HKQuery.predicateForSamples(withStart: start, end: now, options: .strictStartDate))
        }
        let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: predicates)
        let samples: [HKWorkout] = try await withCheckedThrowingContinuation { continuation in
            store.execute(HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate,
                limit: HKObjectQueryNoLimit, sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]) { _, samples, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: samples as? [HKWorkout] ?? []) }
            })
        }
        return samples
    }

    private static func encode(_ samples: [HKWorkout], sourceBundle: String) throws -> String {
        let iso = ISO8601DateFormatter()
        let workouts: [[String: Any]] = samples.map { workout in
            ["external_id": workout.uuid.uuidString, "revision": 1, "name": "Strength training",
             "started_at": iso.string(from: workout.startDate), "ended_at": iso.string(from: workout.endDate),
             "source_bundle": sourceBundle, "detail_level": "summary", "sets": []]
        }
        let payload: [String: Any] = ["schema_version": 1, "source": "liftoff-healthkit", "workouts": workouts]
        return String(decoding: try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]), as: UTF8.self)
    }
}

enum BridgeError: LocalizedError {
    case unavailable, configuration, tooMany, sourceMissing, inboxMissing, inboxAccess
    var errorDescription: String? {
        switch self {
        case .unavailable: return "HealthKit is unavailable on this device."
        case .configuration: return "Use the exact Liftoff source bundle identifier and a 1–31 day window."
        case .tooMany: return "More than 100 workouts found. Reduce the lookback window; no data was sent."
        case .sourceMissing: return "Open Aesthetic Bridge and select your Liftoff source after granting workout read access."
        case .inboxMissing: return "Open Aesthetic Bridge and choose iCloud Drive → AestheticLab → inbox first."
        case .inboxAccess: return "The selected folder is unavailable. Unlock your iPhone and choose the shared inbox again in Aesthetic Bridge."
        }
    }
}

struct CollectLiftoffWorkouts: AppIntent {
    static var title: LocalizedStringResource = "Collect Liftoff Workouts"
    static var description = IntentDescription("Collect recent workout summaries from the exact HealthKit source bundle selected during setup. No Health data is sent by this action.")
    static var openAppWhenRun = false

    @Parameter(title: "Liftoff source bundle identifier") var sourceBundle: String
    @Parameter(title: "Lookback days", default: 14) var days: Int

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        // Permissions must be granted in the foreground app first.
        .result(value: try await BridgeHealth.payload(sourceBundle: sourceBundle, days: days))
    }
}

struct BridgeShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: CollectLiftoffWorkouts(), phrases: ["Collect workouts with \(.applicationName)"], shortTitle: "Collect workouts", systemImageName: "figure.strengthtraining.traditional")
        AppShortcut(intent: SyncLiftoffToMac(), phrases: ["Sync Liftoff with \(.applicationName)"], shortTitle: "Sync Liftoff to Mac", systemImageName: "arrow.triangle.2.circlepath")
    }
}

struct SyncLiftoffToMac: AppIntent {
    static var title: LocalizedStringResource = "Sync Liftoff to Mac"
    static var description = IntentDescription("Automatically queue recent Liftoff workout summaries in the shared iCloud inbox selected during setup.")
    static var openAppWhenRun = false
    @Parameter(title: "Lookback days", default: 14) var days: Int

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        .result(value: try await BridgeSettings.sync(days: days))
    }
}
