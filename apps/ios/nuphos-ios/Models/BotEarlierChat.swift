import Foundation

/// Whether a Bot's chat should lead back to the Bot's own session, where the conversation it had
/// before this chat was made still is, as on Desktop (#5061). A Bot used before Bot chats were
/// channels kept its messages there, and its first chat is made empty the first time it is opened.
/// A Bot whose session only moved once this chat existed, such as a new Bot greeting in it, has
/// nothing earlier; nor does a Bot still being set up.
enum BotEarlierChat {
    static func shows(bot: AgentConversation?, chatCreatedAt: Date?) -> Bool {
        guard let bot, let chatCreatedAt, bot.messageCount > 0 else { return false }
        if ["pending", "active"].contains(bot.botOnboarding ?? "") { return false }
        // A missing time decodes as the distant past: unknown, so nothing is said to be earlier.
        guard bot.lastActiveAt != .distantPast, chatCreatedAt != .distantPast else { return false }
        return bot.lastActiveAt < chatCreatedAt
    }
}
