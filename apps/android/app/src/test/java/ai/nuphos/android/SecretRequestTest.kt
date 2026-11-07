package ai.nuphos.android

import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.ChatMessage
import ai.nuphos.android.model.ChatPart
import ai.nuphos.android.model.ChatRow
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

    @Test fun keepsTheCardOutOfTheFold() {
        fun tool(id: String) = ChatPart.Tool(id, "terminal", false, ChatPart.Tool.State.OutputAvailable)
        val message = ChatMessage(id = "m", parts = listOf(tool("a"), tool("b"), secret, ChatPart.Text(text = "Use the card below.")))
        val rows = ChatRow.rows(listOf(message))
        assertEquals(listOf("ask"), rows.filterIsInstance<ChatRow.Tool>().map { it.part.toolCallId })
        assertEquals(1, rows.filterIsInstance<ChatRow.Work>().size)
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
