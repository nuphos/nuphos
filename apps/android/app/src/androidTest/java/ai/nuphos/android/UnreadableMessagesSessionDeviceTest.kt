package ai.nuphos.android

import androidx.compose.runtime.MutableState
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.ChatRow
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

/** Unreadable messages in a real session: positions on the server must stay right around them. */
@RunWith(AndroidJUnit4::class)
class UnreadableMessagesSessionDeviceTest {
    private val token = "synthetic-unreadable"
    private val originals = mutableMapOf<String, OkHttpClient>()
    private var savedAccess: Any? = null
    private val posted = CopyOnWriteArrayList<JsonValue>()
    private val puts = CopyOnWriteArrayList<JsonValue>()
    @Volatile private var entries = ""
    @Volatile private var first = 10
    @Volatile private var outOfSync = false
    private val conflictsLeft = java.util.concurrent.atomic.AtomicInteger(0)

    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>
    private fun text(id: String, role: String, words: String) = """{"id":"$id","role":"$role","parts":[{"type":"text","text":"$words"}]}"""

    @Before fun before() {
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val sent = okio.Buffer().also { request.body?.writeTo(it) }.readUtf8()
            val path = request.url.encodedPath
            val response = when {
                path == "/agent/chat" && (outOfSync || conflictsLeft.getAndDecrement() > 0) -> {
                    posted += JsonValue.parse(sent)!!
                    return@addInterceptor Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(409).message("fixture")
                        .body("""{"error":{"code":"transcript_out_of_sync","message":"Synthetic conflict","details":{"storedMessageCount":2}}}""".toResponseBody(Http.jsonMedia)).build()
                }
                path == "/agent/chat" -> { posted += JsonValue.parse(sent)!!; listOf("{\"type\":\"start\",\"messageId\":\"reply\"}", "{\"type\":\"text-start\",\"id\":\"t\"}", "{\"type\":\"text-delta\",\"id\":\"t\",\"delta\":\"Reply\"}", "{\"type\":\"text-end\",\"id\":\"t\"}", "{\"type\":\"atlas-turn-complete\"}", "{\"type\":\"atlas-stream-done\"}").joinToString("") { "data: $it\n\n" } }
                path.endsWith("/transcript") -> { puts += JsonValue.parse(sent)!!; "{}" }
                path == "/agent/conversations/fixture" ->
                    """{"title":"Fixture","isOwner":true,"canManage":true,"messagesFirstIndex":$first,"messageCount":${first + (JsonValue.parse("[$entries]")?.arrayValue?.size ?: 0)},"messages":[$entries]}"""
                else -> "{}"
            }
            val media = if (path == "/agent/chat") "text/event-stream".toMediaType() else Http.jsonMedia
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .header("Content-Type", media.toString()).body(response.toResponseBody(media)).build()
        }.build()
        for (name in listOf("client", "chatClient")) {
            val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
            originals[name] = field.get(null) as OkHttpClient
            field.set(null, client)
        }
        runBlocking(Dispatchers.Main) {
            savedAccess = access().value
            AiAccess.activate(token); AiAccess.grant(token)
        }
    }
    @After fun after() {
        // A session still reconnecting would keep using the shared client in the next test.
        runBlocking(Dispatchers.Main) { sessions.forEach { it.stop() }; AiAccess.revoke(); access().value = savedAccess }
        originals.forEach { (name, client) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client) }
    }

    private val sessions = mutableListOf<ChatSession>()
    private fun loaded() = runBlocking(Dispatchers.Main) {
        ChatSession(token, "fixture-team", "fixture").also { it.load(); sessions += it }
    }
    private fun shown(session: ChatSession) = runBlocking(Dispatchers.Main) {
        ChatRow.rows(session).filterIsInstance<ChatRow.User>().map { it.text } +
            ChatRow.rows(session).filterIsInstance<ChatRow.AssistantText>().map { it.text }
    }
    private fun awaitPost(): JsonValue {
        val until = System.currentTimeMillis() + 8_000
        while (posted.isEmpty() && System.currentTimeMillis() < until) Thread.sleep(50)
        return posted.firstOrNull() ?: throw AssertionError("Nothing was sent")
    }
    private fun ids(body: JsonValue) = body["messages"]?.arrayValue.orEmpty().map { it["id"]?.stringValue }

    @Test fun itIsHiddenAndKeepsThePositionsOfTheMessagesAroundIt() {
        entries = text("one", "user", "Question") + ",\"oops\"," + text("two", "assistant", "Answer")
        val session = loaded()
        assertEquals("Position on the server", 10, session.baseIndex)
        assertEquals("Its place is kept", 3, session.messages.size)
        assertEquals(listOf("Question", "Answer"), shown(session))
    }
    @Test fun catchingUpCountsItSoNothingIsMissedOrRepeated() {
        entries = text("one", "user", "Question") + ",\"oops\"," + text("two", "assistant", "Answer")
        val session = loaded()
        entries += "," + text("three", "assistant", "More")
        runBlocking(Dispatchers.Main) { session.reloadFromServer() }
        assertEquals(listOf("Question", "Answer", "More"), shown(session))
        assertEquals(10, session.baseIndex)
    }
    @Test fun whatIsSentStartsAtTheRightPositionWithoutIt() {
        entries = "\"oops\"," + text("one", "user", "Question") + ",\"oops\"," + text("two", "assistant", "Answer")
        val session = loaded()
        runBlocking(Dispatchers.Main) { assertTrue(session.send("Next")) }
        val body = awaitPost()
        // Four loaded from position 10, so the new message is at 14.
        assertEquals(JsonValue.Number(14.0), body["baseIndex"])
        assertEquals(1, ids(body).size)
        assertTrue(ids(body).none { it.orEmpty().startsWith("unreadable") })
    }
    /** What a turn would send, with the session's own choice of how much. */
    private fun window(session: ChatSession, full: Boolean): Pair<List<String>, Int> {
        val method = ChatSession::class.java.declaredMethods.first { it.name.startsWith("transcriptWindow") }.also { it.isAccessible = true }
        val window = runBlocking(Dispatchers.Main) { method.invoke(session, full, null) }!!
        fun <T> field(name: String) = window.javaClass.getDeclaredField(name).also { it.isAccessible = true }.get(window) as T
        return field<List<ai.nuphos.android.model.ChatMessage>>("messages").map { it.id } to field<Int>("baseIndex")
    }
    @Test fun aFullResendStartsAfterTheLastOneSoTheServerKeepsThem() {
        entries = "\"oops\"," + text("one", "user", "Question") + ",\"oops\"," + text("two", "assistant", "Answer")
        assertEquals(listOf("two") to 13, window(loaded(), full = true))
    }
    @Test fun aWindowFromTheOnlyUserMessageStartsAfterOne() {
        entries = text("one", "user", "Question") + ",\"oops\"," + text("two", "assistant", "Answer")
        assertEquals(listOf("two") to 12, window(loaded(), full = false))
    }
    @Test fun aRealMessageWhoseIdLooksLikeAPlaceholderIsStillReal() {
        entries = text("unreadable-message-0", "user", "Question") + "," + text("two", "assistant", "Answer")
        val session = loaded()
        assertEquals(listOf("Question", "Answer"), shown(session))
        assertEquals(listOf("unreadable-message-0", "two") to 10, window(session, full = false))
    }
    @Test fun aServerOutOfSyncNeverReceivesThePlaceholderAndTheRetriesEnd() {
        entries = text("one", "user", "Question") + ",\"oops\"," + text("two", "assistant", "Answer")
        outOfSync = true
        val session = loaded()
        runBlocking(Dispatchers.Main) { assertTrue(session.send("Next")) }
        awaitPost()
        val until = System.currentTimeMillis() + 15_000
        while (session.isStreaming && System.currentTimeMillis() < until) Thread.sleep(100)
        assertFalse("The retries end", session.isStreaming)
        // The first try, then the rebase, then the full resend.
        assertEquals("Bounded", 3, posted.size)
        assertEquals("The rebase used the stored count", JsonValue.Number(5.0), posted[1]["baseIndex"])
        assertTrue(posted.flatMap { ids(it) }.none { it.orEmpty().startsWith("unreadable") })
        assertNotNull("The failure shows", session.error)
    }
    private fun sendAfterOneConflict(): ChatSession {
        conflictsLeft.set(1)
        val session = loaded()
        runBlocking(Dispatchers.Main) { assertTrue(session.send("Next")) }
        val until = System.currentTimeMillis() + 15_000
        while ((posted.size < 2 || session.isStreaming) && System.currentTimeMillis() < until) Thread.sleep(50)
        assertFalse("The turn ends: posts=${posted.size} error=${session.error} phase=${session.phaseLabel}", session.isStreaming)
        return session
    }
    /** The server took the retry, as it would once it had grown past the position sent. */
    @Test fun aRetryThatIsAcceptedSendsOnlyTheNewMessageAndSavesNothing() {
        entries = text("one", "user", "Question") + ",\"oops\"," + text("two", "assistant", "Answer")
        val session = sendAfterOneConflict()
        assertEquals("One conflict, then the accepted retry", 2, posted.size)
        assertNull(session.error)
        posted.forEach { body ->
            assertEquals(1, ids(body).size)
            assertTrue(ids(body).none { it.orEmpty().startsWith("unreadable") })
        }
        assertEquals("The same message both times", ids(posted[0]), ids(posted[1]))
        // The rebase uses the count the server reported, plus where the window starts.
        assertEquals(JsonValue.Number(13.0), posted[0]["baseIndex"])
        assertEquals(JsonValue.Number(5.0), posted[1]["baseIndex"])
        assertTrue("With a placeholder nothing is saved at any point: $puts", puts.isEmpty())
        assertTrue("Its place is still kept", session.messages.any { it.isUnreadable })
    }
    /** Without a placeholder, the same flow behaves the same on the wire, and it does save. */
    @Test fun aRetryWithNothingUnreadableStillSaves() {
        entries = text("one", "user", "Question") + "," + text("two", "assistant", "Answer")
        val session = sendAfterOneConflict()
        assertEquals(2, posted.size)
        assertNull(session.error)
        assertFalse("The control saves before sending", puts.isEmpty())
    }
    private fun sendAndSave(): ChatSession {
        val session = loaded()
        runBlocking(Dispatchers.Main) { assertTrue(session.send("Next")) }
        awaitPost()
        val until = System.currentTimeMillis() + 8_000
        while (session.isStreaming && System.currentTimeMillis() < until) Thread.sleep(50)
        runBlocking(Dispatchers.Main) { session.syncTranscriptNow() }
        return session
    }
    @Test fun theSavedTranscriptIsNotOverwritten() {
        entries = text("one", "user", "Question") + ",\"oops\"," + text("two", "assistant", "Answer")
        sendAndSave()
        assertTrue(puts.toString(), puts.isEmpty())
    }
    @Test fun withNothingUnreadableTheSameSendAndSaveStillHappen() {
        entries = text("one", "user", "Question") + "," + text("two", "assistant", "Answer")
        sendAndSave()
        assertEquals(JsonValue.Number(12.0), posted.first()["baseIndex"])
        assertFalse("The control saves, so the test above means something", puts.isEmpty())
    }
}
