import Foundation

enum BotAvatarTests {
    static func run() throws {
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
