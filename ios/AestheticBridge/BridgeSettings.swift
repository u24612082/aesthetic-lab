import Foundation

enum BridgeSettings {
    private static let sourceKey = "liftoff-source-bundle"
    private static let inboxKey = "liftoff-inbox-bookmark"

    static var sourceBundle: String {
        get { UserDefaults.standard.string(forKey: sourceKey) ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: sourceKey) }
    }

    static var inboxConfigured: Bool {
        UserDefaults.standard.data(forKey: inboxKey) != nil
    }

    static func selectInbox(_ url: URL) throws {
        guard url.startAccessingSecurityScopedResource() else { throw BridgeError.inboxAccess }
        defer { url.stopAccessingSecurityScopedResource() }
        let bookmark = try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        UserDefaults.standard.set(bookmark, forKey: inboxKey)
    }

    static func writePayload(_ payload: String) throws {
        guard let bookmark = UserDefaults.standard.data(forKey: inboxKey) else { throw BridgeError.inboxMissing }
        var stale = false
        let folder = try URL(resolvingBookmarkData: bookmark, options: [.withoutUI], relativeTo: nil, bookmarkDataIsStale: &stale)
        guard folder.startAccessingSecurityScopedResource() else { throw BridgeError.inboxAccess }
        defer { folder.stopAccessingSecurityScopedResource() }
        if stale {
            let renewed = try folder.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
            UserDefaults.standard.set(renewed, forKey: inboxKey)
        }
        let file = folder.appendingPathComponent("liftoff-\(UUID().uuidString).json")
        // Atomic completion keeps the Mac watcher from parsing a partial write.
        try Data(payload.utf8).write(to: file, options: .atomic)
    }

    static func sync(days: Int? = 14) async throws -> String {
        let source = sourceBundle
        guard !source.isEmpty else { throw BridgeError.sourceMissing }
        guard inboxConfigured else { throw BridgeError.inboxMissing }
        let payloads = try await BridgeHealth.payloads(sourceBundle: source, days: days)
        guard !payloads.isEmpty else {
            return "No matching workouts were readable. Check source selection, permitted history access and device lock state."
        }
        for payload in payloads { try writePayload(payload) }
        return "Workouts queued in your selected folder. Your Mac imports them after iCloud delivers the file."
    }
}
