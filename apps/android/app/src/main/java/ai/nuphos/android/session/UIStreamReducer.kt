package ai.nuphos.android.session

import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.ChatMessage
import ai.nuphos.android.model.ChatPart
import java.time.Instant

class UIStreamReducer(var message: ChatMessage) {
    enum class Outcome { None, Finished, Aborted, Error }

    var errorText: String? = null
        private set
    var abortReason: String? = null
        private set

    private val partialToolInput = mutableMapOf<String, String>()

    fun apply(event: JsonValue): Outcome {
        val type = event["type"]?.stringValue ?: return Outcome.None
        when (type) {
            "start" -> {
                event["messageId"]?.stringValue?.takeIf { it.isNotEmpty() }?.let { message = message.copy(id = it) }
                event["messageMetadata"]?.let { message = message.copy(metadata = it) }
                return Outcome.None
            }
            "message-metadata" -> {
                event["messageMetadata"]?.let { message = message.copy(metadata = it) }
                return Outcome.None
            }
            "start-step" -> {
                message = message.copy(parts = message.parts + ChatPart.StepStart)
                return Outcome.None
            }
            "finish-step" -> return Outcome.None
            "reset-step" -> {
                val last = message.parts.indexOfLast { it is ChatPart.StepStart }
                if (last >= 0) message = message.copy(parts = message.parts.take(last + 1))
                return Outcome.None
            }
            "text-start" -> {
                closeOpenParts(except = Kind.Text)
                message = message.copy(
                    parts = message.parts + ChatPart.Text(
                        id = event["id"]?.stringValue,
                        text = "",
                        state = ChatPart.StreamState.Streaming,
                        providerMetadata = event["providerMetadata"],
                    ),
                )
                return Outcome.None
            }
            "text-delta" -> {
                closeOpenParts(except = Kind.Text)
                val id = event["id"]?.stringValue
                val delta = event["delta"]?.stringValue.orEmpty()
                val i = textIndex(id)
                message = if (i != null) {
                    val p = message.parts[i] as ChatPart.Text
                    replacePart(i, p.copy(text = p.text + delta, providerMetadata = event["providerMetadata"] ?: p.providerMetadata))
                } else {
                    message.copy(parts = message.parts + ChatPart.Text(id = id, text = delta, state = ChatPart.StreamState.Streaming))
                }
                return Outcome.None
            }
            "text-end" -> {
                val i = textIndex(event["id"]?.stringValue) ?: return Outcome.None
                val p = message.parts[i] as ChatPart.Text
                message = replacePart(i, p.copy(state = ChatPart.StreamState.Done, providerMetadata = event["providerMetadata"] ?: p.providerMetadata))
                return Outcome.None
            }
            "reasoning-start" -> {
                closeOpenParts(except = Kind.Reasoning)
                message = message.copy(
                    parts = message.parts + ChatPart.Reasoning(
                        id = event["id"]?.stringValue,
                        text = "",
                        state = ChatPart.StreamState.Streaming,
                        providerMetadata = event["providerMetadata"],
                        startedAt = Instant.now(),
                    ),
                )
                return Outcome.None
            }
            "reasoning-delta" -> {
                closeOpenParts(except = Kind.Reasoning)
                val id = event["id"]?.stringValue
                val delta = event["delta"]?.stringValue.orEmpty()
                val i = reasoningIndex(id)
                message = if (i != null) {
                    val p = message.parts[i] as ChatPart.Reasoning
                    replacePart(i, p.copy(text = p.text + delta, providerMetadata = event["providerMetadata"] ?: p.providerMetadata))
                } else {
                    message.copy(parts = message.parts + ChatPart.Reasoning(id = id, text = delta, state = ChatPart.StreamState.Streaming, startedAt = Instant.now()))
                }
                return Outcome.None
            }
            "reasoning-end" -> {
                val i = reasoningIndex(event["id"]?.stringValue) ?: return Outcome.None
                val p = message.parts[i] as ChatPart.Reasoning
                message = replacePart(
                    i,
                    p.copy(state = ChatPart.StreamState.Done, endedAt = Instant.now(), providerMetadata = event["providerMetadata"] ?: p.providerMetadata),
                )
                return Outcome.None
            }
            "tool-input-start" -> {
                closeOpenParts(except = Kind.Tool)
                val callId = event["toolCallId"]?.stringValue.orEmpty()
                updateTool(callId) { part ->
                    part.copy(
                        toolName = event["toolName"]?.stringValue ?: "tool",
                        isDynamic = event["dynamic"]?.boolValue ?: false,
                        state = ChatPart.Tool.State.InputStreaming,
                        startedAt = part.startedAt ?: Instant.now().toEpochMilli().toDouble(),
                        providerExecuted = event["providerExecuted"]?.boolValue ?: part.providerExecuted,
                        title = event["title"]?.stringValue ?: part.title,
                    )
                }
                partialToolInput[callId] = ""
                return Outcome.None
            }
            "tool-input-delta" -> {
                val callId = event["toolCallId"]?.stringValue.orEmpty()
                val delta = event["inputTextDelta"]?.stringValue.orEmpty()
                val raw = (partialToolInput[callId].orEmpty() + delta).also { partialToolInput[callId] = it }
                updateTool(callId) { part ->
                    part.copy(
                        inputText = raw,
                        state = ChatPart.Tool.State.InputStreaming,
                        input = JsonValue.parse(raw) ?: part.input,
                    )
                }
                return Outcome.None
            }
            "tool-input-available" -> {
                val callId = event["toolCallId"]?.stringValue.orEmpty()
                if (!hasTool(callId)) closeOpenParts(except = Kind.Tool)
                updateTool(callId) { part ->
                    val name = event["toolName"]?.stringValue
                    part.copy(
                        toolName = if (name != null && (part.toolName == "tool" || part.toolName.isEmpty())) name else part.toolName,
                        isDynamic = event["dynamic"]?.boolValue ?: part.isDynamic,
                        state = ChatPart.Tool.State.InputAvailable,
                        input = event["input"],
                        inputText = "",
                        startedAt = part.startedAt ?: Instant.now().toEpochMilli().toDouble(),
                        providerExecuted = event["providerExecuted"]?.boolValue ?: part.providerExecuted,
                        callProviderMetadata = event["providerMetadata"] ?: part.callProviderMetadata,
                        title = event["title"]?.stringValue ?: part.title,
                    )
                }
                partialToolInput.remove(callId)
                return Outcome.None
            }
            "tool-input-error" -> {
                val callId = event["toolCallId"]?.stringValue.orEmpty()
                updateTool(callId) { part ->
                    part.copy(
                        toolName = event["toolName"]?.stringValue ?: part.toolName,
                        state = ChatPart.Tool.State.OutputError,
                        input = event["input"] ?: part.input,
                        errorText = event["errorText"]?.stringValue,
                    )
                }
                return Outcome.None
            }
            "tool-approval-request" -> {
                val callId = event["toolCallId"]?.stringValue.orEmpty()
                updateTool(callId) { part ->
                    part.copy(
                        state = ChatPart.Tool.State.ApprovalRequested,
                        approval = event["approvalId"]?.stringValue?.let { ChatPart.Tool.Approval(id = it) } ?: part.approval,
                    )
                }
                return Outcome.None
            }
            "tool-output-available" -> {
                val callId = event["toolCallId"]?.stringValue.orEmpty()
                updateTool(callId) { part ->
                    part.copy(
                        state = ChatPart.Tool.State.OutputAvailable,
                        output = event["output"],
                        completedAt = Instant.now().toEpochMilli().toDouble(),
                        providerExecuted = event["providerExecuted"]?.boolValue ?: part.providerExecuted,
                    )
                }
                return Outcome.None
            }
            "tool-output-error" -> {
                val callId = event["toolCallId"]?.stringValue.orEmpty()
                updateTool(callId) { part ->
                    part.copy(
                        state = ChatPart.Tool.State.OutputError,
                        errorText = event["errorText"]?.stringValue,
                        completedAt = Instant.now().toEpochMilli().toDouble(),
                        providerExecuted = event["providerExecuted"]?.boolValue ?: part.providerExecuted,
                    )
                }
                return Outcome.None
            }
            "tool-output-denied" -> {
                val callId = event["toolCallId"]?.stringValue.orEmpty()
                updateTool(callId) { part -> part.copy(state = ChatPart.Tool.State.OutputDenied) }
                return Outcome.None
            }
            "file" -> {
                message = message.copy(
                    parts = message.parts + ChatPart.File(
                        mediaType = event["mediaType"]?.stringValue.orEmpty(),
                        filename = event["filename"]?.stringValue,
                        url = event["url"]?.stringValue.orEmpty(),
                    ),
                )
                return Outcome.None
            }
            "source-url" -> {
                message = message.copy(
                    parts = message.parts + ChatPart.SourceUrl(
                        sourceId = event["sourceId"]?.stringValue.orEmpty(),
                        url = event["url"]?.stringValue.orEmpty(),
                        title = event["title"]?.stringValue,
                    ),
                )
                return Outcome.None
            }
            "source-document" -> {
                message = message.copy(parts = message.parts + ChatPart.Other(event))
                return Outcome.None
            }
            "error" -> {
                errorText = event["errorText"]?.stringValue ?: "Unknown error"
                return Outcome.Error
            }
            "finish" -> {
                event["messageMetadata"]?.let { message = message.copy(metadata = it) }
                finishStreamingParts()
                return Outcome.Finished
            }
            "abort" -> {
                finishStreamingParts()
                abortReason = event["reason"]?.stringValue
                return Outcome.Aborted
            }
            else -> {
                if (type.startsWith("data-")) {
                    val name = type.removePrefix("data-")
                    val id = event["id"]?.stringValue
                    val data = event["data"] ?: JsonValue.Null
                    val existing = message.parts.indexOfFirst { it is ChatPart.Data && it.id == id && id != null }
                    message = if (existing >= 0) {
                        replacePart(existing, ChatPart.Data(name, id, data))
                    } else if (event["transient"]?.boolValue != true) {
                        message.copy(parts = message.parts + ChatPart.Data(name, id, data))
                    } else {
                        message
                    }
                }
                return Outcome.None
            }
        }
    }

    fun finishStreamingParts() {
        message = message.copy(
            parts = message.parts.map { part ->
                when {
                    part is ChatPart.Text && part.state == ChatPart.StreamState.Streaming ->
                        part.copy(state = ChatPart.StreamState.Done)
                    part is ChatPart.Reasoning && part.state == ChatPart.StreamState.Streaming ->
                        part.copy(state = ChatPart.StreamState.Done, endedAt = part.endedAt ?: Instant.now())
                    else -> part
                }
            },
        )
    }

    private enum class Kind { Text, Reasoning, Tool }

    private fun closeOpenParts(except: Kind) {
        message = message.copy(
            parts = message.parts.map { part ->
                when {
                    part is ChatPart.Text && part.state == ChatPart.StreamState.Streaming && except != Kind.Text ->
                        part.copy(state = ChatPart.StreamState.Done)
                    part is ChatPart.Reasoning && part.state == ChatPart.StreamState.Streaming && except != Kind.Reasoning ->
                        part.copy(state = ChatPart.StreamState.Done, endedAt = part.endedAt ?: Instant.now())
                    else -> part
                }
            },
        )
    }

    private fun hasTool(callId: String) = message.parts.any { it is ChatPart.Tool && it.toolCallId == callId }

    private fun textIndex(id: String?): Int? {
        if (id != null) {
            val i = message.parts.indexOfLast { it is ChatPart.Text && it.id == id }
            if (i >= 0) return i
        }
        val i = message.parts.indexOfLast { it is ChatPart.Text && it.state == ChatPart.StreamState.Streaming }
        return i.takeIf { it >= 0 }
    }

    private fun reasoningIndex(id: String?): Int? {
        if (id != null) {
            val i = message.parts.indexOfLast { it is ChatPart.Reasoning && it.id == id }
            if (i >= 0) return i
        }
        val i = message.parts.indexOfLast { it is ChatPart.Reasoning && it.state == ChatPart.StreamState.Streaming }
        return i.takeIf { it >= 0 }
    }

    private fun updateTool(callId: String, change: (ChatPart.Tool) -> ChatPart.Tool) {
        val i = message.parts.indexOfFirst { it is ChatPart.Tool && it.toolCallId == callId }
        message = if (i >= 0) {
            replacePart(i, change(message.parts[i] as ChatPart.Tool))
        } else {
            val part = change(ChatPart.Tool(toolCallId = callId, toolName = "tool", isDynamic = false, state = ChatPart.Tool.State.InputStreaming))
            message.copy(parts = message.parts + part)
        }
    }

    private fun replacePart(index: Int, part: ChatPart): ChatMessage {
        val next = message.parts.toMutableList()
        next[index] = part
        return message.copy(parts = next)
    }
}
