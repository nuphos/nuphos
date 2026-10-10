package ai.nuphos.android.model

import ai.nuphos.android.session.ChatSession
import java.time.Instant

sealed class ChatRow {
    abstract val id: String

    data class Timestamp(override val id: String, val date: Instant) : ChatRow()
    data class User(override val id: String, val messageId: String, val text: String, val images: List<String>) : ChatRow()
    data class AssistantText(override val id: String, val messageId: String, val text: String, val streaming: Boolean) : ChatRow()
    data class Reasoning(override val id: String, val part: ChatPart.Reasoning) : ChatRow()
    data class Tool(override val id: String, val messageId: String, val part: ChatPart.Tool, val canDecide: Boolean) : ChatRow()
    data class Work(override val id: String, val rows: List<ChatRow>, val duration: Double?) : ChatRow()
    data class Memory(override val id: String, val created: Int, val updated: Int) : ChatRow()
    data class MemoryRecall(override val id: String, val entries: List<MemoryEntry>, val fetched: Int) : ChatRow()
    data class Activity(val text: String?) : ChatRow() {
        override val id = "activity"
    }
    data class Hint(override val id: String, val text: String, val isError: Boolean) : ChatRow()
    data object Bottom : ChatRow() {
        override val id = "bottom"
    }

    data class MemoryEntry(val id: String, val label: String, val scope: String)

    companion object {
        private val hiddenTools = setOf("skill")

        fun rows(session: ChatSession): List<ChatRow> = rows(
            messages = session.messages,
            isStreaming = session.isStreaming,
            phaseLabel = session.phaseLabel,
            error = session.error,
            stoppedByUser = session.stoppedByUser,
        )

        internal fun rows(
            messages: List<ChatMessage>,
            isStreaming: Boolean = false,
            phaseLabel: String? = null,
            error: String? = null,
            stoppedByUser: Boolean = false,
        ): List<ChatRow> {
            val rows = mutableListOf<ChatRow>()
            val lastApprovalCallId = lastPendingApproval(messages)
            for ((index, message) in messages.withIndex()) {
                val previous = messages.getOrNull(index - 1)?.createdAt
                when (message.role) {
                    ChatMessage.Role.User -> {
                        if (ChatTime.showsTimestamp(message.createdAt, previous) && message.createdAt != null) {
                            rows += Timestamp("time.${message.id}", message.createdAt)
                        }
                        val text = message.text.trim()
                        val images = message.parts.mapNotNull { part ->
                            (part as? ChatPart.File)?.takeIf { it.mediaType.startsWith("image/") }?.url
                        }
                        if (text.isNotEmpty() || images.isNotEmpty()) {
                            rows += User("user.${message.id}", message.id, text, images)
                        }
                    }
                    ChatMessage.Role.Assistant -> {
                        val isLive = isStreaming && index == messages.lastIndex
                        rows += assistantRows(message, isLive, lastApprovalCallId)
                        if (message.stoppedByUser == true && index == messages.lastIndex && !isStreaming) {
                            rows += Hint("stopped.${message.id}", "Stopped.", false)
                        }
                    }
                    ChatMessage.Role.System -> Unit
                }
            }
            if (isStreaming) rows += Activity(phaseLabel)
            error?.takeIf { !stoppedByUser }?.let { rows += Hint("error", it, true) }
            rows += Bottom
            return rows
        }

        private fun assistantRows(message: ChatMessage, live: Boolean, lastApprovalCallId: String?): List<ChatRow> {
            val body = mutableListOf<ChatRow>()
            message.parts.forEachIndexed { pi, part ->
                when (part) {
                    is ChatPart.Text -> {
                        if (part.text.isNotBlank()) {
                            body += AssistantText("text.${message.id}.$pi", message.id, part.text, live && part.state == ChatPart.StreamState.Streaming)
                        }
                    }
                    is ChatPart.Reasoning -> {
                        if (part.text.isNotEmpty()) body += Reasoning("reasoning.${message.id}.$pi", part)
                    }
                    is ChatPart.Tool -> {
                        if (part.toolName !in hiddenTools) {
                            body += Tool("tool.${message.id}.${part.toolCallId}", message.id, part, part.toolCallId == lastApprovalCallId)
                        }
                    }
                    is ChatPart.Other if part.value["type"]?.stringValue == "memory-provenance" -> {
                        val v = part.value
                        val labels = v["labels"]?.objectValue.orEmpty()
                        fun entries(key: String, scope: String) =
                            (v[key]?.arrayValue ?: emptyList()).mapNotNull { it.stringValue }.map {
                                MemoryEntry(it, if (scope == "team") labels[it]?.stringValue?.takeIf { label -> label.isNotBlank() } ?: "Memory label unavailable" else "Details unavailable", scope)
                            }
                        val seen = mutableSetOf<String>()
                        val all = (entries("recalledPersonalIds", "personal") + entries("fetchedPersonalIds", "personal") +
                            entries("recalledTeamIds", "team") + entries("fetchedTeamIds", "team"))
                            .filter { seen.add(it.id) }
                        val fetched = v["fetchedIds"]?.arrayValue?.size ?: 0
                        if (all.isNotEmpty() || fetched > 0) {
                            body += MemoryRecall("recall.${message.id}.${v["turnKey"]?.stringValue ?: pi}", all, fetched)
                        }
                    }
                    is ChatPart.Other if part.value["type"]?.stringValue == "memory-ingest" -> {
                        val v = part.value
                        body += Memory(
                            "memory.${v["eventId"]?.stringValue ?: pi}",
                            v["memoriesCreated"]?.numberValue?.toInt() ?: 0,
                            v["memoriesUpdated"]?.numberValue?.toInt() ?: 0,
                        )
                    }
                    else -> Unit
                }
            }
            if (live) return body
            val lastText = body.indexOfLast { it is AssistantText }
            if (lastText < 0) return body
            fun foldable(row: ChatRow) = when (row) {
                is Reasoning -> true
                is Tool -> row.part.kind != ChatPart.Tool.Kind.Plan && row.part.kind != ChatPart.Tool.Kind.Question && row.part.state != ChatPart.Tool.State.ApprovalRequested
                else -> false
            }
            val intermediate = body.take(lastText).filter(::foldable)
            if (intermediate.size < 2) return body
            if (intermediate.any { it is Tool && it.part.state == ChatPart.Tool.State.ApprovalRequested }) return body
            val folded = mutableListOf<ChatRow>()
            val group = mutableListOf<ChatRow>()
            body.forEachIndexed { i, row ->
                if (i < lastText && foldable(row)) {
                    group += row
                    return@forEachIndexed
                }
                if (group.isNotEmpty()) {
                    folded += Work("work.${message.id}.${group.first().id}", group.toList(), workDuration(message))
                    group.clear()
                }
                folded += row
            }
            return folded
        }

        private fun workDuration(message: ChatMessage): Double? {
            var start: Double? = null
            var end: Double? = null
            for (part in message.parts) {
                if (part is ChatPart.Tool) {
                    part.startedAt?.let { start = minOf(start ?: it, it) }
                    part.completedAt?.let { end = maxOf(end ?: it, it) }
                }
            }
            val s = start ?: return null
            val e = end ?: return null
            if (e <= s) return null
            return (e - s) / 1000
        }

        private fun lastPendingApproval(messages: List<ChatMessage>): String? {
            for (m in messages.asReversed()) {
                if (m.role != ChatMessage.Role.Assistant) continue
                for (p in m.parts.asReversed()) {
                    if (p is ChatPart.Tool && p.state == ChatPart.Tool.State.ApprovalRequested) return p.toolCallId
                }
            }
            return null
        }
    }
}
