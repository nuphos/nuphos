import Foundation
import SwiftUI

enum BotAvatarTests {
    private static func sharedPreferenceSurvivesLegacyConflicts() {
        let prefix = "ai.nuphos.avatar-tests." + UUID().uuidString
        let legacyName = prefix + ".legacy", sharedName = prefix + ".shared"
        let legacy = UserDefaults(suiteName: legacyName)!, shared = UserDefaults(suiteName: sharedName)!
        defer {
            legacy.removePersistentDomain(forName: legacyName)
            shared.removePersistentDomain(forName: sharedName)
        }
        legacy.set(true, forKey: BotAvatars.enabledKey)
        let store = BotAvatars.migratedDefaults(legacy: legacy, shared: shared)
        precondition(store === shared && shared.bool(forKey: BotAvatars.enabledKey))
        // Account switches off after migration; stale standard defaults must not win.
        shared.set(false, forKey: BotAvatars.enabledKey)
        _ = BotAvatars.migratedDefaults(legacy: legacy, shared: shared)
        let off = AppStorage(wrappedValue: true, BotAvatars.enabledKey, store: store)
        precondition(!off.wrappedValue && legacy.bool(forKey: BotAvatars.enabledKey))
        // Switching back on must also ignore a conflicting legacy false.
        legacy.set(false, forKey: BotAvatars.enabledKey)
        shared.set(true, forKey: BotAvatars.enabledKey)
        _ = BotAvatars.migratedDefaults(legacy: legacy, shared: shared)
        let on = AppStorage(wrappedValue: true, BotAvatars.enabledKey, store: store)
        precondition(on.wrappedValue && !legacy.bool(forKey: BotAvatars.enabledKey))
        print("Shared avatar preference migration and conflicting legacy toggles passed")
    }

    static func run() throws {
        sharedPreferenceSurvivesLegacyConflicts()
        for raw in [nil, "", "future-provider"] as [String?] {
            precondition(RuntimeInstance.Provider.logo(raw) == "logo-runtime")
        }
        for (raw, logo) in [("codex", "openai"), ("claude-code", "claude"), ("grok", "grok"), ("opencode", "opencode"), ("antigravity", "antigravity")] {
            precondition(RuntimeInstance.Provider.logo(raw) == "logo-" + logo)
        }
        precondition(RuntimeInstance.Provider.detail("codex", instance: "Codex") == "Codex")
        precondition(RuntimeInstance.Provider.detail("codex", instance: "Studio laptop") == "Codex · Studio laptop")
        precondition(RuntimeInstance.Provider.name("future-provider") == "Unknown runtime")
        let unknown = try JSONDecoder().decode(RuntimeInstance.Provider.self, from: Data("\"future-provider\"".utf8))
        precondition(unknown.rawValue == "future-provider")
        let encodedUnknown = try JSONEncoder().encode(unknown)
        precondition(String(data: encodedUnknown, encoding: .utf8) == "\"future-provider\"")
        struct Fixture: Decodable { let id: String; let file: String }
        let fixtures = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: URL(fileURLWithPath: "tests/fixtures/bot-avatars.json")))
        for fixture in fixtures {
            precondition(BotAvatars.file(for: fixture.id) == fixture.file, "Desktop/Swift mapping differs: \(fixture.id)")
        }
        precondition(Set(fixtures.map(\.file)).count == 28)
        print("Shared Desktop/iOS avatar mapping: \(fixtures.count) fixtures passed")

        let id = "a155f25d-32b1-45d4-837c-9bb6d4e5155e"
        var tool = ChatPart.ToolPart(toolCallId: "message", toolName: "send_message_to_thread", isDynamic: false, state: .outputAvailable, input: .object(["threadId": .string(id)]))
        precondition(ThreadReference(tool)?.id == id)
        precondition(!ToolRuns.isPlainTool(tool))
        for state in [ChatPart.ToolPart.State.approvalRequested, .outputError, .outputDenied, .inputStreaming] {
            tool.state = state
            precondition(ThreadReference(tool) == nil, "Never hide approval or failed tools")
        }
        tool.state = .outputAvailable
        tool.toolName = "create_thread"
        tool.input = .object(["title": .string("  Research  ")])
        let receipt = JSONValue.object(["threadId": .string(id)])
        for output in [receipt, .string(receipt.compact), .array([.object(["type": .string("text"), "text": .string(receipt.compact)])])] {
            tool.output = output
            precondition(ThreadReference(tool)?.id == id)
            precondition(ThreadReference(tool)?.title == "Research")
            precondition(ThreadReference(tool)?.verb == "Started")
        }
        tool.output = .object(["threadId": .string("not-a-thread")])
        precondition(ThreadReference(tool) == nil)
        print("Thread receipt parsing and approval/error fallbacks passed")
    }
}
