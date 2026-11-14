package ai.nuphos.android.model

import ai.nuphos.android.data.Instants
import ai.nuphos.android.data.JsonValue
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import java.time.Instant

object InstantAsStringSerializer : KSerializer<Instant> {
    override val descriptor = PrimitiveSerialDescriptor("Instant", PrimitiveKind.STRING)
    override fun serialize(encoder: Encoder, value: Instant) = encoder.encodeString(value.toString())
    override fun deserialize(decoder: Decoder): Instant =
        Instants.parse(decoder.decodeString()) ?: Instant.EPOCH
}

object InstantAsStringSerializerNullable : KSerializer<Instant?> {
    private val delegate = String.serializer().nullable
    override val descriptor = delegate.descriptor
    override fun serialize(encoder: Encoder, value: Instant?) =
        delegate.serialize(encoder, value?.toString())
    override fun deserialize(decoder: Decoder): Instant? =
        Instants.parse(delegate.deserialize(decoder))
}

@Serializable
data class AgentConversation(
    val sessionId: String,
    val teamId: String? = null,
    val title: String = "",
    val firstMessage: String = "",
    val messageCount: Int = 0,
    @Serializable(with = InstantAsStringSerializer::class)
    val createdAt: Instant = Instant.EPOCH,
    @Serializable(with = InstantAsStringSerializer::class)
    val lastActiveAt: Instant = Instant.EPOCH,
    @Serializable(with = InstantAsStringSerializerNullable::class)
    val archivedAt: Instant? = null,
    val owner: Owner? = null,
    val isOwner: Boolean? = null,
    val watching: Boolean? = null,
    val readOnly: Boolean? = null,
    val tokenUsage: TokenUsage? = null,
    val activitySource: ActivitySource? = null,
    val activeRun: JsonValue? = null,
    val runtimeState: JsonValue? = null,
    val activitySeq: JsonValue? = null,
    val readSeq: JsonValue? = null,
    val unread: JsonValue? = null,
    val parentSessionId: String? = null,
    val canManage: Boolean? = null,
    val agentRuntime: String? = null,
    val runtimeId: String? = null,
    val runtimeLabel: String? = null,
    /** `channel` for a chat where people and agents talk; null for an agent. */
    val kind: String? = null,
    /** Started as a group chat: never a Bot's 1:1 chat, even with one Bot in it. */
    val group: Boolean? = null,
    /** A chat's icon: up to two members other than the viewer, whoever spoke last first. */
    val faces: List<ChatFace>? = null,
    /** A Bot's face, e.g. `05-rembrandt`; null for a Task. */
    val avatar: String? = null,
    /** A chat's newest post. Read through [lastPost], so a bad value only costs the preview. */
    val lastMessage: JsonValue? = null,
    /** Open `request_user_decision` questions, oldest first; list rows carry only the open ones. */
    val inputRequests: List<InputRequest>? = null,
) {
    @Transient
    val id: String get() = sessionId

    val displayTitle: String
        get() = title.ifEmpty { firstMessage.ifEmpty { "Untitled agent" } }

    val isArchived: Boolean get() = archivedAt != null

    val isChannel: Boolean get() = kind == "channel"

    /** An agent with a face: a Bot, talked to in its 1:1 chat. */
    val isBot: Boolean get() = avatar != null && !isChannel

    /** The Bot this chat is the 1:1 of: its one other member is an agent with a face. */
    val botId: String? get() = faces?.takeIf { isChannel && group != true }?.botFace?.id

    /** The Bot of this 1:1 chat is in a turn that answers it: the chat's dots, which its row shows in place of [previewLine]. */
    fun botTyping(typingIn: (botId: String, chatId: String) -> Boolean): Boolean = botId?.let { typingIn(it, sessionId) } == true

    val lastPost: LastPost? get() = lastMessage?.get("text")?.stringValue?.let { LastPost(it, lastMessage["from"]?.stringValue) }

    /**
     * The list's preview line; a post with only files says so. Only a chat with more than one other
     * member names who posted: in a 1:1 the row already is the sender.
     */
    val previewLine: String? get() = lastPost?.let { post ->
        val text = post.text.ifBlank { "Attachment" }
        if (post.from != null && (faces?.size ?: 0) > 1) "${post.from}: $text" else text
    }

    data class LastPost(val text: String, val from: String?)

    @Serializable
    data class Owner(
        val id: String,
        val name: String? = null,
        val email: String? = null,
        val avatarURL: String? = null,
        val deactivated: Boolean? = null,
    ) {
        val displayName: String
            get() = name?.takeIf { it.isNotEmpty() } ?: email?.takeIf { it.isNotEmpty() } ?: "User"
    }

    @Serializable
    data class TokenUsage(val costUsd: Double? = null)

    @Serializable
    data class ActivitySource(
        val origin: String,
        val linkedSlackThread: Boolean? = null,
    )
}

/** A member a chat's icon shows: a person, or an agent by its session (`ChannelFace` on desktop). */
@Serializable
data class ChatFace(
    val id: String,
    val name: String,
    val avatarURL: String? = null,
    val agent: Agent? = null,
) {
    @Serializable
    data class Agent(val avatar: String? = null, val provider: String? = null)
}

/** A question still waiting on the conversation's owner. */
@Serializable
data class InputRequest(
    val id: String,
    val category: String? = null,
    val question: String = "",
    val options: List<String>? = null,
    /** ISO time it was asked. */
    val askedAt: String? = null,
    /** Markdown the agent wrote to decide from: context, findings, links, risks. */
    val body: String? = null,
    /** The plan an approval decides: answered with its Approve or Reject, never in words. */
    val planId: String? = null,
    /** An integration question's providers (any access answers it), or the exact credentials it names. */
    val providers: List<String>? = null,
    val credentials: List<CredentialRef>? = null,
    /** Any number of [options] may be picked. */
    val multiSelect: Boolean? = null,
    /** Related questions answered together; [question] is their headline. */
    val questions: List<DecisionQuestion>? = null,
)

/** One of the questions a several-question card answers together. */
@Serializable
data class DecisionQuestion(
    val question: String = "",
    val options: List<String>? = null,
    val multiSelect: Boolean? = null,
)

/** A credential an integration question names: `{provider: "personal", id: "github"}` is the member's own. */
@Serializable
data class CredentialRef(val provider: String, val id: String)

/** The Bot a chat with these faces is the 1:1 of: its one other member is an agent with a face. */
val List<ChatFace>.botFace: ChatFace? get() = singleOrNull()?.takeIf { it.agent?.avatar != null }

@Serializable
data class AgentConversationsPage(
    val conversations: List<AgentConversation> = emptyList(),
    val nextCursor: String? = null,
    val hasMore: Boolean = false,
    val parents: List<AgentConversation>? = null,
) {
    /** Authorized ancestors supplied by the server; pagination stays on conversations. */
    val rows: List<AgentConversation>
        get() = (conversations + parents.orEmpty()).distinctBy { it.sessionId }
}

@Serializable
data class AgentConversationDetail(
    @Serializable(with = ReadableChatMessagesSerializer::class)
    val messages: List<ChatMessage> = emptyList(),
    val messagesFirstIndex: Int? = null,
    val activeRun: ActiveRun? = null,
    val watching: Boolean? = null,
    val readOnly: Boolean? = null,
    val isOwner: Boolean? = null,
    val canManage: Boolean? = null,
    val canCancelRun: Boolean? = null,
    val canRespondToRun: Boolean? = null,
    val agentRuntime: String? = null,
    val runtimeId: String? = null,
    val runtimeLabel: String? = null,
    val runtimeState: JsonValue? = null,
    val transcriptUpdatedAt: String? = null,
    val activitySeq: JsonValue? = null,
    val readSeq: JsonValue? = null,
    val unread: JsonValue? = null,
    val title: String? = null,
    @Serializable(with = InstantAsStringSerializerNullable::class)
    val archivedAt: Instant? = null,
    val credentialAccess: JsonValue? = null,
    val timelineEvents: List<TimelineEvent> = emptyList(),
    val promptSuggestion: String? = null,
    /** `channel` for a chat; such a session never runs an agent turn of its own. */
    val kind: String? = null,
    val messageCount: Int? = null,
    /** A chat's icon, as the list row carries it. */
    val faces: List<ChatFace> = emptyList(),
) {
    val isChannel: Boolean get() = kind == "channel"

    @Serializable
    data class TimelineEvent(
        @Serializable(with = InstantAsStringSerializer::class) val at: Instant,
        val text: String,
        val kind: String? = null,
        /** `agent_reply_failed`: the agent that could not reply, for Retry and Switch agent. */
        val agentId: String? = null,
        /** `agent_reply_failed`: `usage_limit`, `auth` or `offline` when the agent itself was the cause, else `other`. */
        val cause: String? = null,
        /** `agent_reply_failed`: when an agent out of usage gets it back. */
        @Serializable(with = InstantAsStringSerializer::class) val resetsAt: Instant? = null,
    )
    @Serializable
    data class ActiveRun(
        val streamId: String,
        val startedAt: String? = null,
    )
}

enum class HistoryTime {
    ;

    companion object {
        fun format(instant: Instant, now: Instant = Instant.now()): String {
            val seconds = maxOf(0L, now.epochSecond - instant.epochSecond)
            val minutes = (seconds / 60).toInt()
            if (minutes < 1) return "now"
            if (minutes < 60) return "$minutes min"
            val hours = minutes / 60
            if (hours < 24) return plural(hours, "hr")
            val days = hours / 24
            if (days < 30) return plural(days, "day")
            val months = days / 30
            if (months < 12) return plural(months, "mo")
            return plural(months / 12, "yr")
        }

        private fun plural(n: Int, unit: String) = "$n $unit${if (n == 1) "" else "s"}"
    }
}

object ChatTime {
    const val SEPARATOR_SECONDS = 15 * 60L

    fun label(date: Instant, now: Instant = Instant.now()): String {
        val seconds = now.epochSecond - date.epochSecond
        if (seconds < 60) return "Just now"
        val minutes = (seconds / 60).toInt()
        if (minutes < 60) return "$minutes min ago"
        val hours = minutes / 60
        if (hours <= 3) return "$hours hr ago"
        val time = java.time.format.DateTimeFormatter.ofLocalizedTime(java.time.format.FormatStyle.SHORT)
            .withZone(java.time.ZoneId.systemDefault())
            .format(date)
        val zone = java.time.ZoneId.systemDefault()
        val days = java.time.temporal.ChronoUnit.DAYS.between(
            date.atZone(zone).toLocalDate(),
            now.atZone(zone).toLocalDate(),
        ).toInt()
        return when (days) {
            0 -> time
            1 -> "Yesterday $time"
            2 -> "2 days ago $time"
            else -> {
                val sameYear = date.atZone(zone).year == now.atZone(zone).year
                val day = if (sameYear) {
                    java.time.format.DateTimeFormatter.ofPattern("MM/dd").withZone(zone).format(date)
                } else {
                    java.time.format.DateTimeFormatter.ofPattern("MM/dd/yyyy").withZone(zone).format(date)
                }
                if (sameYear) "$time, $day" else "$time $day"
            }
        }
    }

    fun showsTimestamp(date: Instant?, previous: Instant?): Boolean {
        if (date == null) return false
        if (previous == null) return true
        // After a pause or on a new day, as in iMessage.
        val zone = java.time.ZoneId.systemDefault()
        return date.epochSecond - previous.epochSecond > SEPARATOR_SECONDS ||
            date.atZone(zone).toLocalDate() > previous.atZone(zone).toLocalDate()
    }
}

object PlanLink {
    data class Target(val teamId: String, val planId: String)

    fun target(url: String): Target? = runCatching { target(java.net.URI(url)) }.getOrNull()

    fun target(uri: java.net.URI): Target? {
        val host = uri.host?.lowercase()
        if (host != null) {
            val selfHosted = !ai.nuphos.android.data.BackendOrigin.isCloud()
            val own = java.net.URI(ai.nuphos.android.data.NuphosWeb.SITE_URL)
            if (selfHosted) {
                if (uri.scheme != own.scheme || uri.rawAuthority != own.rawAuthority) return null
            } else if (host != "nuphos.ai" && !host.endsWith(".nuphos.ai")) return null
        } else if (uri.scheme != null) {
            return null
        }
        val parts = uri.path.orEmpty().trim('/').split('/').filter { it.isNotEmpty() }
        if (parts.size < 4 || parts[0] != "teams" || parts[2] != "plans") return null
        if (parts[1].isEmpty() || parts[3].isEmpty()) return null
        return Target(parts[1], parts[3])
    }
}

/**
 * What the Bots page lists: every chat, and each Bot that has no 1:1 chat yet, newest first.
 * [bots] is the server's Bots listing, so a Bot far back in the history is listed too.
 */
fun botsList(channels: List<AgentConversation>, bots: List<AgentConversation>): List<AgentConversation> {
    val chatted = channels.mapNotNull { it.botId }.toSet()
    val unchatted = bots.filter { it.isBot && !it.isArchived && it.sessionId !in chatted }
    return (channels + unchatted).sortedByDescending { it.lastActiveAt }
}
