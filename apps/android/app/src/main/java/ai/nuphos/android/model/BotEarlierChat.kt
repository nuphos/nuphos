package ai.nuphos.android.model

import java.time.Instant

/**
 * Whether a Bot's chat should lead back to the Bot's own session, where the conversation it had
 * before this chat was made still is, as on Desktop (#5061). A Bot used before Bot chats were
 * channels kept its messages there, and its first chat is made empty the first time it is opened.
 * A Bot whose session only moved once this chat existed, such as a new Bot greeting in it, has
 * nothing earlier; nor does a Bot still being set up.
 */
object BotEarlierChat {
    fun shows(bot: AgentConversation?, chatCreatedAt: Instant?): Boolean {
        if (bot == null || chatCreatedAt == null || bot.messageCount <= 0) return false
        if (bot.botOnboarding == "pending" || bot.botOnboarding == "active") return false
        // An unreadable time decodes as the epoch: unknown, so nothing is said to be earlier.
        if (bot.lastActiveAt == Instant.EPOCH || chatCreatedAt == Instant.EPOCH) return false
        return bot.lastActiveAt.isBefore(chatCreatedAt)
    }
}
