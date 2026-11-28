package ai.nuphos.android.model

import ai.nuphos.android.data.JsonValue

/**
 * What `render_artifact` and `render_chart` made, shown as a card in the chat as on the
 * desktop. A call that errored or whose payload does not parse stays a tool row.
 */
sealed class ToolCard {
    abstract val id: String

    data class Artifact(override val id: String, val title: String, val kind: String, val content: String) : ToolCard()

    data class Chart(
        override val id: String,
        val type: String,
        val title: String,
        val description: String?,
        val xKey: String,
        val series: List<Pair<String, String>>,
        val rows: List<Map<String, JsonValue>>,
    ) : ToolCard()

    companion object {
        fun from(part: ChatPart.Tool): ToolCard? {
            if (part.state == ChatPart.Tool.State.OutputError) return null
            return when (part.toolName) {
                "render_artifact" -> {
                    val input = part.input ?: return null
                    Artifact(part.toolCallId, input["title"]?.stringValue ?: return null,
                        input["kind"]?.stringValue ?: return null, input["content"]?.stringValue ?: return null)
                }
                "render_chart" -> {
                    // The tool echoes its validated input, so a chart draws before its result lands.
                    val payload = listOfNotNull(part.output, part.input).firstOrNull { it["xKey"]?.stringValue != null } ?: return null
                    val series = payload["series"]?.arrayValue.orEmpty().mapNotNull { entry ->
                        entry["key"]?.stringValue?.let { key -> key to (entry["label"]?.stringValue ?: key) }
                    }
                    val rows = payload["data"]?.arrayValue.orEmpty().mapNotNull { it.objectValue }
                    if (series.isEmpty() || rows.isEmpty()) return null
                    Chart(part.toolCallId, payload["type"]?.stringValue ?: return null, payload["title"]?.stringValue ?: return null,
                        payload["description"]?.stringValue, payload["xKey"]?.stringValue ?: return null, series, rows)
                }
                else -> null
            }
        }
    }
}
