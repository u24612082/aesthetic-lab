import SwiftUI
import HealthKit
import UniformTypeIdentifiers

@main
struct AestheticBridgeApp: App {
    var body: some Scene { WindowGroup { SetupView() } }
}

struct SetupView: View {
    @State private var message = "Allow workout read access, select Liftoff, then choose your shared inbox. After setup, a Shortcut automation can sync without exports."
    @State private var sources: [HKSource] = []
    @State private var sourceBundle = BridgeSettings.sourceBundle
    @State private var inboxConfigured = BridgeSettings.inboxConfigured
    @State private var choosingInbox = false
    @State private var syncing = false
    var body: some View {
        NavigationStack {
            List {
                Section("One-time setup") {
                    Text(message)
                    Button("Authorize HealthKit & find sources") {
                        Task {
                            do {
                                try await BridgeHealth.authorize()
                                sources = try await BridgeHealth.sources().sorted { $0.name < $1.name }
                                message = "Select the exact Liftoff source below. Denied Health read access can look like no data."
                            } catch { message = error.localizedDescription }
                        }
                    }
                }
                Section("Select your Liftoff workout source") {
                    ForEach(sources, id: \.bundleIdentifier) { source in
                        Button {
                            sourceBundle = source.bundleIdentifier
                            BridgeSettings.sourceBundle = sourceBundle
                        } label: {
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(source.name)
                                    Text(source.bundleIdentifier).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if sourceBundle == source.bundleIdentifier { Image(systemName: "checkmark.circle.fill") }
                            }
                        }
                    }
                    if !sourceBundle.isEmpty { Text("Selected: \(sourceBundle)").font(.caption) }
                }
                Section("Your Mac inbox") {
                    Text("In Files, choose iCloud Drive → AestheticLab → inbox. The Mac receiver creates this folder. Avoid On My iPhone or another local folder.")
                    Button(inboxConfigured ? "Change shared inbox" : "Choose shared inbox") { choosingInbox = true }
                    if inboxConfigured { Label("Folder access saved", systemImage: "folder.badge.checkmark") }
                    Button(syncing ? "Queuing workouts…" : "Connect & sync available history") {
                        syncing = true
                        Task {
                            do { message = try await BridgeSettings.sync(days: nil) }
                            catch { message = error.localizedDescription }
                            syncing = false
                        }
                    }.disabled(sourceBundle.isEmpty || !inboxConfigured || syncing)
                }
                Section("Automatic updates") {
                    Text("In Shortcuts, create App → Liftoff → Is Closed → Run Immediately. Add Sync Liftoff to Mac from Aesthetic Bridge. Add a daily retry too. The action reuses your selected source and folder; no file export actions are needed.")
                }
                Section("What syncs") {
                    Text("Workout UUID, source, start and end time. HealthKit summaries do not guarantee exercise names, sets, loads, RIR or technique scores. Those require a separate supported integration.")
                    Text("Background execution is scheduled by iOS. Health reads may fail while locked. Keep a daily retry and an app-close automation.")
                }
            }.navigationTitle("Aesthetic Bridge")
                .fileImporter(isPresented: $choosingInbox, allowedContentTypes: [.folder]) { result in
                    do {
                        try BridgeSettings.selectInbox(result.get())
                        inboxConfigured = true
                        message = "Shared inbox saved. Connect & sync to queue the Liftoff workout history Health permits you to read."
                    } catch { message = error.localizedDescription }
                }
        }
    }
}
