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

    private val citation = Regex("""!\[[^\]\n]*]\(https://nuphos\.ai/_reply-images/([0-9a-fA-F]{24})\)""")

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
            val trimmed = line.trimStart(' ')
            val open = fence
            if (open != null) {
                if (trimmed.startsWith(open)) fence = null
            } else if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
                fence = trimmed.take(3)
            } else if (line.length - trimmed.length < 4 && citation.containsMatchIn(trimmed) && citation.replace(trimmed, "").isBlank()) {
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
