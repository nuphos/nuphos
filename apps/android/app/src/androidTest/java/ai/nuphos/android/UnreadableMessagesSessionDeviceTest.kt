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

    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>
    private fun text(id: String, role: String, words: String) = """{"id":"$id","role":"$role","parts":[{"type":"text","text":"$words"}]}"""

    @Before fun before() {
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val sent = okio.Buffer().also { request.body?.writeTo(it) }.readUtf8()
            val path = request.url.encodedPath
            val response = when {
                path == "/agent/chat" && outOfSync -> {
                    posted += JsonValue.parse(sent)!!
                    return@addInterceptor Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(409).message("fixture")
                        .body("""{"error":{"code":"transcript_out_of_sync","message":"Synthetic conflict","storedMessageCount":2}}""".toResponseBody(Http.jsonMedia)).build()
                }
                path == "/agent/chat" -> { posted += JsonValue.parse(sent)!!; "data: {\"type\":\"finish\"}\n\n" }
                path.endsWith("/transcript") -> { puts += JsonValue.parse(sent)!!; "{}" }
                path == "/agent/conversations/fixture" ->
                    """{"title":"Fixture","isOwner":true,"canManage":true,"messagesFirstIndex":$first,"messageCount":${first + 3},"messages":[$entries]}"""
                else -> "{}"
            }
            val media = if (path == "/agent/chat") "text/event-stream".toMediaType() else Http.jsonMedia
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture").body(response.toResponseBody(media)).build()
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
        runBlocking(Dispatchers.Main) { access().value = savedAccess }
        originals.forEach { (name, client) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client) }
    }

    private fun loaded() = runBlocking(Dispatchers.Main) {
        ChatSession(token, "fixture-team", "fixture").also { it.load() }
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
        assertTrue("Bounded: ${posted.size}", posted.size <= 4)
        assertTrue(posted.flatMap { ids(it) }.none { it.orEmpty().startsWith("unreadable") })
        assertNotNull("The failure shows", session.error)
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
