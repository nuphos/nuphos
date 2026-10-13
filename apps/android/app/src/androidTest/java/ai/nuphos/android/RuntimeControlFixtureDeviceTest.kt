package ai.nuphos.android

import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.navigation.compose.rememberNavController
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.nuphos.android.data.*
import ai.nuphos.android.model.*
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.ChatSession
import ai.nuphos.android.session.RuntimeObservation
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.chat.ConversationScreen
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.cancel
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.*
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList

/** Actual Compose controls with synthetic sessions, blocked HTTP, and deferred acknowledgements. */
@RunWith(AndroidJUnit4::class)
class RuntimeControlFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val originals = mutableMapOf<String, OkHttpClient>()
    private data class Recorded(val method: String, val path: String, val body: JsonValue)
    private val requests = CopyOnWriteArrayList<Recorded>()
    private lateinit var session: ChatSession
    private var savedAccess: Any? = null
    private val fixtureToken = "synthetic-no-credentials"
    @Suppress("UNCHECKED_CAST") private fun accessState() = AiAccess::class.java.getDeclaredField("state").also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>
    private val assistant = ChatMessage(id = "ui-assistant", role = ChatMessage.Role.Assistant,
        parts = listOf(ChatPart.Text(text = "Synthetic runtime history")))
    private val chats get() = requests.filter { it.path == "/agent/chat" && it.method == "POST" }

    @Before fun blockNetwork() {
        compose.runOnIdle {
            savedAccess = accessState().value
            AiAccess.activate(fixtureToken)
            AiAccess.grant(fixtureToken)
        }
        val mock = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val buffer = okio.Buffer()
            request.body?.writeTo(buffer)
            requests += Recorded(request.method, request.url.encodedPath, JsonValue.parse(buffer.readUtf8()) ?: JsonValue.Null)
            val chat = request.url.encodedPath == "/agent/chat"
            val cancel = request.url.encodedPath.endsWith("/cancel-runtime")
            val media = if (chat) "text/event-stream".toMediaType() else Http.jsonMedia
            val text = when {
                chat -> listOf(
                    "{\"type\":\"start\",\"messageId\":\"ui-response\"}",
                    "{\"type\":\"atlas-turn-complete\"}",
                    "{\"type\":\"atlas-stream-done\"}"
                ).joinToString("") { "data: $it\n\n" }
                cancel -> "{\"ok\":true,\"status\":\"requested\"}"
                else -> "{\"error\":{\"message\":\"Fixture polling unavailable\"}}"
            }
            // Failed synthetic reads keep the explicitly seeded status from being refreshed by polling.
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(if (chat || cancel) 200 else 503)
                .message("fixture").header("Content-Type", media.toString()).body(text.toResponseBody(media)).build()
        }.build()
        for (name in listOf("client", "chatClient")) {
            val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
            originals[name] = field.get(null) as OkHttpClient
            field.set(null, mock)
        }
    }
    @After fun restoreNetwork() {
        compose.runOnIdle {
            compose.activity.setContent { }
            accessState().value = savedAccess
            if (::session.isInitialized) {
                (ChatSession::class.java.getDeclaredField("scope").also { it.isAccessible = true }.get(session) as CoroutineScope).cancel()
            }
        }
        originals.forEach { (name, client) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client) }
    }
    @Suppress("UNCHECKED_CAST")
    private fun state(target: Any, name: String, value: Any?) {
        val field = target.javaClass.getDeclaredField(name + "\$delegate").also { it.isAccessible = true }
        (field.get(target) as MutableState<Any?>).value = value
    }
    private fun snapshot(phase: String = "running", label: String = "Running fixture", schema: Int = 2,
        send: Boolean = false, reply: Boolean = false, steer: Boolean = false, cancel: Boolean = false): JsonValue = JsonValue.parse(
        """{"schemaVersion":$schema,"epoch":"ui-epoch","revision":1,"state":"$phase","phase":"$phase","label":"$label","actions":{"send":$send,"reply":$reply,"steer":$steer,"cancel":$cancel},"requests":[{"waitId":"ui-wait","toolCallId":"ui-tool"}]}"""
    )!!
    private fun metadata(snapshot: JsonValue?, native: Boolean = true, readOnly: Boolean = false,
        owner: Boolean = false, actor: Boolean = true, observedAt: Double = RuntimeObservation.now()) {
        val detail = AgentConversationDetail(agentRuntime = if (native) "openab" else null,
            readOnly = readOnly, isOwner = owner, canCancelRun = actor, canRespondToRun = actor, runtimeState = snapshot)
        ChatSession::class.java.getDeclaredMethod("refreshMetadata", AgentConversationDetail::class.java, Double::class.javaPrimitiveType)
            .also { it.isAccessible = true }.invoke(session, detail, observedAt)
    }
    private fun render(snapshot: JsonValue? = snapshot(send = true), native: Boolean = true,
        readOnly: Boolean = false, parts: List<ChatPart> = assistant.parts,
        transfers: AttachmentTransfers = AttachmentTransfers(),
        steer: suspend (String, String, String, String) -> String = RuntimeApi::steer,
        retained: ComposerSubmission? = null) {
        val store = AgentStore("synthetic-no-credentials", compose.activity)
        session = ChatSession("synthetic-no-credentials", "ui-team", "fixture", transfers = transfers, steerRuntime = steer)
        compose.runOnIdle {
            state(store, "selectedTeam", Team("ui-team", "UI fixture"))
            state(session, "loaded", true)
            state(session, "messages", listOf(assistant.copy(parts = parts)))
            metadata(snapshot, native, readOnly)
            if (retained != null) {
                state(session, "uploadDraft", retained)
                state(session, "uploadError", "Fixture upload failed. Retry the retained message.")
            }
            @Suppress("UNCHECKED_CAST")
            val sessions = AgentStore::class.java.getDeclaredField("sessions").also { it.isAccessible = true }.get(store) as MutableMap<Any, ChatSession>
            val keyType = Class.forName("ai.nuphos.android.session.AgentStore\$SessionKey")
            val key = keyType.getDeclaredConstructor(String::class.java, String::class.java).also { it.isAccessible = true }.newInstance("ui-team", "fixture")
            sessions[key] = session
            val app = compose.activity.application as NuphosApplication
            val auth = AuthSession(app, app.tokenStore)
            AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, fixtureToken)
            state(auth, "state", AuthSession.State.SignedIn(NuphosUser("runtime-fixture", "runtime@example.invalid", "Runtime fixture")))
            compose.activity.setContent {
                NuphosTheme {
                    CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                        ConversationScreen("fixture", false, {}, rememberNavController())
                    }
                }
            }
        }
        compose.onNodeWithContentDescription("Back").assertIsDisplayed()
    }
    private fun submit(text: String) {
        compose.onNodeWithContentDescription("Ask Nuphos anything").performTextInput(text)
        compose.onNodeWithContentDescription("Send").assertIsEnabled().performClick()
    }
    private fun assertNoMutations() = Assert.assertTrue(requests.none { it.method != "GET" })

    @Test fun nativeStatusAndFreshnessControlTheActualComposer() {
        render(snapshot(phase = "idle", label = "Must not show idle", send = true))
        compose.onNodeWithContentDescription("Ask Nuphos anything").performTextInput("Keep runtime draft")
        compose.onNodeWithContentDescription("Send").assertIsEnabled()
        compose.onNodeWithText("Must not show idle").assertDoesNotExist()
        compose.runOnIdle { metadata(snapshot(cancel = true)) }
        compose.onNodeWithText("Running fixture").assertIsDisplayed()
        compose.onNodeWithText("Cancel run").assertIsDisplayed()
        compose.onNodeWithContentDescription("Send").assertIsNotEnabled()
        compose.runOnIdle { metadata(snapshot(phase = "awaiting-input", label = "Waiting for fixture input", reply = true)) }
        compose.onNodeWithText("Waiting for fixture input").assertIsDisplayed()
        compose.onNodeWithContentDescription("Send").assertIsEnabled()
        compose.runOnIdle { metadata(snapshot(phase = "completed", label = "Fixture completed", send = true)) }
        compose.onNodeWithText("Fixture completed").assertIsDisplayed()
        compose.onNodeWithContentDescription("Send").assertIsEnabled()
        compose.runOnIdle {
            state(session, "runtimeObservation", RuntimeObservation(snapshot(send = true, reply = true, cancel = true), RuntimeObservation.now() - 20))
            state(session, "observationClock", RuntimeObservation.now())
        }
        compose.onNodeWithText("Runtime status unavailable — reconnecting").assertIsDisplayed()
        compose.onNodeWithContentDescription("Send").assertIsNotEnabled()
        compose.onNodeWithText("Cancel run").assertDoesNotExist()
        compose.runOnIdle { metadata(snapshot(schema = 99, send = true, reply = true, cancel = true)) }
        compose.onNodeWithText("Runtime status unavailable — runtime update required").assertIsDisplayed()
        compose.onNodeWithContentDescription("Send").assertIsNotEnabled()
        compose.onNodeWithText("Cancel run").assertDoesNotExist()
        compose.runOnIdle { metadata(snapshot(reply = true, steer = true, cancel = true), actor = false) }
        compose.onNodeWithText("Running fixture").assertIsDisplayed()
        compose.onNodeWithContentDescription("Send").assertIsNotEnabled()
        compose.onNodeWithText("Cancel run").assertDoesNotExist()
        compose.onNodeWithText("Keep runtime draft").assertExists()
        assertNoMutations()
    }
    @Test fun readOnlyNativeStatusRemainsVisibleWithoutActions() {
        render(snapshot(reply = true, steer = true, cancel = true), readOnly = true)
        compose.onNodeWithText("Running fixture").assertIsDisplayed()
        compose.onNodeWithText("Read-only chat").assertIsDisplayed()
        compose.onNodeWithContentDescription("Ask Nuphos anything").performTextInput("Read-only retained text")
        compose.onNodeWithContentDescription("Send").assertIsNotEnabled()
        compose.onNodeWithText("Cancel run").assertDoesNotExist()
        assertNoMutations()
    }
    private fun approvalTool() = ChatPart.Tool("ui-tool", "terminal", false, ChatPart.Tool.State.ApprovalRequested,
        input = JsonValue.obj("command" to JsonValue.Str("printf UI_FIXTURE")),
        title = "Fixture approval", approval = ChatPart.Tool.Approval("ui-approval", source = "openab"))
    @Test fun staleAndUnsupportedApprovalControlsSendNoDecision() {
        render(snapshot(phase = "awaiting-input", label = "Waiting for approval", reply = true), parts = listOf(approvalTool()))
        compose.runOnIdle {
            state(session, "runtimeObservation", RuntimeObservation(snapshot(reply = true), RuntimeObservation.now() - 20))
            state(session, "observationClock", RuntimeObservation.now())
        }
        compose.onNodeWithText("Approve once").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithText("Deny").assertIsNotEnabled()
        compose.runOnIdle { metadata(snapshot(schema = 99, reply = true)) }
        compose.onNodeWithText("Approve once").assertIsNotEnabled()
        compose.onNodeWithText("Deny").assertIsNotEnabled()
        assertNoMutations()
    }
    private fun approval(approved: Boolean) {
        render(snapshot(phase = "awaiting-input", label = "Waiting for approval", reply = true), parts = listOf(approvalTool()))
        compose.onNodeWithText(if (approved) "Approve once" else "Deny").performScrollTo().performClick()
        compose.waitUntil(10_000) { chats.isNotEmpty() && !session.isStreaming }
        val body = chats.single().body
        Assert.assertEquals("fixture", body["id"]?.stringValue)
        Assert.assertEquals("ui-team", body["teamId"]?.stringValue)
        Assert.assertEquals("approval-decision", body["resumeReason"]?.stringValue)
        val wireTool = body["messages"]!!.arrayValue!!.flatMap { it["parts"]!!.arrayValue!! }.single { it["toolCallId"]?.stringValue == "ui-tool" }
        Assert.assertEquals("approval-responded", wireTool["state"]?.stringValue)
        Assert.assertEquals("ui-approval", wireTool["approval"]?.get("id")?.stringValue)
        Assert.assertEquals(approved, wireTool["approval"]?.get("approved")?.boolValue)
        Assert.assertFalse(requests.any { it.method == "PUT" || (it.method != "GET" && (it.path.contains("policy") || it.path.contains("approve-for-session"))) })
    }
    @Test fun exactApprovalTargetCannotApproveAnotherPendingTool() {
        val safe = approvalTool().copy(toolCallId = "safe-first", input = JsonValue.obj("command" to JsonValue.Str("ls ./uploads")))
        val unsafe = approvalTool().copy(toolCallId = "unsafe-last", toolName = "Write",
            input = JsonValue.obj("file_path" to JsonValue.Str("./uploads/fixture.txt"), "content" to JsonValue.Str("must never write")))
        render(snapshot(phase = "awaiting-input", reply = true), parts = listOf(safe, unsafe))
        Assert.assertTrue(ScopedFileReadApproval.permits(safe, "ui-team", emptySet(), emptySet()))
        val target = listOf(safe, unsafe).firstOrNull { tool ->
            compose.onAllNodes(hasTestTag("approve-once:${tool.toolCallId}") and isEnabled()).fetchSemanticsNodes().isNotEmpty()
        }
        Assert.assertEquals("Only the actual current UI tool can be selected", unsafe.toolCallId, target?.toolCallId)
        Assert.assertFalse(ScopedFileReadApproval.permits(target!!, "ui-team", emptySet(), emptySet()))
        compose.onNodeWithTag("approve-once:safe-first").assertDoesNotExist()
        assertNoMutations()
    }
    @Test fun approveOnceButtonSendsOnlyItsScopedDecision() = approval(true)
    @Test fun denyButtonSendsOnlyItsScopedDecision() = approval(false)

    @Test fun nativeReplyComposerUsesRuntimeReplyWire() {
        render(snapshot(phase = "awaiting-input", label = "Waiting for reply", reply = true))
        submit("UI fixture runtime reply")
        compose.waitUntil(10_000) { chats.isNotEmpty() && !session.isStreaming }
        Assert.assertEquals("runtime-reply", chats.single().body["resumeReason"]?.stringValue)
        Assert.assertTrue(chats.single().body.compact.contains("UI fixture runtime reply"))
        Assert.assertFalse(requests.any { it.method == "PUT" })
    }
    @Test fun cancelRunButtonKeepsAcknowledgementSeparateFromStopped() {
        render(snapshot(cancel = true))
        compose.onNodeWithText("Cancel run").performClick()
        compose.waitUntil(10_000) { requests.any { it.path.endsWith("/cancel-runtime") } }
        compose.onNodeWithText("Cancellation requested").assertIsDisplayed()
        compose.onNodeWithText("Running fixture").assertIsDisplayed()
        compose.onNodeWithText("Cancel run").assertDoesNotExist()
        compose.onNodeWithText("Stopped", substring = true).assertDoesNotExist()
        Assert.assertFalse(session.stoppedByUser)
        Assert.assertEquals(1, requests.count { it.path.endsWith("/cancel-runtime") })
        Assert.assertTrue(chats.isEmpty())
    }
    @Test fun steeringComposerQueuesInOrderAndRemovesOnlyUnsentTail() {
        val first = CompletableDeferred<String>()
        val second = CompletableDeferred<String>()
        val calls = CopyOnWriteArrayList<String>()
        render(snapshot(steer = true), steer = { _, _, _, text ->
            calls += text
            if (text == "first") first.await() else second.await()
        })
        submit("first")
        compose.waitUntil(10_000) { calls.size == 1 }
        submit("next")
        submit("tail")
        Assert.assertEquals(listOf("first", "next", "tail"), session.queued)
        compose.onNodeWithText("first").assertIsDisplayed()
        compose.onNodeWithText("next").assertIsDisplayed()
        compose.onAllNodesWithText("×")[0].performClick()
        Assert.assertEquals(listOf("first", "next", "tail"), session.queued)
        compose.onAllNodesWithText("×")[2].performClick()
        compose.onNodeWithText("tail").assertDoesNotExist()
        Assert.assertEquals(listOf("first", "next"), session.queued)
        Assert.assertEquals(listOf("first"), calls.toList())
        first.complete("ui-receipt-first")
        compose.waitUntil(10_000) { calls.size == 2 && session.queued == listOf("next") }
        second.complete("ui-receipt-second")
        compose.waitUntil(10_000) { session.queued.isEmpty() }
        Assert.assertEquals(listOf("first", "next"), calls.toList())
        val receipts = session.messages.flatMap { it.parts }.filterIsInstance<ChatPart.Data>().filter { it.name == "steering" }
        Assert.assertEquals(listOf("ui-receipt-first", "ui-receipt-second"), receipts.map { it.data["id"]?.stringValue })
        Assert.assertEquals(listOf("first", "next"), receipts.map { it.data["text"]?.stringValue })
        Assert.assertTrue(chats.isEmpty())
    }
    @Test fun legacyComposerStillSendsThroughChat() {
        render(snapshot = null, native = false)
        submit("Legacy UI fixture")
        compose.waitUntil(10_000) { chats.isNotEmpty() && !session.isStreaming }
        Assert.assertTrue(chats.single().body.compact.contains("Legacy UI fixture"))
        compose.onNodeWithText("Cancel run").assertDoesNotExist()
    }

    private fun retained() = ComposerSubmission("Read the retained fixture", listOf(ComposerAttachment(
        name = "marker.txt", kind = ComposerAttachment.Kind.File("secret-file-marker".toByteArray(), "text/plain"))))
    @Test fun retainedUploadProgressFailureAndRetryUseActualButtons() {
        val transport = ByteTransferFixture()
        val draft = retained()
        render(transfers = AttachmentTransfers(transport), retained = draft)
        compose.onNodeWithText("Read the retained fixture").assertIsDisplayed()
        compose.onNodeWithText("marker.txt").assertIsDisplayed()
        compose.onNodeWithText("Retry attachment message").performClick()
        compose.waitUntil(10_000) { transport.puts == 1 }
        compose.onNodeWithText("Uploading 5 / 18 bytes").assertIsDisplayed()
        compose.onNodeWithText("Cancel upload").assertIsDisplayed()
        compose.onNodeWithContentDescription("Send").assertIsNotEnabled()
        transport.release.complete(Unit)
        compose.waitUntil(10_000) { session.uploadError != null && !session.uploadBusy }
        compose.onNodeWithText("Some attachments are not ready. Retry the retained batch.").assertIsDisplayed()
        compose.onNodeWithText("Read the retained fixture").assertIsDisplayed()
        compose.onNodeWithText("marker.txt").assertIsDisplayed()
        Assert.assertEquals(draft, session.uploadDraft)
        Assert.assertTrue(chats.isEmpty())
        transport.ready = true
        compose.onNodeWithText("Retry attachment message").assertIsEnabled().performClick()
        compose.waitUntil(10_000) { chats.isNotEmpty() && !session.isStreaming }
        Assert.assertEquals(1, transport.intents)
        Assert.assertEquals(1, transport.puts)
        Assert.assertEquals(listOf(transport.group), transport.groups.toList())
        Assert.assertEquals(1, chats.size)
        Assert.assertEquals("fixture", chats.single().body["id"]?.stringValue)
        Assert.assertEquals("ui-team", chats.single().body["teamId"]?.stringValue)
        val wire = chats.single().body.compact
        Assert.assertTrue(wire.contains(transport.group) && wire.contains("transfer-pull.sh"))
        Assert.assertTrue(wire.contains("Read the retained fixture"))
        Assert.assertFalse(wire.contains("secret-file-marker"))
        Assert.assertNull(session.uploadDraft)
    }
    @Test fun cancelUploadRetainsDraftAndRemoveButtonDiscardsIt() {
        val transport = ByteTransferFixture()
        val draft = retained()
        render(transfers = AttachmentTransfers(transport), retained = draft)
        compose.onNodeWithText("Retry attachment message").performClick()
        compose.waitUntil(10_000) { transport.puts == 1 }
        compose.onNodeWithText("Uploading 5 / 18 bytes").assertIsDisplayed()
        compose.onNodeWithText("Cancel upload").performClick()
        compose.onNodeWithText("Upload cancelled. Your message and files are retained.").assertIsDisplayed()
        compose.onNodeWithText("Read the retained fixture").assertIsDisplayed()
        compose.onNodeWithText("marker.txt").assertIsDisplayed()
        compose.onNodeWithText("Files ready").assertDoesNotExist()
        Assert.assertEquals(draft, session.uploadDraft)
        Assert.assertFalse(session.uploadBusy)
        transport.release.complete(Unit)
        compose.waitForIdle()
        Assert.assertTrue(chats.isEmpty())
        compose.onNodeWithText("Remove attachment message").performClick()
        compose.onNodeWithText("Read the retained fixture").assertDoesNotExist()
        compose.onNodeWithText("marker.txt").assertDoesNotExist()
        compose.onNodeWithText("Retry attachment message").assertDoesNotExist()
        Assert.assertNull(session.uploadDraft)
        Assert.assertTrue(chats.isEmpty())
    }
    private class ByteTransferFixture : AttachmentTransfers.Transport {
        val group = "0123456789abcdef01234567"
        val groups = CopyOnWriteArrayList<String>()
        val release = CompletableDeferred<Unit>()
        @Volatile var ready = false
        @Volatile var intents = 0
        @Volatile var puts = 0
        override suspend fun api(method: String, path: String, token: String, body: JsonValue?): String {
            if (path.endsWith("file-transfers")) {
                intents++
                groups += group
                return """{"groupId":"$group","direction":"upload","status":"pending","expiresAt":"2099-01-01T00:00:00Z","files":[{"id":"f","fileName":"marker.txt","relPath":"1-marker.txt","uploadUrl":"https://storage.example/file","expiresAt":"2099-01-01T00:00:00Z"}]}"""
            }
            Assert.assertTrue(path.contains(group))
            return """{"groupId":"$group","direction":"upload","status":"${if (ready) "ready" else "partial"}","expiresAt":"2099-01-01T00:00:00Z","files":[{"id":"f","fileName":"marker.txt","relPath":"1-marker.txt","status":"ready","size":18}]}"""
        }
        override suspend fun put(url: String, mime: String, bytes: ByteArray, pending: AttachmentTransfers.Pending, progress: (Long) -> Unit) {
            puts++
            Assert.assertEquals("secret-file-marker", bytes.toString(Charsets.UTF_8))
            progress(5)
            release.await()
            progress(bytes.size.toLong())
        }
    }
}
