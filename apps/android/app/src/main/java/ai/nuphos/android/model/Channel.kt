package ai.nuphos.android.model

import ai.nuphos.android.data.JsonValue
import kotlinx.serialization.Serializable
import java.time.Instant

/** An agent brought into a chat (`GET /agent/conversations/:id/agents`). */
@Serializable
data class ChannelAgent(val sessionId: String, val title: String = "", val ownerId: String? = null)

@Serializable
data class ChannelAgentsEnvelope(val agents: List<ChannelAgent> = emptyList())

/**
 * One post in a chat, read from the stored message as Desktop and iOS read it:
 * who sent it, its words and its files. The chat's transcript is written by the
 * server, so its sender metadata is the post's author.
 */
data class ChannelPost(
    val id: String,
    /** A person's id, or an agent's session. Consecutive posts from one sender form a run. */
    val senderId: String,
    val isAgent: Boolean,
    val name: String,
    val avatarURL: String? = null,
    val text: String,
    /** A person's uploads. */
    val uploads: List<TransferUpload> = emptyList(),
    /** An agent's pushed files, as their transfer groups. */
    val downloads: List<String> = emptyList(),
    val sentAt: Instant?,
    /** Shown at once, before the chat returns it. */
    val sending: Boolean = false,
) {
    fun isMine(viewerId: String?): Boolean = !isAgent && viewerId != null && senderId == viewerId
    val groups: List<String> get() = uploads.map { it.groupId } + downloads

    companion object {
        /** Null for a message without a sender, or with nothing to show. */
        fun from(message: ChatMessage): ChannelPost? {
            val metadata = message.metadata ?: return null
            val sender = metadata["sender"] ?: return null
            val type = sender["type"]?.stringValue ?: return null
            if (type != "user" && type != "agent") return null
            val senderId = (metadata["sourceSessionId"]?.stringValue ?: sender["id"]?.stringValue)
                ?.takeIf { it.isNotEmpty() } ?: return null
            val name = sender["displayName"]?.stringValue?.takeIf { it.isNotBlank() } ?: return null
            val display = TransferUpload.display(message.parts)
            val downloads = message.parts.mapNotNull { part ->
                (part as? ChatPart.Other)?.value?.takeIf { it["type"]?.stringValue == "transfer-download" }
                    ?.get("groupId")?.stringValue?.takeIf { it.isNotEmpty() }
            }.distinct()
            val text = display.text.trim()
            if (text.isEmpty() && display.uploads.isEmpty() && downloads.isEmpty()) return null
            val sentAt = metadata["sentAt"]?.stringValue?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: message.createdAt
            return ChannelPost(message.id, senderId, type == "agent", name,
                SenderAvatar.trusted(sender["avatarURL"]?.stringValue), text, display.uploads, downloads, sentAt)
        }

        /** The posts still on their way: the chat has not returned them yet. */
        fun stillSending(stored: List<ChannelPost>, sending: List<ChannelPost>): List<ChannelPost> {
            val ids = stored.map { it.id }.toSet()
            return sending.filter { it.id !in ids }
        }

        /** Posts, the loop guard's lines and the typing bubble, in the order they happened. */
        fun items(posts: List<ChannelPost>, events: List<AgentConversationDetail.TimelineEvent>,
                  typing: List<ChannelAgent>): List<ChannelItem> {
            data class Timed(val at: Instant, val order: Int, val item: ChannelItem)
            val rows = mutableListOf<Timed>()
            var previous: Instant? = null
            posts.forEachIndexed { index, post ->
                // A post on its way is the newest, whatever the clocks say.
                val at = if (post.sending) Instant.MAX else post.sentAt ?: Instant.MIN
                // A post after a pause gets a centered time and starts a new run. A post on its way
                // shows its time at once, so the chat returning it adds no row above it.
                val timed = ChatTime.showsTimestamp(post.sentAt, previous)
                if (timed) post.sentAt?.let { rows += Timed(at, rows.size, ChannelItem.Time("time.${post.id}", it)) }
                previous = post.sentAt ?: previous
                val first = timed || index == 0 || posts[index - 1].senderId != post.senderId
                rows += Timed(at, rows.size, ChannelItem.Post(post, first))
            }
            events.filter { it.kind == "agents_paused" }.forEach { event ->
                rows += Timed(event.at, rows.size, ChannelItem.Paused("paused.${event.at.toEpochMilli()}", event.text))
            }
            val sorted = rows.sortedWith(compareBy<Timed>({ it.at }, { it.order })).map { it.item }
            return if (typing.isEmpty()) sorted else sorted + ChannelItem.Typing(typing)
        }
    }
}

/** What a chat's transcript shows. */
sealed class ChannelItem {
    abstract val key: String
    /** `first` starts a run: it carries the avatar and the name. */
    data class Post(val post: ChannelPost, val first: Boolean) : ChannelItem() { override val key get() = "post.${post.id}" }
    /** A centered time above a post that follows a pause. */
    data class Time(override val key: String, val at: Instant) : ChannelItem()
    /** The loop guard stopped agents answering agents. */
    data class Paused(override val key: String, val text: String) : ChannelItem()
    /** Agents in a turn right now. */
    data class Typing(val agents: List<ChannelAgent>) : ChannelItem() { override val key get() = "typing" }
}
