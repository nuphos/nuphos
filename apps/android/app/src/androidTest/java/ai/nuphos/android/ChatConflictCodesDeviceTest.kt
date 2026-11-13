package ai.nuphos.android

import androidx.compose.runtime.MutableState
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.nuphos.android.data.AgentChatApi
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.session.ChatSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList

/** Each error `POST /agent/chat` answers with, in the shape the backend's error handler sends. */
@RunWith(AndroidJUnit4::class)
class ChatConflictCodesDeviceTest {
    private val token = "synthetic-conflict"
    private val originals = mutableMapOf<String, OkHttpClient>()
    private var savedAccess: Any? = null
    private val sessions = mutableListOf<ChatSession>()
    private val posted = CopyOnWriteArrayList<JsonValue>()
    private val puts = CopyOnWriteArrayList<JsonValue>()
    /** What each `POST /agent/chat` answers, in order. Past the end, a finished reply. */
    private val answers = java.util.concurrent.ConcurrentLinkedQueue<Pair<Int, String>>()
    /** What the server holds once the resume found the stream gone, from the id of the message sent. */
    @Volatile private var storedAfterGone: ((String) -> String)? = null

    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>
    private fun error(code: String, message: String, details: String? = null) =
        """{"error":{"code":"$code","message":"$message"${details?.let { ",\"details\":$it" } ?: ""},"requestId":"req"}}"""
    private val reply = listOf("{\"type\":\"start\",\"messageId\":\"reply\"}", "{\"type\":\"text-start\",\"id\":\"t\"}",
        "{\"type\":\"text-delta\",\"id\":\"t\",\"delta\":\"Reply\"}", "{\"type\":\"text-end\",\"id\":\"t\"}",
        "{\"type\":\"atlas-turn-complete\"}", "{\"type\":\"atlas-stream-done\"}").joinToString("") { "data: $it\n\n" }
    private val history = """{"id":"one","role":"user","parts":[{"type":"text","text":"Question"}]},{"id":"two","role":"assistant","parts":[{"type":"text","text":"Answer"}]}"""

    @Before fun before() {
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val sent = okio.Buffer().also { request.body?.writeTo(it) }.readUtf8()
            val path = request.url.encodedPath
            var code = 200
            var media = Http.jsonMedia
            val response = when {
                path == "/agent/chat" -> {
                    posted += JsonValue.parse(sent)!!
                    val answer = answers.poll()
                    if (answer != null) {
                        code = answer.first
                        if (code == 200) media = "text/event-stream".toMediaType()
                        answer.second
                    }
                    else { media = "text/event-stream".toMediaType(); reply }
                }
                path.endsWith("/transcript") -> { puts += JsonValue.parse(sent)!!; "{}" }
                path == "/agent/conversations/fixture" && posted.size >= 3 && storedAfterGone != null ->
                    storedAfterGone!!(userIds(posted[0]).last()!!)
                path == "/agent/conversations/fixture" ->
                    """{"title":"Fixture","isOwner":true,"canManage":true,"messagesFirstIndex":10,"messageCount":12,"messages":[$history]}"""
                else -> "{}"
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("fixture")
                .header("Content-Type", media.toString()).body(response.toResponseBody(media)).build()
        }.build()
        for (name in listOf("client", "chatClient")) {
            val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
            originals[name] = field.get(null) as OkHttpClient
            field.set(null, client)
        }
        runBlocking(Dispatchers.Main) { savedAccess = access().value; AiAccess.activate(token); AiAccess.grant(token) }
    }
    @After fun after() {
        runBlocking(Dispatchers.Main) { sessions.forEach { it.stop() }; AiAccess.revoke(); access().value = savedAccess }
        originals.forEach { (name, client) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client) }
    }

    /** Sends a message and waits for the turn to end. */
    private fun send(): ChatSession {
        val session = runBlocking(Dispatchers.Main) { ChatSession(token, "fixture-team", "fixture").also { it.load(); sessions += it } }
        runBlocking(Dispatchers.Main) { assertTrue(session.send("Next")) }
        val until = System.currentTimeMillis() + 15_000
        while ((posted.isEmpty() || session.isStreaming) && System.currentTimeMillis() < until) Thread.sleep(50)
        assertFalse("The turn ends", session.isStreaming)
        Thread.sleep(600) // Past the reload a finished turn schedules.
        return session
    }
    private fun userIds(body: JsonValue) = body["messages"]?.arrayValue.orEmpty().filter { it["role"]?.stringValue == "user" }.map { it["id"]?.stringValue }
    private fun refusedKeepsTheDraft(code: String, message: String, expected: String = message) {
        answers += 409 to error(code, message)
        val session = send()
        assertEquals("No retry for $code", 1, posted.size)
        assertEquals(expected, session.error)
        assertEquals("The draft comes back for $code", "Next", session.rejectedSubmission?.text)
        assertEquals("The refused bubble goes for $code", 0, session.messages.count { it.text == "Next" })
        assertFalse(session.runtimeRecoveryRequired)
    }

    @Test fun aBusyConversationRefusesAndKeepsTheDraft() =
        refusedKeepsTheDraft("conversation_busy", "busy", "This agent is busy with another reply.")
    @Test fun aStreamConflictRefusesAndKeepsTheDraft() =
        refusedKeepsTheDraft("stream_conflict", "Stream id belongs to another conversation", "That stream belongs to another agent.")
    @Test fun anOfflineRuntimeSaysSoInTheAppsWordsAndKeepsTheDraft() {
        refusedKeepsTheDraft("runtime_offline", "The Box is offline", "The computer running this runtime is offline. Open Nuphos on it, or switch to another runtime.")
    }
    @Test fun everyBlockedRuntimeOffersSwitchRuntime() {
        for (code in listOf("runtime_login_required", "runtime_disabled", "runtime_not_found", "runtime_offline")) {
            val message = AgentChatApi.conflict(409, error(code, "Server wording")).message
            assertTrue(code, message in AgentChatApi.switchRuntimeErrors)
        }
    }
    @Test fun anOtherRefusalShowsTheServersWordsAndKeepsTheDraft() =
        refusedKeepsTheDraft("conversation_read_only", "You can only view this team conversation")

    @Test fun aMessageTheServerQueuedIsNotAFailure() {
        answers += 409 to error("message_queued", "Your message waits in the queue")
        val session = send()
        assertEquals("Not sent again", 1, posted.size)
        assertNull(session.error)
        assertNull("The draft doesn't come back, so it can't be sent twice", session.rejectedSubmission)
        assertEquals(1, session.queuedSends)
    }

    @Test fun outOfSyncRebasesThenResendsAndStopsThereWithTheSameMessage() {
        val stored = """{"storedMessageCount":2}"""
        repeat(5) { answers += 409 to error("transcript_out_of_sync", "Stored transcript has 2 messages; client claimed 12", stored) }
        val session = send()
        assertEquals("Try, rebase, full resend, then stop", 3, posted.size)
        assertEquals("One message, so no duplicate on the server", 1, posted.flatMap { userIds(it).takeLast(1) }.distinct().size)
        assertEquals("One stream, so the server attaches to a run instead of starting another", 1, posted.map { it["streamId"] }.distinct().size)
        assertEquals("The app's words", "The agent changed elsewhere; resyncing.", session.error)
        assertEquals("Refused, so the draft comes back", "Next", session.rejectedSubmission?.text)
    }
    @Test fun outOfSyncThatRecoversSendsOneTurnAndNoError() {
        answers += 409 to error("transcript_out_of_sync", "Stored transcript has 2 messages; client claimed 12", """{"storedMessageCount":2}""")
        val session = send()
        assertEquals(2, posted.size)
        assertNull(session.error)
        assertNull(session.rejectedSubmission)
        assertEquals("The transcript is saved no more than the flow asks", 1, session.messages.count { it.text == "Next" })
        assertEquals("One reply", 1, session.messages.count { it.text == "Reply" })
        assertEquals(1, posted.map { it["streamId"] }.distinct().size)
        assertTrue("Bounded saves: ${puts.size}", puts.size <= 2)
    }
    /**
     * A stream that closes before its first frame, then a resume the server can't serve. The send may
     * already have been taken, so it must not start over, and it isn't called refused either.
     */
    @Test fun anUnresumableStreamForAnUnconfirmedSendDoesNotStartAnotherTurn() {
        answers += 200 to ""
        answers += 409 to error("stream_not_resumable", "The agent stream is no longer resumable", """{"reason":"gone"}""")
        val session = send()
        assertEquals("The send and the resume, and no fresh start", 2, posted.size)
        assertEquals(JsonValue.Bool(true), posted[1]["resume"])
        assertEquals("The previous reply can no longer be resumed.", session.error)
        assertNull("It may have been taken, so the draft doesn't come back to send twice", session.rejectedSubmission)
        assertTrue(session.runtimeRecoveryRequired)
    }
    /**
     * A taken send pauses, its continuation's stream closes before the first frame, and the resume finds
     * the stream gone. [stored] is what the server holds then.
     */
    private fun continuationWhoseStreamIsGone(stored: (sent: String) -> String): ChatSession {
        answers += 200 to listOf("{\"type\":\"start\",\"messageId\":\"partial\"}", "{\"type\":\"text-start\",\"id\":\"t\"}",
            "{\"type\":\"text-delta\",\"id\":\"t\",\"delta\":\"Partial\"}", "{\"type\":\"text-end\",\"id\":\"t\"}",
            "{\"type\":\"atlas-turn-paused\",\"reason\":\"model-silence\"}", "{\"type\":\"atlas-stream-done\"}").joinToString("") { "data: $it\n\n" }
        answers += 200 to ""
        answers += 409 to error("stream_not_resumable", "The agent stream is no longer resumable", """{"reason":"gone"}""")
        storedAfterGone = stored
        val session = send()
        assertEquals(JsonValue.Bool(true), posted[1]["continueAfterInterruption"])
        assertEquals(JsonValue.Bool(true), posted[2]["resume"])
        return session
    }
    private fun stored(sent: String, reply: String = "", activeRun: String = "null") =
        """{"title":"Fixture","isOwner":true,"canManage":true,"messagesFirstIndex":10,"messageCount":14,"activeRun":$activeRun,"messages":[$history,{"id":"$sent","role":"user","parts":[{"type":"text","text":"Next"}]}$reply]}"""

    @Test fun aReplyTheServerAlreadyStoredIsShownInsteadOfAskingAgain() {
        val session = continuationWhoseStreamIsGone { sent ->
            stored(sent, """,{"id":"stored","role":"assistant","parts":[{"type":"text","text":"Stored reply"}]}""")
        }
        assertEquals("The send, the continuation, the resume, and no fresh start", 3, posted.size)
        assertNull(session.error)
        assertEquals(1, session.messages.count { it.text == "Stored reply" })
        assertEquals(1, session.messages.count { it.text == "Next" })
    }
    @Test fun aRunStillLiveIsFollowedInsteadOfAskingAgain() {
        val session = continuationWhoseStreamIsGone { sent -> stored(sent, activeRun = """{"streamId":"live"}""") }
        assertEquals("Then one resume of the live run", 4, posted.size)
        assertEquals("live", posted[3]["streamId"]?.stringValue)
        assertEquals(JsonValue.Bool(true), posted[3]["resume"])
        assertNull(session.error)
        assertEquals(1, session.messages.count { it.text == "Reply" })
    }
    @Test fun aTurnNothingAnsweredIsSentAgainOnce() {
        val session = continuationWhoseStreamIsGone { sent -> stored(sent) }
        assertEquals("Then one fresh start", 4, posted.size)
        assertEquals(posted[2]["streamId"], posted[3]["streamId"])
        assertNotEquals(JsonValue.Bool(true), posted[3]["resume"])
        assertNull(session.error)
        assertEquals(1, session.messages.count { it.text == "Reply" })
    }
    /** The refused message leaves the list and its draft comes back: sending it again is one message. */
    @Test fun sendingARefusedMessageAgainDoesNotDuplicateIt() {
        answers += 409 to error("conversation_busy", "busy")
        val session = send()
        val draft = requireNotNull(session.rejectedSubmission)
        runBlocking(Dispatchers.Main) { session.clearRejectedSubmission(); assertTrue(session.send(draft)) }
        val until = System.currentTimeMillis() + 15_000
        while ((posted.size < 2 || session.isStreaming) && System.currentTimeMillis() < until) Thread.sleep(50)
        assertFalse(session.isStreaming)
        assertEquals(2, posted.size)
        assertEquals("The same message both times", userIds(posted[0]).last(), userIds(posted[1]).last())
        assertEquals(1, session.messages.count { it.text == "Next" })
        assertEquals(1, session.messages.count { it.text == "Reply" })
        assertNull(session.error)
    }

    @Test fun aStartingRuntimeIsWaitedForWithTheSameMessage() {
        repeat(2) { answers += 409 to error("runtime_not_accepting_message", "The runtime is starting") }
        val session = send()
        assertEquals("Two refusals, then the reply", 3, posted.size)
        assertEquals(1, posted.map { userIds(it).last() }.distinct().size)
        assertEquals(1, posted.map { it["streamId"] }.distinct().size)
        assertNull(session.error)
        assertNull(session.rejectedSubmission)
        assertEquals(1, session.messages.count { it.text == "Next" })
        assertEquals(1, session.messages.count { it.text == "Reply" })
    }
    @Test fun anInvalidBatchTakesTheServersTranscriptAndKeepsTheDraft() {
        answers += 400 to error("invalid_message_batch", "Send one new user message at a time, as the final message.")
        val session = send()
        assertEquals("No retry", 1, posted.size)
        assertEquals("This agent changed elsewhere and was reloaded. Retry to send your message.", session.error)
        assertEquals("Next", session.rejectedSubmission?.text)
        assertEquals("The server's transcript", listOf("one", "two"), session.messages.map { it.id })
    }
    /** A resume the app sent itself, for a conversation the server never created: start over once. */
    @Test fun aResumeForAMissingConversationStartsOverWithTheSameMessage() {
        answers += 200 to ""
        answers += 404 to error("not_found", "Conversation not found")
        val session = send()
        assertEquals("The send, the resume, then a fresh start", 3, posted.size)
        assertEquals(JsonValue.Bool(true), posted[1]["resume"])
        assertNotEquals(JsonValue.Bool(true), posted[2]["resume"])
        assertEquals(1, posted.map { userIds(it).last() }.distinct().size)
        assertNull(session.error)
        assertEquals(1, session.messages.count { it.text == "Next" })
        assertEquals(1, session.messages.count { it.text == "Reply" })
    }
}
