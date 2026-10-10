package ai.nuphos.android

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.nuphos.android.data.*
import ai.nuphos.android.model.*
import ai.nuphos.android.session.ChatSession
import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.*
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList

/** Isolated Android transport/session journeys. All API requests use fixtures. */
@RunWith(AndroidJUnit4::class)
class SessionFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val originals = mutableMapOf<String, OkHttpClient>()
    private val requests = CopyOnWriteArrayList<Request>()
    private val bodies = CopyOnWriteArrayList<JsonValue>()
    private var actions = "{\"send\":true,\"cancel\":false,\"steer\":false,\"reply\":false}"
    private var native = true
    private var owner = true
    private var actor = false
    private var title = "Fixture chat"
    private var archived = false
    private val assistant = ChatMessage(id = "assistant-fixture", parts = listOf(ChatPart.Text(text = "Existing fixture reply")))
    @Before fun blockNetwork() {
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val req = chain.request(); requests += req
            val buffer = okio.Buffer(); req.body?.writeTo(buffer)
            val body = JsonValue.parse(buffer.readUtf8()) ?: JsonValue.Null
            var text = "{}"
            var media = Http.jsonMedia
            when {
                req.url.encodedPath == "/agent/chat" -> {
                    bodies += body
                    media = "text/event-stream".toMediaType()
                    text = listOf(
                        "{\"type\":\"start\",\"messageId\":\"reply-fixture\"}",
                        "{\"type\":\"text-start\",\"id\":\"text-fixture\"}",
                        "{\"type\":\"text-delta\",\"id\":\"text-fixture\",\"delta\":\"FIXTURE_OK\"}",
                        "{\"type\":\"text-end\",\"id\":\"text-fixture\"}",
                        "{\"type\":\"atlas-turn-complete\"}", "{\"type\":\"atlas-stream-done\"}"
                    ).joinToString("") { "data: $it\n\n" }
                }
                req.url.encodedPath.endsWith("/steer") -> text = "{\"ok\":true,\"messageId\":\"steer-fixture\"}"
                req.url.encodedPath.endsWith("/cancel-runtime") -> text = "{\"ok\":true,\"status\":\"requested\"}"
                req.url.encodedPath.endsWith("/title") -> { title = body["title"]!!.stringValue!!; text = "{\"title\":\"$title\"}" }
                req.url.encodedPath.endsWith("/archive") -> { archived = body["archived"]!!.boolValue!!; text = "{\"ok\":true,\"archived\":$archived}" }
                req.url.encodedPath.endsWith("/fixture") -> {
                    val detail = AgentConversationDetail(messages = listOf(assistant), title = title, readOnly = false,
                        isOwner = owner, canCancelRun = actor, canRespondToRun = actor, agentRuntime = if (native) "openab" else null,
                        archivedAt = if (archived) java.time.Instant.EPOCH else null,
                        runtimeState = if (native) JsonValue.parse("{\"schemaVersion\":2,\"epoch\":\"fixture-epoch\",\"revision\":1,\"state\":\"idle\",\"phase\":\"idle\",\"actions\":$actions}") else null)
                    text = Http.json.encodeToString(AgentConversationDetail.serializer(), detail)
                }
            }
            Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(200).message("fixture").header("Content-Type", media.toString()).body(text.toResponseBody(media)).build()
        }.build()
        for (name in listOf("client", "chatClient")) {
            val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
            originals[name] = field.get(null) as OkHttpClient; field.set(null, client)
        }
    }
    @After fun restore() { originals.forEach { (name, value) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, value) } }
    private fun session(transfers: AttachmentTransfers = AttachmentTransfers()): ChatSession {
        // This intercepted transport suite does not test account consent. Use the existing capability seam.
        val session = ChatSession("fixture-no-credentials", "fixture-team", "fixture", transfers = transfers, aiAllowed = { true })
        runBlocking { session.load() }
        compose.waitForIdle()
        Assert.assertNull(session.loadError)
        return session
    }
    @Test fun computerSelectionAndExplicitClearReachChatRequest() {
        native = false
        val session = session()
        compose.runOnIdle {
            session.credentialAccess = CredentialSelection(JsonValue.parse("""{"deviceIds":["mac","pc"],"awsRoleIds":["aws"]}""")!!)
            Assert.assertTrue(session.send("Synthetic computer permissions"))
        }
        compose.waitUntil(10_000) { bodies.size == 1 && !session.isStreaming }
        val access = bodies[0]["credentialAccess"]!!
        Assert.assertEquals(listOf("mac", "pc"), access["deviceIds"]!!.arrayValue!!.map { it.stringValue })
        Assert.assertEquals(listOf("aws"), access["awsRoleIds"]!!.arrayValue!!.map { it.stringValue })
        compose.runOnIdle {
            session.credentialAccess = CredentialSelection()
            Assert.assertTrue(session.send("Synthetic clear permissions"))
        }
        compose.waitUntil(10_000) { bodies.size == 2 && !session.isStreaming }
        Assert.assertTrue(bodies[1]["credentialAccess"]!!["deviceIds"]!!.arrayValue!!.isEmpty())
    }

    @Test fun nativeReplyUsesReasonAndNeverWritesTranscript() {
        actor = true; owner = false
        actions = "{\"send\":false,\"reply\":true,\"steer\":true,\"cancel\":false}"
        val session = session()
        compose.runOnIdle { Assert.assertTrue(session.send("Fixture runtime reply")) }
        compose.waitUntil(10_000) { bodies.isNotEmpty() && !session.isStreaming }
        Assert.assertEquals("runtime-reply", bodies.single()["resumeReason"]?.stringValue)
        Assert.assertFalse(requests.any { it.method == "PUT" })
    }
    @Test fun nativeSteeringUsesEndpointReceiptAndSingleAcknowledgement() {
        actor = true
        actions = "{\"send\":false,\"reply\":false,\"steer\":true,\"cancel\":true}"
        val session = session()
        compose.runOnIdle { Assert.assertTrue(session.send("Steer fixture")) }
        compose.waitUntil(10_000) { requests.any { it.url.encodedPath.endsWith("/steer") } && session.queued.isEmpty() }
        Assert.assertEquals(1, requests.count { it.url.encodedPath.endsWith("/steer") })
        Assert.assertEquals(1, session.messages.flatMap { it.parts }.filterIsInstance<ChatPart.Data>().count { it.name == "steering" })
        Assert.assertTrue(bodies.isEmpty())
    }
    @Test fun nativeCancelAcknowledgementDoesNotClaimStopped() {
        actor = true
        actions = "{\"send\":false,\"cancel\":true,\"steer\":false,\"reply\":false}"
        val session = session()
        compose.runOnIdle { session.stop(); session.stop() }
        compose.waitUntil(10_000) { requests.any { it.url.encodedPath.endsWith("/cancel-runtime") } }
        Assert.assertEquals(1, requests.count { it.url.encodedPath.endsWith("/cancel-runtime") })
        Assert.assertTrue(session.cancelRequested); Assert.assertFalse(session.stoppedByUser)
    }
    @Test fun attachmentFailureRetainsBatchThenRetryDispatchesOneReadyGroup() {
        val fixture = TransferFixture()
        val session = session(AttachmentTransfers(fixture))
        val attachment = ComposerAttachment(name = "marker.txt", kind = ComposerAttachment.Kind.File("secret-file-marker".toByteArray(), "text/plain"))
        compose.runOnIdle { Assert.assertTrue(session.send(ComposerSubmission("Read the file", listOf(attachment)))) }
        compose.waitUntil(10_000) { session.uploadError != null && !session.uploadBusy }
        Assert.assertNotNull(session.uploadDraft); Assert.assertTrue(bodies.isEmpty())
        fixture.ready = true
        compose.runOnIdle { session.retryUpload(); session.retryUpload() }
        compose.waitUntil(10_000) { bodies.isNotEmpty() && !session.isStreaming }
        Assert.assertEquals(1, fixture.intents); Assert.assertEquals(1, fixture.puts)
        Assert.assertEquals(1, bodies.size); Assert.assertNull(session.uploadDraft)
        val message = bodies.single()["messages"]!!.arrayValue!!.last()
        val texts = message["parts"]!!.arrayValue!!.mapNotNull { it["text"]?.stringValue }
        Assert.assertTrue(texts.any { it.contains(fixture.group) && it.contains("transfer-pull.sh") })
        Assert.assertFalse(texts.any { it.contains("secret-file-marker") || it.contains("not available") })
    }
    private class TransferFixture : AttachmentTransfers.Transport {
        val group = "0123456789abcdef01234567"
        var ready = false; var intents = 0; var puts = 0
        override suspend fun api(method: String, path: String, token: String, body: JsonValue?): String {
            if (path.endsWith("file-transfers")) {
                intents++
                return "{\"groupId\":\"$group\",\"direction\":\"upload\",\"status\":\"pending\",\"expiresAt\":\"2099-01-01T00:00:00Z\",\"files\":[{\"id\":\"f\",\"fileName\":\"marker.txt\",\"relPath\":\"1-marker.txt\",\"uploadUrl\":\"https://storage.example/file\",\"expiresAt\":\"2099-01-01T00:00:00Z\"}]}"
            }
            return "{\"groupId\":\"$group\",\"direction\":\"upload\",\"status\":\"${if (ready) "ready" else "partial"}\",\"expiresAt\":\"2099-01-01T00:00:00Z\",\"files\":[{\"id\":\"f\",\"fileName\":\"marker.txt\",\"relPath\":\"1-marker.txt\",\"status\":\"ready\",\"size\":18}]}"
        }
        override suspend fun put(url: String, mime: String, bytes: ByteArray, pending: AttachmentTransfers.Pending, progress: (Long) -> Unit) { puts++; Assert.assertEquals("secret-file-marker", bytes.toString(Charsets.UTF_8)); progress(bytes.size.toLong()) }
    }
}
