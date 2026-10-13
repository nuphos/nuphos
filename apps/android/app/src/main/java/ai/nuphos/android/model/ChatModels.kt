package ai.nuphos.android.model

import ai.nuphos.android.data.Instants
import ai.nuphos.android.data.JsonValue
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import java.time.Instant
import java.util.UUID

@Serializable(with = ChatMessageSerializer::class)
data class ChatMessage(
    val id: String = UUID.randomUUID().toString().lowercase(),
    val role: Role = Role.Assistant,
    val parts: List<ChatPart> = emptyList(),
    val createdAt: Instant? = Instant.now(),
    val metadata: JsonValue? = null,
    val turnOrigin: String? = null,
    val stoppedByUser: Boolean? = null,
    val feedback: String? = null,
) {
    enum class Role(val raw: String) {
        User("user"), Assistant("assistant"), System("system");

        companion object {
            fun from(raw: String?) = entries.firstOrNull { it.raw == raw } ?: Assistant
        }
    }

    val text: String
        get() = parts.mapNotNull { (it as? ChatPart.Text)?.text }.joinToString("")

    val wireParts: List<ChatPart>
        get() = parts.filter { part ->
            when (part) {
                is ChatPart.Reasoning -> false
                is ChatPart.Other -> {
                    val t = part.value["type"]?.stringValue.orEmpty()
                    t !in setOf("memory-ingest", "memory-provenance", "transfer-download")
                }
                else -> true
            }
        }

    val forWire: ChatMessage get() = copy(parts = wireParts)

    val hasRenderableContent: Boolean
        get() = parts.any { part ->
            when (part) {
                is ChatPart.Text -> part.text.isNotEmpty()
                is ChatPart.Reasoning -> part.text.isNotEmpty()
                is ChatPart.Tool -> true
                else -> false
            }
        }

    fun finalizeIncompleteTools(errorText: String = "Interrupted before the tool finished."): ChatMessage {
        val now = Instant.now().toEpochMilli().toDouble()
        return copy(
            parts = parts.map { part ->
                if (part is ChatPart.Tool &&
                    (part.state == ChatPart.Tool.State.InputStreaming || part.state == ChatPart.Tool.State.InputAvailable)
                ) {
                    part.copy(state = ChatPart.Tool.State.OutputError, errorText = errorText, completedAt = now)
                } else part
            },
        )
    }

    fun supersedePendingApprovals(): ChatMessage = copy(
        parts = parts.map { part ->
            if (part is ChatPart.Tool && part.state == ChatPart.Tool.State.ApprovalRequested) {
                part.copy(
                    state = ChatPart.Tool.State.ApprovalResponded,
                    approval = part.approval?.copy(approved = false),
                )
            } else part
        },
    )

    companion object {
        fun user(text: String) = ChatMessage(
            role = Role.User,
            parts = listOf(ChatPart.Text(text = text, state = ChatPart.StreamState.Done)),
        )
    }
}

object ChatMessageSerializer : KSerializer<ChatMessage> {
    override val descriptor: SerialDescriptor = JsonValue.serializer().descriptor

    override fun serialize(encoder: Encoder, value: ChatMessage) {
        val o = mutableMapOf<String, JsonValue>(
            "id" to JsonValue.Str(value.id),
            "role" to JsonValue.Str(value.role.raw),
            "parts" to JsonValue.Arr(value.parts.map { it.json }),
        )
        value.createdAt?.let { o["createdAt"] = JsonValue.Str(it.toString()) }
        value.metadata?.let { o["metadata"] = it }
        value.turnOrigin?.let { o["turnOrigin"] = JsonValue.Str(it) }
        value.stoppedByUser?.let { o["stoppedByUser"] = JsonValue.Bool(it) }
        value.feedback?.let { o["feedback"] = JsonValue.Str(it) }
        encoder.encodeSerializableValue(JsonValue.serializer(), JsonValue.Obj(o))
    }

    override fun deserialize(decoder: Decoder): ChatMessage {
        val json = decoder.decodeSerializableValue(JsonValue.serializer())
        val role = ChatMessage.Role.from(json["role"]?.stringValue)
        return ChatMessage(
            id = json["id"]?.stringValue ?: UUID.randomUUID().toString().lowercase(),
            role = role,
            parts = json["parts"]?.arrayValue?.map { ChatPart.from(it) } ?: emptyList(),
            createdAt = Instants.parse(json["createdAt"]?.stringValue),
            metadata = json["metadata"],
            turnOrigin = json["turnOrigin"]?.stringValue,
            stoppedByUser = json["stoppedByUser"]?.boolValue,
            feedback = json["feedback"]?.stringValue,
        )
    }
}

@Serializable(with = ChatPartSerializer::class)
sealed class ChatPart {
    enum class StreamState(val raw: String) {
        Streaming("streaming"), Done("done");

        companion object {
            fun from(raw: String?) = entries.firstOrNull { it.raw == raw }
        }
    }

    data class Text(
        val id: String? = null,
        val text: String,
        val state: StreamState? = null,
        val providerMetadata: JsonValue? = null,
    ) : ChatPart()

    data class Reasoning(
        val id: String? = null,
        val text: String,
        val state: StreamState? = null,
        val providerMetadata: JsonValue? = null,
        val startedAt: Instant? = null,
        val endedAt: Instant? = null,
    ) : ChatPart()

    data class Tool(
        val toolCallId: String,
        val toolName: String,
        val isDynamic: Boolean,
        val state: State,
        val input: JsonValue? = null,
        val inputText: String = "",
        val output: JsonValue? = null,
        val errorText: String? = null,
        val providerExecuted: Boolean? = null,
        val approval: Approval? = null,
        val callProviderMetadata: JsonValue? = null,
        val title: String? = null,
        val authorization: JsonValue? = null,
        val startedAt: Double? = null,
        val completedAt: Double? = null,
    ) : ChatPart() {
        enum class State(val raw: String) {
            InputStreaming("input-streaming"),
            InputAvailable("input-available"),
            ApprovalRequested("approval-requested"),
            ApprovalResponded("approval-responded"),
            OutputAvailable("output-available"),
            OutputError("output-error"),
            OutputDenied("output-denied");

            companion object {
                fun from(raw: String?) = entries.firstOrNull { it.raw == raw } ?: InputAvailable
            }
        }

        data class Approval(
            val id: String,
            val signature: String? = null,
            val approved: Boolean? = null,
            val reason: String? = null,
            val source: String? = null,
        )

        enum class Kind { Terminal, Read, Write, Edit, Search, Fetch, Todos, Question, Task, Plan, Skill, Memory, Chart, Generic }

        @Transient
        val displayLabel: String
            get() {
                title?.takeIf { it.isNotEmpty() }?.let { return it }
                val keys = listOf("label", "title", "description", "name", "query", "url", "path", "filePath", "file_path", "pattern", "command")
                for (key in keys) {
                    val v = input?.get(key)?.stringValue
                    if (!v.isNullOrEmpty()) return v
                }
                return toolName
            }

        @Transient
        val kind: Kind
            get() {
                val lower = toolName.lowercase()
                if (lower in setOf("plan_create", "database_change_propose")) return Kind.Plan
                if (lower == "save_memory" || lower == "memory_get") return Kind.Memory
                if (lower == "render_chart") return Kind.Chart
                if (lower.startsWith("load skill") || lower == "skill") return Kind.Skill
                val input = input ?: return if (lower == "terminal") Kind.Terminal else Kind.Generic
                if (input["command"]?.stringValue != null) return Kind.Terminal
                if (input["file_path"]?.stringValue != null) {
                    return when {
                        input["content"] != null -> Kind.Write
                        input["old_string"] != null || input["new_string"] != null -> Kind.Edit
                        else -> Kind.Read
                    }
                }
                if (input["pattern"]?.stringValue != null) return Kind.Search
                if (input["url"]?.stringValue != null) return Kind.Fetch
                if (input["todos"]?.arrayValue != null) return Kind.Todos
                if (input["questions"]?.arrayValue != null || lower == "request_user_decision") return Kind.Question
                if (input["plan"]?.stringValue != null) return Kind.Plan
                if (input["prompt"]?.stringValue != null && input["description"]?.stringValue != null) return Kind.Task
                if (input["query"]?.stringValue != null) return Kind.Search
                return Kind.Generic
            }

        val kindLabel: String
            get() = when (kind) {
                Kind.Terminal -> "Terminal"
                Kind.Read -> "Read file"
                Kind.Write -> "Write file"
                Kind.Edit -> "Edit file"
                Kind.Search -> "Search"
                Kind.Fetch -> "Fetch"
                Kind.Todos -> "To-dos"
                Kind.Question -> "Question"
                Kind.Task -> "Subtask"
                Kind.Plan -> "Plan"
                Kind.Skill -> "Skill"
                Kind.Memory -> "Memory"
                Kind.Chart -> "Chart"
                Kind.Generic -> if (toolName.length > 40) "Tool" else toolName
            }

        val isClientOnlyTool: Boolean get() = toolName in CLIENT_ONLY
        val command: String? get() = input?.get("command")?.stringValue
        val isFinished: Boolean
            get() = state in setOf(State.OutputAvailable, State.OutputError, State.OutputDenied)

        companion object {
            val CLIENT_ONLY = setOf(
                "local_exec", "port_forward_start", "port_forward_stop", "port_forward_list", "upload_attachment",
            )
        }
    }

    data class Data(val name: String, val id: String? = null, val data: JsonValue) : ChatPart()
    data class File(val mediaType: String, val filename: String? = null, val url: String) : ChatPart()
    data class SourceUrl(val sourceId: String, val url: String, val title: String? = null) : ChatPart()
    data object StepStart : ChatPart()
    data class Other(val value: JsonValue) : ChatPart()

    val json: JsonValue
        get() = when (this) {
            is Text -> JsonValue.Obj(buildMap {
                put("type", JsonValue.Str("text"))
                put("text", JsonValue.Str(text))
                state?.let { put("state", JsonValue.Str(it.raw)) }
                providerMetadata?.let { put("providerMetadata", it) }
            })
            is Reasoning -> JsonValue.Obj(buildMap {
                put("type", JsonValue.Str("reasoning"))
                put("text", JsonValue.Str(text))
                state?.let { put("state", JsonValue.Str(it.raw)) }
                providerMetadata?.let { put("providerMetadata", it) }
            })
            StepStart -> JsonValue.obj("type" to JsonValue.Str("step-start"))
            is File -> JsonValue.Obj(buildMap {
                put("type", JsonValue.Str("file"))
                put("mediaType", JsonValue.Str(mediaType))
                put("url", JsonValue.Str(url))
                filename?.let { put("filename", JsonValue.Str(it)) }
            })
            is SourceUrl -> JsonValue.Obj(buildMap {
                put("type", JsonValue.Str("source-url"))
                put("sourceId", JsonValue.Str(sourceId))
                put("url", JsonValue.Str(url))
                title?.let { put("title", JsonValue.Str(it)) }
            })
            is Data -> JsonValue.Obj(buildMap {
                put("type", JsonValue.Str("data-$name"))
                put("data", data)
                id?.let { put("id", JsonValue.Str(it)) }
            })
            is Tool -> JsonValue.Obj(buildMap {
                put("type", JsonValue.Str(if (isDynamic) "dynamic-tool" else "tool-$toolName"))
                put("toolCallId", JsonValue.Str(toolCallId))
                put("state", JsonValue.Str(state.raw))
                if (isDynamic) put("toolName", JsonValue.Str(toolName))
                input?.let { put("input", it) }
                output?.let { put("output", it) }
                errorText?.let { put("errorText", JsonValue.Str(it)) }
                providerExecuted?.let { put("providerExecuted", JsonValue.Bool(it)) }
                callProviderMetadata?.let { put("callProviderMetadata", it) }
                title?.let { put("title", JsonValue.Str(it)) }
                approval?.let { a ->
                    put(
                        "approval",
                        JsonValue.Obj(buildMap {
                            put("id", JsonValue.Str(a.id))
                            a.signature?.let { put("signature", JsonValue.Str(it)) }
                            a.approved?.let { put("approved", JsonValue.Bool(it)) }
                            a.reason?.let { put("reason", JsonValue.Str(it)) }
                            a.source?.let { put("source", JsonValue.Str(it)) }
                        }),
                    )
                }
                authorization?.let { put("authorization", it) }
                startedAt?.let { put("startedAt", JsonValue.Number(it)) }
                completedAt?.let { put("completedAt", JsonValue.Number(it)) }
            })
            is Other -> value
        }

    companion object {
        fun from(json: JsonValue): ChatPart {
            val type = json["type"]?.stringValue ?: return Other(json)
            return when (type) {
                "text" -> Text(
                    id = json["id"]?.stringValue,
                    text = json["text"]?.stringValue.orEmpty(),
                    state = StreamState.from(json["state"]?.stringValue),
                    providerMetadata = json["providerMetadata"],
                )
                "reasoning" -> Reasoning(
                    id = json["id"]?.stringValue,
                    text = json["text"]?.stringValue.orEmpty(),
                    state = StreamState.from(json["state"]?.stringValue),
                    providerMetadata = json["providerMetadata"],
                )
                "step-start" -> StepStart
                "file" -> File(
                    mediaType = json["mediaType"]?.stringValue.orEmpty(),
                    filename = json["filename"]?.stringValue,
                    url = json["url"]?.stringValue.orEmpty(),
                )
                "source-url" -> SourceUrl(
                    sourceId = json["sourceId"]?.stringValue.orEmpty(),
                    url = json["url"]?.stringValue.orEmpty(),
                    title = json["title"]?.stringValue,
                )
                "dynamic-tool" -> toolPart(json, json["toolName"]?.stringValue ?: "tool", dynamic = true)
                "tool" -> toolPart(json, json["toolName"]?.stringValue ?: "tool", dynamic = false)
                else -> when {
                    type.startsWith("tool-") -> toolPart(json, type.removePrefix("tool-"), dynamic = false)
                    type.startsWith("data-") -> Data(
                        name = type.removePrefix("data-"),
                        id = json["id"]?.stringValue,
                        data = json["data"] ?: JsonValue.Null,
                    )
                    else -> Other(json)
                }
            }
        }

        private fun toolPart(json: JsonValue, name: String, dynamic: Boolean): Tool {
            val approvalJson = json["approval"]
            val approval = approvalJson?.get("id")?.stringValue?.let { id ->
                Tool.Approval(
                    id = id,
                    signature = approvalJson["signature"]?.stringValue,
                    approved = approvalJson["approved"]?.boolValue,
                    reason = approvalJson["reason"]?.stringValue,
                    source = approvalJson["source"]?.stringValue,
                )
            }
            var state = Tool.State.from(json["state"]?.stringValue)
            if (json["state"] == null && json["output"] != null) state = Tool.State.OutputAvailable
            return Tool(
                toolCallId = json["toolCallId"]?.stringValue.orEmpty(),
                toolName = name,
                isDynamic = dynamic,
                state = state,
                input = json["input"],
                output = json["output"],
                errorText = json["errorText"]?.stringValue,
                providerExecuted = json["providerExecuted"]?.boolValue,
                approval = approval,
                callProviderMetadata = json["callProviderMetadata"],
                title = json["title"]?.stringValue,
                authorization = json["authorization"],
                startedAt = json["startedAt"]?.numberValue,
                completedAt = json["completedAt"]?.numberValue,
            )
        }
    }
}

object ChatPartSerializer : KSerializer<ChatPart> {
    override val descriptor: SerialDescriptor = JsonValue.serializer().descriptor
    override fun serialize(encoder: Encoder, value: ChatPart) =
        encoder.encodeSerializableValue(JsonValue.serializer(), value.json)
    override fun deserialize(decoder: Decoder): ChatPart =
        ChatPart.from(decoder.decodeSerializableValue(JsonValue.serializer()))
}

data class ComposerAttachment(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val kind: Kind,
) {
    sealed class Kind {
        data class Image(val jpeg: ByteArray) : Kind() {
            override fun equals(other: Any?) = other is Image && jpeg.contentEquals(other.jpeg)
            override fun hashCode() = jpeg.contentHashCode()
        }
        data class File(val bytes: ByteArray, val mime: String) : Kind() {
            override fun equals(other: Any?) = other is File && bytes.contentEquals(other.bytes)
            override fun hashCode() = bytes.contentHashCode()
        }
        data class RetainedFile(val source: ai.nuphos.android.data.OwnedAttachmentFile, val mime: String) : Kind()
    }

    val sizeBytes: Long get() = when (val value = kind) {
        is Kind.Image -> value.jpeg.size.toLong()
        is Kind.File -> value.bytes.size.toLong()
        is Kind.RetainedFile -> value.source.size
    }

    fun releaseOwnedCopy() { (kind as? Kind.RetainedFile)?.source?.release() }

    val isImage: Boolean get() = kind is Kind.Image

    val dataUrl: String?
        get() = (kind as? Kind.Image)?.let {
            "data:image/jpeg;base64," + android.util.Base64.encodeToString(it.jpeg, android.util.Base64.NO_WRAP)
        }

    val fileExtension: String
        get() = when (kind) {
            is Kind.File, is Kind.RetainedFile -> name.substringAfterLast('.', "FILE").uppercase()
            is Kind.Image -> "JPG"
        }
}

data class ComposerSubmission(
    val text: String,
    val attachments: List<ComposerAttachment> = emptyList(),
)
