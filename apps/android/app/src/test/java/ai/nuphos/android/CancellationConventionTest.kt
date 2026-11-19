package ai.nuphos.android

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * #3640: a cancelled coroutine is never shown as an error. Every `catch (e: Exception)` that uses
 * `e` lets cancellation through first: it rethrows it, rethrows `e`, or follows a
 * `catch (… CancellationException)` of the same `try`.
 */
class CancellationConventionTest {
    /** Not coroutine code: OkHttp's callback thread hands the failure on to the event flow. */
    private val outsideCoroutines = setOf("data/SseClient.kt")

    private val catchAll = Regex("""catch \((\w+): Exception\)\s*\{""")
    private val catchCancellation = Regex("""catch \(\w+: (kotlinx\.coroutines\.)?CancellationException\)""")

    @Test fun everyCatchAllLetsCancellationThrough() {
        val root = File("src/main/java/ai/nuphos/android")
        val found = root.walk().filter { it.extension == "kt" }.flatMap { file ->
            val path = file.relativeTo(root).invariantSeparatorsPath
            val text = file.readText()
            catchAll.findAll(text).filter { path !in outsideCoroutines && swallows(text, it) }
                .map { "$path:${text.take(it.range.first).count { c -> c == '\n' } + 1}" }
        }.sorted().toList()
        assertEquals("Catch-alls that can show or swallow a cancelled coroutine", emptyList<String>(), found)
    }

    private fun swallows(text: String, match: MatchResult): Boolean {
        val name = match.groupValues[1]
        if (name == "_") return false
        var end = match.range.last + 1
        var depth = 1
        while (depth > 0 && end < text.length) {
            when (text[end]) { '{' -> depth++; '}' -> depth-- }
            end++
        }
        val body = text.substring(match.range.last + 1, end - 1)
        if (!Regex("""\b$name\b""").containsMatchIn(body)) return false
        if ("CancellationException" in body || "rethrowCancellation" in body || Regex("""\bthrow\b""").containsMatchIn(body)) return false
        val head = text.take(match.range.first)
        val clauses = head.substring(maxOf(head.lastIndexOf("try {"), head.lastIndexOf("try{"), 0))
        return !catchCancellation.containsMatchIn(clauses)
    }
}
