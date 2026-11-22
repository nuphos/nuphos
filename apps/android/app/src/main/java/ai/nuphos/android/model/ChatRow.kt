package ai.nuphos.android.model

import ai.nuphos.android.R
import ai.nuphos.android.data.ComputerPresence
import ai.nuphos.android.session.ChatSession
import java.time.Instant

sealed class ChatRow {
    abstract val id: String

    data class Timestamp(override val id: String, val date: Instant) : ChatRow()
    data class User(override val id: String, val messageId: String, val text: String, val images: List<String>, val uploads: List<TransferUpload> = emptyList(), val sender: MessageAttribution? = null) : ChatRow()
    data class Event(override val id: String, val content: User) : ChatRow()
    /** A question someone answered, in place of the notice that told the agent. */
    data class Answered(override val id: String, val question: AnsweredQuestion) : ChatRow()
    data class AssistantText(override val id: String, val messageId: String, val text: String, val streaming: Boolean) : ChatRow()
    data class Reasoning(override val id: String, val part: ChatPart.Reasoning) : ChatRow()
    data class Tool(override val id: String, val messageId: String, val part: ChatPart.Tool, val canDecide: Boolean) : ChatRow()
    data class ToolRun(override val id: String, val rows: List<ChatRow>, val live: Boolean) : ChatRow()
    data class Work(override val id: String, val rows: List<ChatRow>, val duration: Double?) : ChatRow()
    data class Downloads(override val id: String, val group: ai.nuphos.android.data.TransferDownloadGroup) : ChatRow()
    data class Memory(override val id: String, val created: Int, val updated: Int) : ChatRow()
    data class MemoryRecall(override val id: String, val entries: List<MemoryEntry>, val fetched: Int) : ChatRow()
    data class Activity(val text: String?, val live: Boolean = true) : ChatRow() {
        override val id = "activity"
    }
    data class Hint(override val id: String, val text: String, val isError: Boolean) : ChatRow()
    data object Bottom : ChatRow() {
        override val id = "bottom"
    }

    data class MemoryEntry(val id: String, val label: String, val scope: String)
    data class FailedTurn(val rowId: String, val prompt: String)
    data class Interruption(val id: String, val reason: String, val message: String, val createdAt: String)

    companion object {
        fun interruption(part: ChatPart): Interruption? {
            val raw = (part as? ChatPart.Other)?.value ?: return null
            if (raw["type"]?.stringValue != "turn-interrupted") return null
            val id = raw["id"]?.stringValue ?: return null
            val message = raw["message"]?.stringValue ?: return null
            val reason = raw["reason"]?.stringValue?.takeIf { it in setOf("cancelled", "timeout", "error") } ?: "error"
            return Interruption(id, reason, message, raw["createdAt"]?.stringValue.orEmpty())
        }

        fun failureReport(rowId: String, messages: List<ChatMessage>): String? {
            for (message in messages.asReversed()) for (part in message.parts) {
                val failure = interruption(part) ?: continue
                if (failure.reason != "cancelled" && "interrupted.${message.id}.${failure.id}" == rowId)
                    return listOf(Words(if (failure.reason == "timeout") R.string.failed_turn_timed_out else R.string.failed_turn_failed),
                        failure.message, failure.createdAt).joinToString("\n")
            }
            return null
        }

        /** Retry never drops attachments, repeats an event, or resends another person's prompt. */
        fun failedTurn(messages: List<ChatMessage>, userId: String?, foreignChat: Boolean): FailedTurn? {
            if (messages.size < 2) return null
            val reply = messages.last()
            val asked = messages[messages.lastIndex - 1]
            if (reply.role != ChatMessage.Role.Assistant || asked.role != ChatMessage.Role.User ||
                asked.metadata?.get("source")?.stringValue in setOf("agent.thread", "agent.resource")) return null
            val failure = reply.parts.asReversed().firstNotNullOfOrNull(::interruption) ?: return null
            if (failure.reason == "cancelled") return null
            val sender = asked.metadata?.get("sender")?.get("id")?.stringValue
            if (sender != null) { if (sender != userId) return null } else if (foreignChat) return null
            if (asked.parts.any { it !is ChatPart.Text }) return null
            val prompt = asked.parts.filterIsInstance<ChatPart.Text>().joinToString("") { it.text }.trim()
            return prompt.takeIf { it.isNotEmpty() }?.let { FailedTurn("interrupted.${reply.id}.${failure.id}", it) }
        }

        /** Tools the desktop never renders as a row. */
        private fun isHidden(tool: ChatPart.Tool) = tool.toolName == "skill" || tool.isQuestionCard

        /** `presence`: how the conversation's computer stands right now. */
        fun rows(session: ChatSession, presence: ComputerPresence = ComputerPresence.Online): List<ChatRow> = rows(
            messages = session.messages,
            isStreaming = session.isStreaming,
            phaseLabel = session.phaseLabel,
            runtimeStatus = session.runtimeLabel,
            runtimeTurnActive = session.runtimeTurnActive,
            cancelRequested = session.isNative && session.cancelRequested,
            error = session.error,
            stoppedByUser = session.stoppedByUser,
            downloads = if (session.canReadDownloads) session.downloads else emptyList(),
            timeline = session.timelineEvents,
            waiting = session.waitingAnswers,
            hasEarlier = session.baseIndex > 0,
            localSender = session::localSender,
            presence = presence,
            sendQueued = session.serverQueue.items.isNotEmpty(),
        )

        internal fun rows(
            messages: List<ChatMessage>,
            isStreaming: Boolean = false,
            phaseLabel: String? = null,
            runtimeStatus: String? = null,
            runtimeTurnActive: Boolean = false,
            cancelRequested: Boolean = false,
            error: String? = null,
            stoppedByUser: Boolean = false,
            downloads: List<ai.nuphos.android.data.TransferDownloadGroup> = emptyList(),
            timeline: List<AgentConversationDetail.TimelineEvent> = emptyList(),
            /** What each answered question's answer still waits for, by request id. */
            waiting: Map<String, String> = emptyMap(),
            hasEarlier: Boolean = false,
            localSender: (String) -> MessageAttribution? = { null },
            presence: ComputerPresence = ComputerPresence.Online,
            /** A send waits in the server queue: its computer is already being woken or waited for. */
            sendQueued: Boolean = false,
        ): List<ChatRow> {
            val rows = mutableListOf<ChatRow>()
            // Only a citation a row actually shows hides the card: a part still streaming stays Markdown.
            val cited = messages.withIndex().filter { it.value.role == ChatMessage.Role.Assistant }.flatMap { (index, message) ->
                message.parts.filterIsInstance<ChatPart.Text>().filterNot { streaming(isStreaming && index == messages.lastIndex, it) }
            }.flatMapTo(mutableSetOf()) { ReplyFiles.cited(it.text) }
            val anchoredDownloads = AgentDownloads.anchor(downloads.filter { it.groupId !in cited }, messages)
            val groups = downloads.associateBy { it.groupId }
            val events = timeline.distinctBy { it.at to it.text }.sortedBy { it.at }.groupBy { event ->
                messages.indexOfFirst { it.createdAt?.isAfter(event.at) == true }
            }
            fun eventRows(index: Int) = events[index].orEmpty().map { Hint("event.${it.at}.${it.text}", it.text, false) }
            val lastApprovalCallId = lastPendingApproval(messages)
            val steeringIds = mutableSetOf<String>()
            val steeringSenders = linkedMapOf<String, MessageAttribution>()
            messages.flatMap { it.parts }.filterIsInstance<ChatPart.Data>().filter { it.name == "steering" }.forEach { part ->
                val id = part.data["id"]?.stringValue
                val sender = MessageAttribution.parse(part.data["metadata"])
                if (id != null && sender != null) steeringSenders.putIfAbsent(id, sender)
            }
            for ((index, message) in messages.withIndex()) {
                if (index > 0 || !hasEarlier) rows += eventRows(index)
                val previous = messages.getOrNull(index - 1)?.createdAt
                when (message.role) {
                    ChatMessage.Role.User -> {
                        val sender = MessageAttribution.parse(message.metadata) ?: if (message.metadata == null) localSender(message.id) else null
                        if (sender?.isEvent != true && ChatTime.showsTimestamp(message.createdAt, previous) && message.createdAt != null) {
                            rows += Timestamp("time.${message.id}", message.createdAt)
                        }
                        val display = TransferUpload.display(message.parts)
                        val text = display.text
                        val images = if (display.uploads.isNotEmpty()) emptyList() else message.parts.mapNotNull { part ->
                            (part as? ChatPart.File)?.takeIf { it.mediaType.startsWith("image/") }?.url
                        }
                        val answered = if (sender?.id == AnsweredQuestion.SENDER && sender.isEvent) AnsweredQuestion.all(message, text, messages) else null
                        if (answered != null) {
                            // Its answer has not reached the agent yet: the last line says what it waits for.
                            val note = AnsweredQuestion.Notice.parse(text.trim())?.requestId?.let(waiting::get)
                            rows += answered.mapIndexed { at, question ->
                                Answered("answered.${message.id}.$at", if (at == answered.lastIndex) question.copy(waiting = note) else question)
                            }
                        } else if (text.isNotEmpty() || images.isNotEmpty() || display.uploads.isNotEmpty()) {
                            val user = User("user.${message.id}", message.id, text, images, display.uploads, sender)
                            rows += if (sender?.isEvent == true) Event("event.${message.id}", user) else user
                        }
                    }
                    ChatMessage.Role.Assistant -> {
                        val isLive = isStreaming && index == messages.lastIndex
                        rows += assistantRows(message, isLive, lastApprovalCallId, steeringIds, steeringSenders, groups)
                        rows += anchoredDownloads[message.id].orEmpty().map { Downloads("downloads.${it.groupId}", it) }
                        if (message.stoppedByUser == true && !isLive && message.parts.none { interruption(it)?.reason == "cancelled" }) {
                            val calls = message.parts.count { it is ChatPart.Tool }
                            val text = if (calls == 0) Words(R.string.convtext_stopped_by_you) else Words.plural(R.plurals.convtext_stopped_by_you_calls, calls, calls)
                            rows += Hint("stopped.${message.id}", text, false)
                        }
                    }
                    ChatMessage.Role.System -> Unit
                }
            }
            rows += eventRows(-1)
            // A native runtime reports its own status; it's the transcript's last row, as on iOS.
            if (!runtimeStatus.isNullOrBlank()) rows += Activity(runtimeStatus, live = isStreaming || runtimeTurnActive)
            else if (isStreaming || !phaseLabel.isNullOrBlank()) rows += Activity(phaseLabel, live = isStreaming)
            if (cancelRequested) rows += Hint("cancel-requested", Words(R.string.convtext_cancellation_requested), false)
            val latestFailure = messages.lastOrNull()?.takeIf { it.role == ChatMessage.Role.Assistant }
                ?.parts?.asReversed()?.firstNotNullOfOrNull(::interruption)
            val shownError = error?.takeIf { text -> !stoppedByUser &&
                !(latestFailure?.reason != "cancelled" && latestFailure?.message == text) }
            if (shownError != null) rows += Hint("error", shownError, true)
            else if (!isStreaming && !runtimeTurnActive && !sendQueued) when (presence) {
                // Said before the message goes, with the way on: another runtime.
                ComputerPresence.Offline -> rows += Hint("runtime-offline", Words(R.string.convtext_runtime_offline), true)
                // Sending resumes a paused Box, so nothing points away from it.
                is ComputerPresence.Paused -> rows += Hint("runtime-paused", Words(R.string.convtext_runtime_paused, presence.label), false)
                // A starting Box comes online by itself, so nothing points away from it either.
                is ComputerPresence.Starting -> rows += Hint("runtime-starting", Words(R.string.convtext_runtime_starting, presence.label), false)
                ComputerPresence.Online -> Unit
            }
            rows += Bottom
            return rows
        }

        private fun streaming(live: Boolean, part: ChatPart.Text) = live && part.state == ChatPart.StreamState.Streaming

        private fun assistantRows(message: ChatMessage, live: Boolean, lastApprovalCallId: String?, steeringIds: MutableSet<String>, steeringSenders: Map<String, MessageAttribution>, groups: Map<String, ai.nuphos.android.data.TransferDownloadGroup>): List<ChatRow> {
            val body = mutableListOf<ChatRow>()
            message.parts.forEachIndexed { pi, part ->
                when (part) {
                    is ChatPart.Text -> {
                        val streaming = streaming(live, part)
                        val segments = if (streaming) listOf(ReplyFiles.Segment.Text(part.text)) else ReplyFiles.segments(part.text)
                        segments.forEachIndexed { si, segment ->
                            val id = if (segments.size == 1) "text.${message.id}.$pi" else "text.${message.id}.$pi.$si"
                            when (segment) {
                                is ReplyFiles.Segment.Text -> if (segment.text.isNotBlank()) body += AssistantText(id, message.id, segment.text, streaming)
                                // A group no longer listed (expired) still gets its card, which says so.
                                is ReplyFiles.Segment.Files -> body += Downloads(id, groups[segment.groupId]
                                    ?: ai.nuphos.android.data.TransferDownloadGroup(segment.groupId, "", emptyList()))
                            }
                        }
                    }
                    is ChatPart.Reasoning -> {
                        if (part.text.isNotEmpty()) body += Reasoning("reasoning.${message.id}.$pi", part)
                    }
                    is ChatPart.Tool -> {
                        if (!isHidden(part)) {
                            body += Tool("tool.${message.id}.${part.toolCallId}", message.id, part, part.toolCallId == lastApprovalCallId)
                        }
                    }
                    is ChatPart.Other if interruption(part) != null -> {
                        val failure = requireNotNull(interruption(part))
                        body += Hint("interrupted.${message.id}.${failure.id}",
                            if (failure.reason == "cancelled") Words(R.string.failed_turn_stopped) else failure.message,
                            failure.reason != "cancelled")
                    }
                    is ChatPart.Data if part.name == "steering" -> {
                        val id = part.data["id"]?.stringValue?.takeIf { it.isNotBlank() }
                        val text = part.data["text"]?.stringValue
                        if (id != null && text != null && text.isNotBlank() && steeringIds.add(id)) {
                            val sender = steeringSenders[id]
                            val user = User("steering.$id", message.id, text, emptyList(), sender = sender)
                            body += if (sender?.isEvent == true) Event("steering.$id", user) else user
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
                        val created = v["memoriesCreated"]?.numberValue?.toInt() ?: 0
                        val updated = v["memoriesUpdated"]?.numberValue?.toInt() ?: 0
                        if (created > 0 || updated > 0) {
                            body += Memory("memory.${message.id}.${v["eventId"]?.stringValue ?: pi}", created, updated)
                        }
                    }
                    else -> Unit
                }
            }
            if (live) {
                while (body.lastOrNull() is Reasoning) body.removeAt(body.lastIndex)
                return toolRuns(body, live = true)
            }
            // Receipts preserve the interleaving of the user's steering and the agent's work.
            if (body.any { it is User || it is Event }) return toolRuns(body, live = false)
            val lastText = body.indexOfLast { it is AssistantText }
            if (lastText < 0) return toolRuns(body, live = false)
            fun foldable(row: ChatRow) = when (row) {
                is Reasoning -> true
                is Tool -> row.part.kind != ChatPart.Tool.Kind.Plan && row.part.kind != ChatPart.Tool.Kind.Question &&
                    row.part.state != ChatPart.Tool.State.ApprovalRequested && ThreadReference.from(row.part) == null
                else -> false
            }
            if (body.any { it is Tool && (it.part.state == ChatPart.Tool.State.ApprovalRequested ||
                    it.part.state == ChatPart.Tool.State.OutputError) }) return toolRuns(body, live = false)
            val intermediate = body.take(lastText).filter(::foldable)
            if (intermediate.size < 2) return toolRuns(body, live = false)
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
            return toolRuns(folded, live = false)
        }

        internal fun toolRuns(rows: List<ChatRow>, live: Boolean): List<ChatRow> {
            fun ordinary(row: ChatRow) = row is Tool && row.part.kind != ChatPart.Tool.Kind.Plan &&
                row.part.kind != ChatPart.Tool.Kind.Question && ThreadReference.from(row.part) == null
            val result = mutableListOf<ChatRow>()
            var index = 0
            while (index < rows.size) {
                if (!ordinary(rows[index])) { result += rows[index++]; continue }
                var end = index + 1
                var lastTool = index
                var calls = 1
                while (end < rows.size && (ordinary(rows[end]) || rows[end] is Reasoning)) {
                    if (ordinary(rows[end])) { lastTool = end; calls++ }
                    end++
                }
                if (calls > 1) {
                    // Keep the first call's key when a live sequence grows into a run.
                    result += ToolRun(rows[index].id, rows.subList(index, lastTool + 1).toList(), live)
                    index = lastTool + 1
                } else result += rows[index++]
            }
            return result
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
