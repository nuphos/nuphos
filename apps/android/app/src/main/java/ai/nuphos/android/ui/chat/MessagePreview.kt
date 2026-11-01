package ai.nuphos.android.ui.chat

/** Same disclosure policy as iOS: six lines / 280 characters, only when
 * at least 100 characters or three newlines would otherwise be hidden. */
internal object MessagePreview {
    fun head(text: String): String? {
        val points = text.codePoints().toArray()
        var head = String(points, 0, minOf(280, points.size)).split('\n').take(6).joinToString("\n")
        if (head.length < text.length && !text[head.length].isWhitespace()) {
            val space = head.indexOfLast { it.isWhitespace() }
            if (space >= 0 && head.length - space < 40) head = head.substring(0, space)
        }
        val hidden = text.substring(head.length)
        if (hidden.codePointCount(0, hidden.length) < 100 && hidden.count { it == '\n' } < 3) return null
        return head.trimEnd() + "…"
    }
}
