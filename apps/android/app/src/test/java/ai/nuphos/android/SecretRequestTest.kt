package ai.nuphos.android

import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.ChatMessage
import ai.nuphos.android.model.ChatPart
import ai.nuphos.android.model.ChatRow
import ai.nuphos.android.model.Words
import ai.nuphos.android.session.ChatSession
import ai.nuphos.android.model.AgentConversationDetail
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class SecretRequestTest {
    @Before fun setup() { Dispatchers.setMain(UnconfinedTestDispatcher()) }
    @After fun cleanup() { Dispatchers.resetMain() }

    // Some runtimes name the call by its display title, so detection reads the input only.
    private fun ask(input: String, output: String? = null, id: String = "ask") = ChatPart.Tool(
        toolCallId = id,
        toolName = "Open a secure input for the OpenAI key",
        isDynamic = false,
        state = ChatPart.Tool.State.OutputAvailable,
        input = JsonValue.parse(input),
        output = output?.let { JsonValue.parse(it) },
    )

    private val secret = ask(
        """{"category":"credential","secretName":"OPENAI_API_KEY","question":"Paste your key"}""",
        """{"requestId":"req-1"}""",
    )

    @Test fun detectsASecretRequestByItsInput() {
        assertEquals(ChatPart.Tool.SecretRequest("OPENAI_API_KEY", "Paste your key"), secret.secretRequest)
        assertEquals("req-1", secret.decisionRequestId)
        assertEquals(ChatPart.Tool.Kind.Question, secret.kind)
        assertEquals("ask", ask("""{"category":"credential","secretName":"KEY"}""").decisionRequestId)
        assertEquals("", ask("""{"category":"credential","secretName":"KEY"}""").secretRequest?.reason)
    }

    @Test fun rejectsOtherCategoriesAndNamesTheBackendRefuses() {
        assertNull(ask("""{"category":"credential","secretName":"1BAD"}""").secretRequest)
        assertNull(ask("""{"category":"credential","secretName":"CLÉ"}""").secretRequest)
        assertNull(ask("""{"category":"credential","secretName":"${"A".repeat(65)}"}""").secretRequest)
        assertNull(ask("""{"category":"credential"}""").secretRequest)
        assertNull(ask("""{"category":"approval","secretName":"KEY"}""").secretRequest)
    }

    private fun form(fields: String, site: String? = "\"www.clinic.example\"") =
        ask("""{"category":"credential","secretName":"CLINIC_LOOKUP","question":"Needed for the lookup.","fields":$fields${site?.let { ",\"site\":$it" } ?: ""}}""")
    private val id = """{"name":"NATIONAL_ID","label":"National ID number"}"""

    @Test fun readsAFormsFieldsAndSite() {
        val request = form("""[{"name":"NATIONAL_ID","label":" National ID number "},{"name":"BIRTH_DATE","label":"Date of birth (YYYY-MM-DD)"}]""").secretRequest
        assertEquals("CLINIC_LOOKUP", request?.name)
        assertEquals(
            listOf(ChatPart.Tool.SecretField("NATIONAL_ID", "National ID number"), ChatPart.Tool.SecretField("BIRTH_DATE", "Date of birth (YYYY-MM-DD)")),
            request?.fields,
        )
        assertEquals("www.clinic.example", request?.site)
        assertEquals("localhost:5199", form("[$id]", "\"localhost:5199\"").secretRequest?.site)
    }

    // Fields or a site the app cannot trust leave the one masked input, never a looser card.
    @Test fun fallsBackToTheOneSecretForFieldsItCannotRead() {
        val single = ChatPart.Tool.SecretRequest("CLINIC_LOOKUP", "Needed for the lookup.")
        val seven = (0 until 7).joinToString(",") { """{"name":"F$it","label":"x"}""" }
        listOf(
            form("[$id]", null), form("[$id]", "\"https://www.clinic.example/lookup\""), form("[$id]", "\"clinic\""),
            form("[$id]", "\"WWW.Clinic.Example\""), form("[$id]", "\"www.clinic.example:0\""),
            form("[]"), form("""[{"name":"../x","label":"ID"}]"""), form("""[{"name":"ID","label":" "}]"""), form("[$id,$id]"), form("[$seven]"),
        ).forEach { assertEquals(single, it.secretRequest) }
    }

    // Every client reads a reply that opens as a single secret's does as the request's saved answer.
    @Test fun repliesWithOneFilePerField() {
        val reply = ChatPart.Tool.SecretRequest.fieldsSavedReply(
            "CLINIC_LOOKUP",
            listOf("NATIONAL_ID" to "/runtime/nuphos-secret-a/0/NATIONAL_ID", "BIRTH_DATE" to "/runtime/nuphos-secret-b/0/BIRTH_DATE"),
        )
        assertEquals(
            "🔒 CLINIC_LOOKUP saved to these files, one per field:\nNATIONAL_ID: /runtime/nuphos-secret-a/0/NATIONAL_ID\nBIRTH_DATE: /runtime/nuphos-secret-b/0/BIRTH_DATE",
            reply,
        )
        assertEquals(true, reply.startsWith(ChatPart.Tool.SecretRequest.savedReply("CLINIC_LOOKUP")))
    }

    @Test fun keepsTheCardOutOfTheFold() {
        fun tool(id: String) = ChatPart.Tool(id, "terminal", false, ChatPart.Tool.State.OutputAvailable)
        val message = ChatMessage(id = "m", parts = listOf(tool("a"), tool("b"), secret, ChatPart.Text(text = "Use the card below.")))
        val rows = ChatRow.rows(listOf(message))
        assertEquals(listOf("ask"), rows.filterIsInstance<ChatRow.Tool>().map { it.part.toolCallId })
        assertEquals(1, rows.filterIsInstance<ChatRow.Work>().size)
    }

    // Desktop draws a question as its card, never a tool row: the app answers it from the
    // Inbox and shows the answer as its answered line. A failed call keeps its row.
    @Test fun drawsNoToolRowForAQuestion() {
        fun drawsRow(input: String, state: ChatPart.Tool.State = ChatPart.Tool.State.OutputAvailable, error: String? = null): Boolean {
            val call = ChatPart.Tool("q", "request_user_decision", true, state, input = JsonValue.parse(input), errorText = error)
            val message = ChatMessage(id = "m", parts = listOf(ChatPart.Text(text = "One question first."), call))
            return ChatRow.rows(listOf(message)).any { it is ChatRow.Tool }
        }
        val choice = """{"category":"preference","question":"Which symptom?","options":["Blank screen","Late content"],"label":"Ask which symptom"}"""
        assertEquals(false, drawsRow(choice))
        assertEquals(false, drawsRow(choice, ChatPart.Tool.State.InputAvailable))
        assertEquals(false, drawsRow(choice, ChatPart.Tool.State.OutputError, Words(R.string.convtext_tool_interrupted)))
        assertEquals(true, drawsRow(choice, ChatPart.Tool.State.OutputError, "Request failed"))
        assertEquals(true, drawsRow("""{"category":"integration","question":"Connect GitHub?","providers":["github"]}"""))
        assertEquals(true, drawsRow("""{"category":"credential","secretName":"OPENAI_API_KEY","question":"Paste your key"}"""))
    }

    @Test fun findsTheFirstReplyAfterTheQuestion() = runTest {
        val reply = ChatPart.Tool.SecretRequest.savedReply("OPENAI_API_KEY") + "/home/agent/.secrets/OPENAI_API_KEY"
        assertEquals("🔒 OPENAI_API_KEY saved to /home/agent/.secrets/OPENAI_API_KEY", reply)
        suspend fun loaded(vararg messages: ChatMessage) = ChatSession("fixture", "team", readBypass = { _, _ -> false }, aiAllowed = { true },
            readDetail = { _, _, _ -> AgentConversationDetail(isOwner = true, messages = messages.toList()) }).apply { load() }
        val question = ChatMessage(id = "m", parts = listOf(secret))
        assertNull(loaded(question).reply(after = "m"))
        val session = loaded(question, ChatMessage(id = "a", parts = listOf(ChatPart.Text(text = "Done."))),
            ChatMessage.user(reply), ChatMessage.user("later"))
        assertEquals(reply, session.reply(after = "m"))
        assertNull(session.reply(after = "missing"))
    }
}
