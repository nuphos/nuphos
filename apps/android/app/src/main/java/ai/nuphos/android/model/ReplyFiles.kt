package ai.nuphos.android.model

/**
 * An agent cites a file it sent as `![caption](https://nuphos.ai/_reply-images/<groupId>)`. Coil cannot load
 * it without the viewer's access, so a line that holds only such citations is shown as the group's files,
 * the way Desktop's `ReplyImage` and iOS's `MarkdownImages.replyGroupId` show it. Any other text stays Markdown.
 */
object ReplyFiles {
    sealed interface Segment {
        data class Text(val text: String) : Segment
        data class Files(val groupId: String) : Segment
    }

    // Lowercase hex only, as Desktop's `MessageResponse` matches it.
    private val citation = Regex("""!\[[^\]\n]*]\(https://nuphos\.ai/_reply-images/([0-9a-f]{24})\)""")
    private val fenceRun = Regex("""^(`{3,}|~{3,})""")
    /** Block quote markers, then list markers, that a fence can follow on its line, as in `> - ~~~`. */
    private val quote = Regex("""^(?:[ \t]*>[ \t]?)*""")
    private val item = Regex("""^(?:[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)*""")

    /** Leading columns, a tab reaching the next multiple of four as in CommonMark. Four or more is a code block. */
    private fun indent(line: String): Int {
        var column = 0
        for (c in line) column = when (c) { ' ' -> column + 1; '\t' -> column / 4 * 4 + 4; else -> return column }
        return column
    }

    fun segments(text: String): List<Segment> {
        if (!text.contains("_reply-images/")) return listOf(Segment.Text(text))
        val segments = mutableListOf<Segment>()
        val lines = mutableListOf<String>()
        var fence: String? = null
        // The block quote depth and list item content column the open fence belongs to, and the current list item's.
        var fenceDepth = 0
        var fenceColumn = 0
        var column = 0
        fun flush() {
            val markdown = lines.joinToString("\n")
            if (markdown.isNotBlank()) segments += Segment.Text(markdown)
            lines.clear()
        }
        for (line in text.split("\n")) {
            val trimmed = line.trim()
            val shallow = indent(line) < 4
            val quoted = quote.find(line)!!.value
            val depth = quoted.count { it == '>' }
            val inner = line.substring(quoted.length)
            val marker = item.find(inner)!!.value
            val body = inner.substring(marker.length).trim()
            // A fence also ends with the block quote or list item it opened in.
            if (fence != null && (depth < fenceDepth || (inner.isNotBlank() && indent(inner) < fenceColumn))) fence = null
            if (fence == null) column = when {
                marker.isNotEmpty() -> marker.length
                inner.isNotBlank() && indent(inner) < column -> 0
                else -> column
            }
            val run = if (shallow) fenceRun.find(body)?.value else null
            val open = fence
            if (open != null) {
                // A fence closes only on a bare run of its own character at least as long as the one that opened it.
                if (run != null && run[0] == open[0] && run.length >= open.length && body.length == run.length) fence = null
            } else if (run != null && !(run[0] == '`' && body.drop(run.length).contains('`'))) {
                fence = run
                fenceDepth = depth
                fenceColumn = column
            } else if (shallow && citation.containsMatchIn(trimmed) && citation.replace(trimmed, "").isBlank()) {
                flush()
                segments += citation.findAll(trimmed).map { Segment.Files(it.groupValues[1]) }
                continue
            }
            lines += line
        }
        flush()
        return segments.ifEmpty { listOf(Segment.Text(text)) }
    }

    /** The groups `text` shows where it cites them, so they are not shown again as a card below the reply. */
    fun cited(text: String): Set<String> = segments(text).mapNotNullTo(mutableSetOf()) { (it as? Segment.Files)?.groupId }
}
