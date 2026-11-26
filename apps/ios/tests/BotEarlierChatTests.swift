import Foundation

/// An older Bot's empty chat leads back to the Bot's own session, as Desktop decides it (#5061).
enum BotEarlierChatTests {
    static func run() {
        aChatReadsWhenItWasMade()
        aBotThatLastMovedBeforeItsChatWasMadeHasEarlierMessages()
        aBotThatOnlyMovedOnceItsChatExistedHasNothingEarlier()
        aBotWithNoMessagesOrNoRowHasNothingEarlier()
        anUnknownTimeSaysNothingIsEarlier()
        aBotStillBeingSetUpHasNothingEarlier()
        print("Bot earlier chat passed")
    }

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        d.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            if let date = iso.date(from: raw) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Bad date: \(raw)"))
        }
        return d
    }()

    private static func bot(_ messages: Int, _ lastActive: String?, onboarding: String? = nil) -> AgentConversation {
        let active = lastActive.map { #","lastActiveAt":"\#($0)""# } ?? ""
        let setup = onboarding.map { #","botOnboarding":"\#($0)""# } ?? ""
        return try! decoder.decode(AgentConversation.self, from: Data(
            #"{"sessionId":"bot-1","title":"Ada","messageCount":\#(messages)\#(active)\#(setup)}"#.utf8))
    }

    private static func chat(_ json: String) -> Date? {
        try! decoder.decode(AgentConversationDetail.self, from: Data(json.utf8)).createdAt
    }

    private static let made = chat(#"{"kind":"channel","title":"Ada","createdAt":"2026-11-25T02:00:00.000Z","messages":[]}"#)
    private static let before = "2026-11-17T08:00:00.000Z"

    private static func check(_ condition: Bool, _ message: String) {
        if !condition { fatalError("BotEarlierChatTests: \(message)") }
    }

    private static func aChatReadsWhenItWasMade() {
        check(made == ISO8601DateFormatter().date(from: "2026-11-25T02:00:00Z"), "the chat's createdAt was \(String(describing: made))")
    }

    private static func aBotThatLastMovedBeforeItsChatWasMadeHasEarlierMessages() {
        check(BotEarlierChat.shows(bot: bot(12, before), chatCreatedAt: made), "an older Bot's empty chat did not lead back to it")
    }

    private static func aBotThatOnlyMovedOnceItsChatExistedHasNothingEarlier() {
        check(!BotEarlierChat.shows(bot: bot(3, "2026-11-25T02:00:05.000Z"), chatCreatedAt: made), "a Bot that moved after its chat was made led back")
    }

    private static func aBotWithNoMessagesOrNoRowHasNothingEarlier() {
        check(!BotEarlierChat.shows(bot: bot(0, before), chatCreatedAt: made), "a Bot with no messages led back")
        check(!BotEarlierChat.shows(bot: nil, chatCreatedAt: made), "no Bot row led back")
        check(!BotEarlierChat.shows(bot: bot(4, before), chatCreatedAt: nil), "a chat without createdAt led back")
    }

    private static func anUnknownTimeSaysNothingIsEarlier() {
        check(!BotEarlierChat.shows(bot: bot(4, nil), chatCreatedAt: made), "a Bot without a time led back")
        check(chat(#"{"createdAt":"soon","messages":[]}"#) == nil, "an unreadable createdAt was read")
    }

    private static func aBotStillBeingSetUpHasNothingEarlier() {
        check(!BotEarlierChat.shows(bot: bot(4, before, onboarding: "active"), chatCreatedAt: made), "an active onboarding Bot led back")
        check(!BotEarlierChat.shows(bot: bot(4, before, onboarding: "pending"), chatCreatedAt: made), "a pending onboarding Bot led back")
        check(BotEarlierChat.shows(bot: bot(4, before, onboarding: "done"), chatCreatedAt: made), "a set-up Bot did not lead back")
    }
}
