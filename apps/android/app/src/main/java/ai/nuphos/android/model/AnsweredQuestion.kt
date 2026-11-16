package ai.nuphos.android.model

import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.session.BotQuestion
import java.time.Instant

/**
 * A question someone answered, as the transcript shows it to people: who answered what, and the
 * question as it was asked. It is read back from the notice the server wakes the asking agent with
 * (`answerNotice`), whose own text is written for the agent and is never shown.
 */
data class AnsweredQuestion(
    val name: String,
    val question: String,
    val answer: String,
    val body: String? = null,
    val options: List<String> = emptyList(),
    val asked: Instant? = null,
    val answered: Instant? = null,
    /** While its answer has not reached the agent: what it waits for, phrased by the backend. */
    val waiting: String? = null,
) {
    /** The options the answer picked: none when it was typed instead. Several picks arrive joined by ", ". */
    val picked: List<String> get() {
        var rest = answer
        val taken = mutableSetOf<String>()
        // Longest first, so an option that contains another is not half taken.
        for (option in options.sortedByDescending { it.length }) {
            if (option.isEmpty() || option !in rest) continue
            rest = rest.replaceFirst(option, "")
            taken += option
        }
        return if (rest.replace(", ", "").isEmpty()) options.filter { it in taken } else emptyList()
    }

    /** The notice's text, read back into its fields. */
    internal data class Notice(
        val requestId: String,
        val name: String,
        val question: String,
        val body: String?,
        val options: List<String>,
        val answers: List<Pair<String, String>>,
    ) {
        companion object {
            private val contexts = listOf("Context you gave: ", "Context the asker gave: ")

            fun parse(text: String): Notice? {
                val lines = text.split("\n")
                // The asker's context may hold an "Answer:" line of its own; the notice's comes last.
                val answerAt = lines.lastIndexOf("Answer:")
                if (answerAt < 3 || !lines[2].startsWith("Question: ")) return null
                val requestId = Regex("""\(requestId ([^)\s]+)\)""").find(lines[0])?.groupValues?.get(1) ?: return null
                // `Answered by: "Sam", this conversation's owner…`: the name is a JSON string.
                val name = Regex("""^Answered by: ("(?:[^"\\]|\\.)*")""").find(lines[1])
                    ?.let { JsonValue.parse(it.groupValues[1])?.stringValue } ?: return null
                val head = lines.subList(2, answerAt).toMutableList()
                val options = head.last().takeIf { it.startsWith("Options: ") }
                    ?.also { head.removeAt(head.lastIndex) }?.removePrefix("Options: ")?.split(" | ").orEmpty()
                val contextAt = head.indexOfFirst { line -> contexts.any(line::startsWith) }.takeIf { it >= 0 }
                val question = head.take(contextAt ?: head.size).joinToString("\n").removePrefix("Question: ")
                val body = contextAt?.let { at ->
                    head.drop(at).joinToString("\n").let { joined -> joined.removePrefix(contexts.first(joined::startsWith)) }
                }
                // After the answers: the ids the question is about, then what the agent does next.
                val tail = lines.subList(answerAt + 1, lines.size).dropLast(1).toMutableList()
                if (tail.lastOrNull()?.startsWith("About: ") == true) tail.removeAt(tail.lastIndex)
                // "- Which regions? → us, eu"; a typed answer's later lines stay with it.
                val single = "- $question → "
                val whole = tail.joinToString("\n")
                val answers = mutableListOf<Pair<String, String>>()
                if (whole.startsWith(single)) answers += question to whole.removePrefix(single)
                else for (line in tail) {
                    val arrow = line.lastIndexOf(" → ")
                    if (line.startsWith("- ") && arrow > 0) answers += line.substring(2, arrow) to line.substring(arrow + 3)
                    else if (answers.isNotEmpty()) answers[answers.lastIndex] = answers.last().let { it.first to "${it.second}\n$line" }
                    else return null
                }
                return if (answers.isEmpty()) null else Notice(requestId, name, question, body, options, answers)
            }
        }
    }

    companion object {
        /** The sender of the notice. */
        const val SENDER = "nuphos:decision"

        /**
         * The questions a notice answers, one per question of its card; null for any other message.
         * The card, when this conversation asked it, gives the whole body, each question's options
         * and when it was asked: the notice only excerpts them.
         */
        fun all(message: ChatMessage, text: String, messages: List<ChatMessage>): List<AnsweredQuestion>? {
            val notice = Notice.parse(text.trim()) ?: return null
            val asked = messages.lastOrNull { candidate -> candidate.role == ChatMessage.Role.Assistant && candidate.card(notice.requestId) != null }
            val input = asked?.card(notice.requestId)?.input
            val questions = input?.get("questions")?.arrayValue.orEmpty().mapNotNull { item ->
                item["question"]?.stringValue?.let { question ->
                    DecisionQuestion(question, item["options"]?.arrayValue?.mapNotNull { it.stringValue }, item["multiSelect"]?.boolValue)
                }
            }
            val body = if (input == null) notice.body else BotQuestion(
                "", "", InputRequest(notice.requestId, body = input["body"]?.stringValue, questions = questions),
            ).ownBody
            val options = input?.get("options")?.arrayValue?.mapNotNull { it.stringValue }
            return notice.answers.mapIndexed { index, (question, answer) ->
                AnsweredQuestion(notice.name, question, answer, body,
                    questions.getOrNull(index)?.options ?: options ?: notice.options, asked?.createdAt, message.createdAt)
            }
        }

        private fun ChatMessage.card(requestId: String) = parts.filterIsInstance<ChatPart.Tool>()
            .lastOrNull { it.toolName == "request_user_decision" && it.decisionRequestId == requestId }
    }
}
