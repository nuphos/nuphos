package ai.nuphos.android.model

import ai.nuphos.android.data.TransferDownloadGroup
import java.time.Instant

/** Match iOS: the first assistant reply at/after creation, or the latest reply. */
object AgentDownloads {
    fun anchor(groups: List<TransferDownloadGroup>, messages: List<ChatMessage>): Map<String, List<TransferDownloadGroup>> {
        val replies = messages.filter { it.role == ChatMessage.Role.Assistant }
        val last = replies.lastOrNull() ?: return emptyMap()
        return groups.sortedBy { it.createdAt.orEmpty() }.groupBy { group ->
            val date = group.createdAt?.let { runCatching { Instant.parse(it) }.getOrNull() }
            (replies.firstOrNull { date != null && it.createdAt?.let { reply -> !reply.isBefore(date) } == true } ?: last).id
        }
    }
}
