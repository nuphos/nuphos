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
    /** Block quote and list markers a fence can follow on its line, as in `- ~~~`. */
    private val container = Regex("""^(?:>\s?|[-*+]\s+|\d{1,9}[.)]\s+)*""")

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
        fun flush() {
            val markdown = lines.joinToString("\n")
            if (markdown.isNotBlank()) segments += Segment.Text(markdown)
            lines.clear()
        }
        for (line in text.split("\n")) {
            val trimmed = line.trim()
            val shallow = indent(line) < 4
            val body = container.replace(trimmed, "")
            val run = if (shallow) fenceRun.find(body)?.value else null
            val open = fence
            if (open != null) {
                // A fence closes only on a bare run of its own character at least as long as the one that opened it.
                if (run != null && run[0] == open[0] && run.length >= open.length && body.length == run.length) fence = null
            } else if (run != null && !(run[0] == '`' && body.drop(run.length).contains('`'))) {
                fence = run
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
