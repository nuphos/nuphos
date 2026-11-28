package ai.nuphos.android

import android.content.ContextWrapper
import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.Team
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.chats.ChatsPage
import ai.nuphos.android.ui.theme.NuphosTheme
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList

/** Real store and page, with synthetic team-scoped HTTP so previews cannot touch real conversations. */
@RunWith(AndroidJUnit4::class)
class BotPinsFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val token = "synthetic-bot-pins"
    private val team = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture")
    private lateinit var store: AgentStore
    private val originals = mutableMapOf<String, OkHttpClient>()
    private var savedAccess: Any? = null
    private val writes = CopyOnWriteArrayList<String>()
    @Volatile private var revision = 1
    @Volatile private var entries = JsonValue.parse("""[{"label":"Older","href":"/teams/aaaaaaaaaaaaaaaaaaaaaaaa/agent/older"},{"label":"Legacy Task","key":"agent-session:task"},{"label":"Docs","href":"/docs"}]""")!!
    private val rows = """{"conversations":[
        {"sessionId":"newer","title":"Newer","kind":"channel","lastActiveAt":"2026-11-19T12:00:00Z","lastMessage":{"text":"Latest reply"}},
        {"sessionId":"older","title":"Older","kind":"channel","lastActiveAt":"2026-11-18T12:00:00Z","lastMessage":{"text":"Read-only preview"},"activitySeq":2,"readSeq":1,"unread":true}],"hasMore":false}"""

    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>

    @Before fun before() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext
        val context = object : ContextWrapper(app) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("pins-fixture", mode)
        }
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val path = request.url.encodedPath
            if (request.method != "GET") writes += "${request.method} $path"
            val body = when {
                path.endsWith("/favorites") -> {
                    if (request.method == "PUT") {
                        val sent = JsonValue.parse(okio.Buffer().also { request.body!!.writeTo(it) }.readUtf8())!!
                        check(sent["expectedRevision"]?.numberValue == revision.toDouble())
                        entries = sent["entries"]!!; revision++
                    }
                    """{"entries":${entries.compact},"revision":$revision}"""
                }
                path.endsWith("/agent-runtimes") -> """{"runtimes":[{"id":"r1","provider":"codex","label":"Fixture","status":"active","kind":"managed"}]}"""
                path == "/agent/conversations" && request.url.queryParameter("kind") == "channel" && request.url.queryParameter("scope") == "mine" -> rows
                path == "/agent/conversations" -> """{"conversations":[],"hasMore":false}"""
                else -> "{}"
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .body(body.toResponseBody(Http.jsonMedia)).build()
        }.build()
        for (name in listOf("client", "chatClient")) {
            val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
            originals[name] = field.get(null) as OkHttpClient; field.set(null, client)
        }
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            savedAccess = access().value
            AiAccess.activate(token); AiAccess.grant(token)
            store = AgentStore(token, context)
            store.acceptMemberships(listOf(team), team.id)
        }
        compose.setContent {
            NuphosTheme { CompositionLocalProvider(LocalAgentStore provides store) {
                val nav = rememberNavController()
                NavHost(nav, startDestination = "list") {
                    composable("list") { ChatsPage(nav) }
                    composable("channel/{id}") { Text("Opened ${it.arguments?.getString("id")}") }
                }
            } }
        }
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("pinned-bot:older").fetchSemanticsNodes().isNotEmpty() }
    }

    @After fun after() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            if (::store.isInitialized) store.disposeForConsent()
            access().value = savedAccess
        }
        originals.forEach { (name, client) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client) }
    }

    private fun shot(name: String) {
        compose.waitForIdle()
        val instrument = InstrumentationRegistry.getInstrumentation()
        instrument.waitForIdleSync()
        val image = instrument.uiAutomation.takeScreenshot() ?: error("No screenshot")
        val dir = java.io.File(instrument.targetContext.getExternalFilesDir(null), "review-bot-pins").apply { mkdirs() }
        java.io.File(dir, "$name.png").outputStream().use { image.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        image.recycle()
    }

    private fun assertPreviewInset() {
        val node = compose.onNodeWithTag("bot-conversation-preview").fetchSemanticsNode()
        val coordinates = node.layoutInfo.coordinates
        val origin = coordinates.localToScreen(androidx.compose.ui.geometry.Offset.Zero)
        val bounds = androidx.compose.ui.geometry.Rect(origin, androidx.compose.ui.geometry.Size(coordinates.size.width.toFloat(), coordinates.size.height.toFloat()))
        val density = instDensity()
        val width = InstrumentationRegistry.getInstrumentation().targetContext.resources.displayMetrics.widthPixels
        assertTrue("Left inset: $bounds", bounds.left >= 16 * density - 1)
        assertTrue("Right inset: $bounds", bounds.right <= width - 16 * density + 1)
    }

    private fun instDensity() = InstrumentationRegistry.getInstrumentation().targetContext.resources.displayMetrics.density

    @Test fun pinnedRowLeavesTheListAndUnpinBringsItBackInActivityOrder() {
        fun row(id: String) = compose.onNodeWithTag("chat-row:$id")
        fun listed(id: String) = compose.onAllNodesWithTag("chat-row:$id").fetchSemanticsNodes().isNotEmpty()
        fun assertOrder() = assertTrue(row("newer").fetchSemanticsNode().positionInRoot.y < row("older").fetchSemanticsNode().positionInRoot.y)
        // As on iOS and Desktop (#2703 item 12): a pinned chat sits in the shelf, not twice.
        assertFalse("A pinned chat must leave the Bots list", listed("older"))
        assertTrue(listed("newer"))
        shot("01-shelf")
        compose.onNodeWithTag("pinned-bot:older").performTouchInput { longClick() }
        compose.onNodeWithTag("bot-conversation-preview").assertExists()
        assertTrue(writes.isEmpty()) // Long press did not mark read or start a turn.
        assertPreviewInset()
        shot("02-unpin-preview")
        compose.onNodeWithTag("pin-action:older").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("pinned-bots-shelf").fetchSemanticsNodes().isEmpty() }
        compose.waitUntil(5_000) { !store.savingPins }
        // Unpinning brings the chat back to the list, in its activity place.
        compose.waitUntil(5_000) { listed("older") }
        assertOrder()
        row("newer").performTouchInput { longClick() }
        assertPreviewInset()
        shot("03-pin-menu")
        compose.onNodeWithTag("pin-action:newer").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("pinned-bot:newer").fetchSemanticsNodes().isNotEmpty() }
        // Pinning another chat takes that one out of the list.
        compose.waitUntil(5_000) { !listed("newer") }
        assertTrue(listed("older"))
        shot("04-pinned-newer")
        compose.waitUntil(5_000) { writes.size == 2 }
        assertEquals(listOf("PUT /teams/${team.id}/favorites", "PUT /teams/${team.id}/favorites"), writes.toList())
        assertEquals(listOf("Legacy Task", "Docs", "Newer"), entries.arrayValue!!.map { it["label"]?.stringValue })
    }

    @Test fun searchHidesShelfAndTileOpensItsOwnChat() {
        compose.runOnIdle { store.updateSearch("Newer") }
        compose.onNodeWithTag("pinned-bots-shelf").assertDoesNotExist()
        // Without the shelf, the results list every matching chat, pinned ones too.
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("chat-row:older").fetchSemanticsNodes().isNotEmpty() }
        shot("05-search")
        compose.runOnIdle { store.updateSearch("") }
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("pinned-bot:older").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("pinned-bot:older").performClick()
        compose.onNodeWithText("Opened older").assertExists()
        assertTrue(writes.isEmpty())
    }
}
