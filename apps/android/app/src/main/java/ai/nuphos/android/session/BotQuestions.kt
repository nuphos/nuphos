package ai.nuphos.android.session

import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.ChatPart
import ai.nuphos.android.model.DecisionQuestion
import ai.nuphos.android.model.InputRequest

/** An open question a Bot's chat shows: one request and the conversation that asked it. */
data class BotQuestion(
    val sessionId: String,
    val title: String,
    val request: InputRequest,
    val sourceBot: AgentConversation? = null,
) {
    val sourceId: String get() = sourceBot?.sessionId ?: sessionId
    val sourceTitle: String get() = sourceBot?.displayTitle ?: title
    val id: String get() = "$sessionId:${request.id}"

    /** The conversation that asked, opened in the app like any Nuphos link. */
    fun link(teamId: String): String = "${ai.nuphos.android.data.NuphosWeb.SITE_URL}/teams/$teamId/agent/$sessionId"

    /**
     * Answered in words, "Other…": never a plan, approved or rejected, nor a credential or connection.
     * An integration question naming nothing to select, e.g. a service Nuphos cannot connect, takes words.
     */
    val typed: Boolean get() = request.category != "credential" && !connectable && request.planId == null

    /**
     * The member's own credentials an integration question names, answered only by adding them to
     * `personalCredentialIds`; null unless every named credential is personal and no providers are mixed in.
     */
    val personalCredentials: List<String>? get() = request.credentials
        ?.takeIf { request.providers == null && it.isNotEmpty() && it.all { ref -> ref.provider == "personal" } }
        ?.map { it.id }

    /**
     * A secret request as its tool call carries it in the transcript, so the card draws the conversation's
     * `SecretCard`; null unless the question names a secret.
     */
    val secretPart: ChatPart.Tool? get() {
        val name = request.secretName ?: return null
        // A web form's details: every field and the site, as the agent's own call carries them.
        val fields = request.fields
        val site = request.site
        val form = if (fields == null || site == null) emptyList() else listOf(
            "fields" to JsonValue.Arr(fields.map { JsonValue.obj("name" to JsonValue.Str(it.name), "label" to JsonValue.Str(it.label)) }),
            "site" to JsonValue.Str(site),
        )
        return ChatPart.Tool(request.id, "request_user_decision", isDynamic = true, state = ChatPart.Tool.State.InputAvailable,
            input = JsonValue.obj("category" to JsonValue.Str(request.category.orEmpty()),
                "question" to JsonValue.Str(request.question), "secretName" to JsonValue.Str(name), *form.toTypedArray()))
            .takeIf { it.secretRequest != null }
    }

    /** An integration question the Inbox answers in place: by its providers, or by the member's own credentials. */
    val connectable: Boolean get() = request.category == "integration" &&
        (personalCredentials != null || (request.credentials == null && !request.providers.isNullOrEmpty()))

    /**
     * Desktop's `formQuestions`: the questions a multi-select or several-question card answers as a
     * form, sent as one answer; null for one single-choice question, which keeps its one-tap options.
     */
    val form: List<DecisionQuestion>? get() {
        if (!typed) return null
        request.questions?.takeIf { it.isNotEmpty() }?.let { return it }
        val options = request.options.orEmpty()
        return if (request.multiSelect == true && options.isNotEmpty())
            listOf(DecisionQuestion(request.question, options, multiSelect = true)) else null
    }

    /**
     * The body the agent wrote, without the list the backend writes after it for clients that do not
     * render `questions`: dropped only when the body ends with exactly that list, so a `---` of the
     * agent's own always stays.
     */
    val ownBody: String? get() {
        var body = request.body ?: return null
        val questions = request.questions
        if (!questions.isNullOrEmpty()) {
            val written = writtenQuestions(questions)
            if (body.endsWith(written)) body = body.dropLast(written.length)
        }
        return body.trim().ifEmpty { null }
    }

    companion object {
        /**
         * The backend's `writtenQuestions` (apps/backend/src/lib/agent/tools-skilled/decision-tools.ts): the
         * questions as markdown after a `---` separator, one line each. A change there needs the same change here.
         */
        fun writtenQuestions(questions: List<DecisionQuestion>): String {
            fun line(text: String) = text.split(Regex("\\s+")).filter { it.isNotEmpty() }.joinToString(" ")
            val list = questions.mapIndexed { index, item ->
                (listOf("**${index + 1}. ${line(item.question)}**" + if (item.multiSelect == true) " (any number)" else "") +
                    item.options.orEmpty().map { "- ${line(it)}" }).joinToString("\n")
            }
            return "\n\n---\n\n" + list.joinToString("\n\n")
        }

        /** One question's answer as it reads: what was typed, else the picked options. */
        fun answerText(picked: List<String>, typed: String): String =
            typed.trim().ifEmpty { picked.joinToString(", ") }

        /** Desktop's `formAnswer`: one question's picks or typed text, or one entry per question. */
        fun formAnswer(questions: List<DecisionQuestion>, picked: List<List<String>>, typed: List<String>): JsonValue {
            fun one(index: Int): JsonValue {
                val words = typed[index].trim()
                return if (words.isEmpty()) JsonValue.obj("choices" to JsonValue.Arr(picked[index].map { JsonValue.Str(it) }))
                else JsonValue.obj("text" to JsonValue.Str(words))
            }
            return if (questions.size == 1) one(0) else JsonValue.obj("questions" to JsonValue.Arr(questions.indices.map(::one)))
        }
    }
}

/**
 * The open questions in the pending listing, whose rows come with every parent above them: all of
 * them for the Inbox, or, as Desktop's `sessionInputRequests` for a Bot's chat (#1848), those of
 * the Bot and of every conversation under it, at any depth.
 */
object BotQuestions {
    /** The viewer's own questions under [bot], oldest first. */
    fun under(bot: String, rows: List<AgentConversation>): List<BotQuestion> {
        val parent = rows.distinctBy { it.sessionId }.associate { it.sessionId to it.parentSessionId }
        fun isUnder(sessionId: String): Boolean {
            val seen = mutableSetOf<String>()
            var current: String? = sessionId
            while (current != null && seen.add(current)) {
                if (current == bot) return true
                current = parent[current]
            }
            return false
        }
        return open(rows.filter { isUnder(it.sessionId) }, includeOnboarding = true)
    }

    /** The viewer's own open questions in [rows], oldest first: the Inbox's list. */
    fun open(rows: List<AgentConversation>): List<BotQuestion> = open(rows, includeOnboarding = false)

    private fun open(rows: List<AgentConversation>, includeOnboarding: Boolean): List<BotQuestion> {
        val conversations = rows.distinctBy { it.sessionId }.associateBy { it.sessionId }
        fun sourceBot(row: AgentConversation): AgentConversation? {
            val visited = mutableSetOf<String>()
            var current: AgentConversation? = row
            while (current != null && visited.add(current.sessionId)) {
                if (current.isBot) return current
                current = current.parentSessionId?.let(conversations::get)
                    ?.takeIf { it.teamId == row.teamId }
            }
            return null
        }

        return conversations.values
            .filter { it.isOwner == true }
            .flatMap { row ->
                val requests = row.inputRequests.orEmpty().filter {
                    includeOnboarding || row.botOnboarding !in setOf("pending", "active") || it.category != "preference"
                }
                val bot = if (requests.isEmpty()) null else sourceBot(row)
                requests.map { BotQuestion(row.sessionId, row.displayTitle, it, bot) }
            }
            .sortedWith(compareBy({ it.request.askedAt.orEmpty() }, { it.id }))
    }

    /** Newest groups first, oldest question first within each group. */
    fun grouped(questions: List<BotQuestion>): List<List<BotQuestion>> =
        questions.groupBy { it.sourceId }.values.sortedWith(
            compareByDescending<List<BotQuestion>> { it.last().request.askedAt.orEmpty() }
                .thenByDescending { it.first().sourceId },
        )
}
