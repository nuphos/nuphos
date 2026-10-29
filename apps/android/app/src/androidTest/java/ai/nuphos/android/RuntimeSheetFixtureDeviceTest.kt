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
class RuntimeSheetFixtureDeviceTest {
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

    private var gate = java.util.concurrent.CountDownLatch(1)
    @Volatile private var catalogStatus = 200
    @Volatile private var catalogBody = """{"runtimes":[{"id":"cloud","provider":"codex","label":"Synthetic Cloud","status":"active","kind":"managed"},{"id":"local","provider":"codex","label":"Synthetic Computer","status":"active","kind":"local","local":{"online":true}}]}"""
    @Before fun blockNetwork() {
        require(compose.activity.packageName == "ai.nuphos.android.runtimesheet1375")
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
            if (request.url.encodedPath.endsWith("/agent-runtimes")) {
                check(gate.await(10, java.util.concurrent.TimeUnit.SECONDS)) { "Synthetic catalog gate timed out" }
                return@addInterceptor Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(catalogStatus).message("fixture").body(catalogBody.toResponseBody(Http.jsonMedia)).build()
            }
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
        gate.countDown()
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
            readOnly = readOnly, isOwner = owner, canManage = owner, runtimeLabel = "Synthetic Current Computer", runtimeId = "local", canCancelRun = actor, canRespondToRun = actor, runtimeState = snapshot)
        ChatSession::class.java.getDeclaredMethod("refreshMetadata", AgentConversationDetail::class.java, Double::class.javaPrimitiveType, Long::class.javaPrimitiveType)
            .also { it.isAccessible = true }.invoke(session, detail, observedAt, 0L)
    }
    private fun render(snapshot: JsonValue? = snapshot(send = true), native: Boolean = true, owner: Boolean = false, rtl: Boolean = false,
        readOnly: Boolean = false, parts: List<ChatPart> = assistant.parts,
        transfers: AttachmentTransfers = AttachmentTransfers(),
        steer: suspend (String, String, String, String) -> String = RuntimeApi::steer,
        retained: ComposerSubmission? = null) {
        val store = AgentStore("synthetic-no-credentials", compose.activity)
        session = ChatSession("synthetic-no-credentials", "507f1f77bcf86cd799439011", "fixture", transfers = transfers, steerRuntime = steer)
        compose.runOnIdle {
            state(store, "selectedTeam", Team("507f1f77bcf86cd799439011", "UI fixture"))
            state(session, "loaded", true)
            state(session, "messages", listOf(assistant.copy(parts = parts)))
            metadata(snapshot, native, readOnly, owner=owner)
            if (retained != null) {
                state(session, "uploadDraft", retained)
                state(session, "uploadError", "Fixture upload failed. Retry the retained message.")
            }
            @Suppress("UNCHECKED_CAST")
            val sessions = AgentStore::class.java.getDeclaredField("sessions").also { it.isAccessible = true }.get(store) as MutableMap<Any, ChatSession>
            val keyType = Class.forName("ai.nuphos.android.session.AgentStore\$SessionKey")
            val key = keyType.getDeclaredConstructor(String::class.java, String::class.java).also { it.isAccessible = true }.newInstance("507f1f77bcf86cd799439011", "fixture")
            sessions[key] = session
            val app = compose.activity.application as NuphosApplication
            val auth = AuthSession(app, app.tokenStore)
            AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, fixtureToken)
            state(auth, "state", AuthSession.State.SignedIn(NuphosUser("runtime-fixture", "runtime@example.invalid", "Runtime fixture")))
            compose.activity.setContent {
                NuphosTheme {
                    CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth,
                        androidx.compose.ui.platform.LocalLayoutDirection provides if (rtl) androidx.compose.ui.unit.LayoutDirection.Rtl else androidx.compose.ui.unit.LayoutDirection.Ltr,
                        androidx.compose.ui.platform.LocalDensity provides androidx.compose.ui.unit.Density(androidx.compose.ui.platform.LocalDensity.current.density, if (rtl) 2f else 1f)) {
                        ConversationScreen("fixture", false, {}, rememberNavController())
                    }
                }
            }
        }
        compose.onNodeWithContentDescription("Back").assertIsDisplayed()
    }
    private fun open() {
        compose.onNodeWithContentDescription("Runtime for this agent").performClick()
        compose.onNodeWithText("Runtime", useUnmergedTree = true).assertExists()
    }
    private fun box() = compose.onNodeWithTag("conversation-runtime-sheet").fetchSemanticsNode().boundsInWindow
    private fun shot(name: String) {
        val c = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext
        java.io.File(c.getExternalFilesDir(null), name).outputStream().use {
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)
        }
    }
    @Test fun loadingToCatalogKeepsOneHeightAcrossOpeningAndReopen() {
        render(snapshot(phase="completed",send=true), native=false, owner=true)
        open()
        val loading = box()
        shot("runtime-sheet-loading.png")
        gate.countDown()
        compose.waitUntil { compose.onAllNodesWithText("Synthetic Cloud").fetchSemanticsNodes().isNotEmpty() }
        val loaded = box()
        shot("runtime-sheet-loaded.png")
        Assert.assertEquals("Catalog changed the sheet height", loading.height, loaded.height, 2f)
        Assert.assertEquals("Catalog changed the settled sheet anchor", loading.top, loaded.top, 2f)
        compose.onNodeWithText("Done").performScrollTo().performClick()
        compose.onNodeWithTag("conversation-runtime-sheet").assertDoesNotExist()
        open()
        Assert.assertEquals(loaded.top,box().top,2f)
        androidx.test.espresso.Espresso.pressBack()
        compose.onNodeWithTag("conversation-runtime-sheet").assertDoesNotExist()
        Assert.assertTrue(requests.none { it.method != "GET" })
    }
    @Test fun errorEmptyRetryKeepTheSameHeight() {
        catalogStatus=503
        render(snapshot(phase="completed",send=true), native=false, owner=true)
        open()
        val loading=box()
        gate.countDown()
        compose.waitUntil { compose.onAllNodesWithText("Runtime request was rejected (503).").fetchSemanticsNodes().isNotEmpty() }
        Assert.assertEquals(loading.height,box().height,2f)
        catalogStatus=200; catalogBody="""{"runtimes":[]}"""
        compose.onNodeWithText("Refresh runtimes").performScrollTo().performClick()
        compose.waitUntil { compose.onAllNodesWithText("No available runtimes.").fetchSemanticsNodes().isNotEmpty() }
        Assert.assertEquals(loading.top,box().top,2f)
        shot("runtime-sheet-empty.png")
        Assert.assertTrue(requests.none { it.method != "GET" })
    }
    @Test fun everyOpeningFrameAndLateCatalogHaveOneSettledAnchor() {
        render(snapshot(phase="completed",send=true), native=false, owner=true)
        compose.mainClock.autoAdvance=false
        compose.onNodeWithContentDescription("Runtime for this agent").performClick()
        val trace=mutableListOf("phase,timeMs,topPx,heightPx")
        fun frames(phase: String) {
            repeat(50) {
                compose.mainClock.advanceTimeByFrame()
                Thread.sleep(5)
                compose.onAllNodesWithTag("conversation-runtime-sheet").fetchSemanticsNodes().firstOrNull()?.let {
                    val b=it.boundsInWindow
                    trace += "$phase,${compose.mainClock.currentTime},${b.top},${b.height}"
                }
            }
        }
        frames("opening-loading")
        val before=box()
        gate.countDown()
        frames("catalog-released")
        compose.mainClock.autoAdvance=true
        compose.waitUntil { compose.onAllNodesWithText("Synthetic Cloud").fetchSemanticsNodes().isNotEmpty() }
        val after=box()
        val c=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext
        java.io.File(c.getExternalFilesDir(null),"runtime-sheet-frames.csv").writeText(trace.joinToString("\n"))
        Assert.assertEquals("Late catalog moved the expanded anchor",before.top,after.top,2f)
        Assert.assertEquals("Late catalog resized the viewport",before.height,after.height,2f)
        Assert.assertTrue("A catalog frame moved the anchor", trace.drop(1).filter { it.startsWith("catalog-released,") }.all { kotlin.math.abs(it.split(',')[2].toFloat()-before.top)<=2f })
        val openingTops=trace.drop(1).filter { it.startsWith("opening-loading,") && it.split(',')[3].toFloat()>0f }.map { it.split(',')[2].toFloat() }
        // Material's native spring may overshoot by a few pixels; reject a second
        // half-screen transition, rather than requiring a linear animation.
        val rebound = openingTops.indices.maxOf { i -> openingTops.drop(i).maxOrNull()!! - openingTops[i] }
        Assert.assertTrue("Opening made a second large downward transition: $rebound", rebound < before.height * 0.05f)
    }
    @Test fun readOnlyDoesNotExposeMoves() {
        render(snapshot(phase="completed",send=true), native=false, owner=false, readOnly=true)
        open(); gate.countDown()
        compose.onNodeWithText("Switch runtime").assertDoesNotExist()
        compose.onNodeWithText("Done").performScrollTo().performClick()
        Assert.assertTrue(requests.none { it.method != "GET" })
    }

    @Test fun rtlLargeTextLocalConsentAndCancelStayInsideTheSheet() {
        catalogBody=catalogBody.replace("\"id\":\"local\"", "\"id\":\"other-local\"")
        render(snapshot(phase="completed",send=true), native=false, owner=true, rtl=true)
        open()
        val loading=box()
        gate.countDown()
        compose.waitUntil { compose.onAllNodesWithText("Synthetic Computer").fetchSemanticsNodes().isNotEmpty() }
        Assert.assertEquals(loading.top,box().top,2f)
        compose.onNodeWithText("Synthetic Computer").performScrollTo().performClick()
        compose.onNodeWithText("Move to Synthetic Computer?").assertIsDisplayed()
        compose.onNodeWithText("Cancel").performClick()
        compose.onNodeWithText("Move to Synthetic Computer?").assertDoesNotExist()
        shot("runtime-sheet-rtl-large.png")
        compose.onNodeWithText("Done").performScrollTo().performClick()
        Assert.assertTrue(requests.none { it.method != "GET" })
    }

}
