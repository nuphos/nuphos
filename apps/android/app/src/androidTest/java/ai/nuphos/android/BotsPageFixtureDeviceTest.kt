package ai.nuphos.android

import android.content.ContextWrapper
import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** The Bots page against synthetic listings and writes. */
@RunWith(AndroidJUnit4::class)
class BotsPageFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val token = "synthetic-bots-page"
    private val teamA = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A")
    private val teamB = Team("bbbbbbbbbbbbbbbbbbbbbbbb", "Fixture B")
    private val writes = CopyOnWriteArrayList<String>()
    private val added = CopyOnWriteArrayList<String>()
    private val originals = mutableMapOf<String, OkHttpClient>()
    private lateinit var store: AgentStore
    private var savedAccess: Any? = null
    @Volatile private var chats = ""
    @Volatile private var history = ""
    @Volatile private var failAddingBot = false
    @Volatile private var failCreatingBot = false
    @Volatile private var noRuntimes = false
    private val created = CopyOnWriteArrayList<Pair<String, String>>()
    @Volatile private var channelHeld: CountDownLatch? = null
    private val channelEntered = CountDownLatch(1)

    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>

    private fun bot(id: String, title: String, at: String) =
        """{"sessionId":"$id","title":"$title","avatar":"05-rembrandt","agentRuntime":"codex","lastActiveAt":"$at"}"""
    private val oneOnOne = """{"sessionId":"chat-bot","title":"Ada","kind":"channel","lastActiveAt":"2026-11-03T12:30:00Z",""" +
        """"faces":[{"id":"bot-chatted","name":"Ada","agent":{"avatar":"07-ada"}}],"lastMessage":{"text":"Ready when you are"}}"""
    private val group = """{"sessionId":"chat-group","title":"Launch","kind":"channel","lastActiveAt":"2026-11-03T12:00:00Z",""" +
        """"faces":[{"id":"p1","name":"Diana"},{"id":"p2","name":"Bruce"}],"lastMessage":{"text":"Shipping today","from":"Diana"}}"""

    @Before fun before() {
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        val context = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("bots-page-fixture", mode)
        }
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val path = request.url.encodedPath
            if (request.method != "GET") writes += "${request.method} $path"
            val body = when {
                request.method == "GET" && path.endsWith("/agent-runtimes") ->
                    if (noRuntimes) """{"runtimes":[]}"""
                    else """{"runtimes":[{"id":"r1","provider":"codex","label":"Synthetic runtime","status":"active","kind":"managed"}]}"""
                request.method == "POST" && path == "/agent/bots" -> {
                    if (failCreatingBot) return@addInterceptor Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
                        .code(500).message("fixture").body("""{"error":{"message":"Synthetic failure"}}""".toResponseBody(Http.jsonMedia)).build()
                    val sent = ai.nuphos.android.data.JsonValue.parse(okio.Buffer().also { request.body?.writeTo(it) }.readUtf8())
                    created += sent?.get("title")?.stringValue.orEmpty() to sent?.get("avatar")?.stringValue.orEmpty()
                    """{"sessionId":"bot-new","title":"Grace","avatar":"07-ada"}"""
                }
                request.method == "POST" && path == "/agent/channels" -> {
                    channelEntered.countDown()
                    channelHeld?.let { check(it.await(10, TimeUnit.SECONDS)) }
                    """{"sessionId":"chat-new"}"""
                }
                request.method == "POST" && path.endsWith("/agents") -> {
                    val sent = okio.Buffer().also { request.body?.writeTo(it) }.readUtf8()
                    added += ai.nuphos.android.data.JsonValue.parse(sent)?.get("sessionId")?.stringValue.orEmpty()
                    if (failAddingBot) return@addInterceptor Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
                        .code(500).message("fixture").body("""{"error":{"message":"Synthetic failure"}}""".toResponseBody(Http.jsonMedia)).build()
                    chats = """{"sessionId":"chat-new","title":"Grace","kind":"channel","lastActiveAt":"2026-11-03T13:00:00Z",""" +
                        """"faces":[{"id":"bot-waiting","name":"Grace","agent":{"avatar":"05-rembrandt"}}]}"""
                    "{}"
                }
                path == "/agent/conversations" && request.url.queryParameter("kind") == "channel" ->
                    if (request.url.queryParameter("scope") == "mine") """{"conversations":[$chats],"hasMore":false}"""
                    else """{"conversations":[],"hasMore":false}"""
                path == "/agent/conversations" -> """{"conversations":[$history],"hasMore":false}"""
                else -> "{}"
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .body(body.toResponseBody(Http.jsonMedia)).build()
        }.build()
        for (name in listOf("client", "chatClient")) {
            val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
            originals[name] = field.get(null) as OkHttpClient
            field.set(null, client)
        }
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            savedAccess = access().value
            AiAccess.activate(token); AiAccess.grant(token)
            store = AgentStore(token, context)
            store.acceptMemberships(listOf(teamA, teamB), teamA.id)
        }
    }

    @After fun after() {
        channelHeld?.countDown()
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            if (::store.isInitialized) store.disposeForConsent()
            access().value = savedAccess
        }
        originals.forEach { (name, client) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client) }
    }

    private fun render() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
        val auth = ai.nuphos.android.session.AuthSession(app, app.tokenStore)
        compose.setContent {
            NuphosTheme { CompositionLocalProvider(LocalAgentStore provides store, ai.nuphos.android.ui.LocalAuthSession provides auth) {
                val nav = rememberNavController()
                NavHost(nav, startDestination = "list") {
                    composable("list") { ChatsPage(nav) }
                    composable("channel/{id}") { entry -> Text("Opened ${entry.arguments?.getString("id")}") }
                }
            } }
        }
        compose.runOnIdle { store.refresh() }
    }
    private fun row(id: String) = compose.onNodeWithTag("chat-row:$id")
    private fun waitRow(id: String) = compose.waitUntil(8_000) { compose.onAllNodesWithTag("chat-row:$id").fetchSemanticsNodes().isNotEmpty() }
    private fun waitText(text: String) = compose.waitUntil(8_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
    private fun posts(suffix: String) = writes.count { it.startsWith("POST") && it.endsWith(suffix) }

    @Test fun listsChatsAndABotWithoutOneNewestFirstWithTheirPreviews() {
        chats = "$oneOnOne,$group"
        history = bot("bot-chatted", "Ada", "2026-11-03T13:30:00Z") + "," + bot("bot-waiting", "Grace", "2026-11-03T12:15:00Z") +
            "," + """{"sessionId":"a-task","title":"A task","lastActiveAt":"2026-11-03T14:00:00Z"}"""
        render()
        waitRow("bot-waiting")
        waitRow("chat-group")
        compose.waitForIdle()
        val tops = listOf("chat-bot", "bot-waiting", "chat-group").map { row(it).fetchSemanticsNode().boundsInRoot.top }
        assertEquals("Newest first", tops.sorted(), tops)
        row("bot-chatted").assertDoesNotExist()
        row("a-task").assertDoesNotExist()
        compose.onNodeWithText("Ready when you are").assertExists()
        compose.onNodeWithText("Diana: Shipping today").assertExists()
    }

    @Test fun aChatOpensWithoutWritingAnything() {
        chats = group
        render()
        waitRow("chat-group")
        row("chat-group").performClick()
        waitText("Opened chat-group")
        assertTrue(writes.toString(), writes.none { it.startsWith("POST") })
    }

    @Test fun aBotWithoutAChatStaysOnTheListWhileItsChatIsMadeOnce() {
        history = bot("bot-waiting", "Grace", "2026-11-03T12:15:00Z")
        val release = CountDownLatch(1)
        channelHeld = release
        render()
        waitRow("bot-waiting")
        row("bot-waiting").performClick()
        assertTrue(channelEntered.await(5, TimeUnit.SECONDS))
        compose.waitForIdle()
        // Still on the list, and a second tap doesn't make another chat.
        row("bot-waiting").assertExists().assertIsNotEnabled()
        compose.runOnIdle { release.countDown() }
        waitText("Opened chat-new")
        assertEquals(1, posts("/agent/channels"))
        assertEquals(1, posts("/agents"))
    }

    @Test fun aFailureSaysSoAndTryingAgainUsesTheSameChat() {
        history = bot("bot-waiting", "Grace", "2026-11-03T12:15:00Z")
        failAddingBot = true
        render()
        waitRow("bot-waiting")
        row("bot-waiting").performClick()
        waitText("Couldn't open this Bot. Try again.")
        compose.onNodeWithText("Opened chat-new").assertDoesNotExist()
        failAddingBot = false
        compose.onNodeWithText("Try again").performClick()
        waitText("Opened chat-new")
        assertEquals("One chat", 1, posts("/agent/channels"))
        assertEquals("Added twice to it", 2, posts("/agents"))
    }

    @Test fun tryingAgainMeansTheBotThatFailedNotTheLastRowTapped() {
        history = bot("bot-waiting", "Grace", "2026-11-03T12:15:00Z") + "," + bot("bot-other", "Hopper", "2026-11-03T12:10:00Z")
        val release = CountDownLatch(1)
        channelHeld = release
        failAddingBot = true
        render()
        waitRow("bot-waiting")
        waitRow("bot-other")
        row("bot-waiting").performClick()
        assertTrue(channelEntered.await(5, TimeUnit.SECONDS))
        // Tapped while the first is still being made: this one mustn't take over the failure.
        row("bot-other").performClick()
        compose.runOnIdle { release.countDown() }
        waitText("Couldn't open this Bot. Try again.")
        assertEquals(listOf("bot-waiting"), added.toList())
        failAddingBot = false
        compose.onNodeWithText("Try again").performClick()
        waitText("Opened chat-new")
        assertEquals(listOf("bot-waiting", "bot-waiting"), added.toList())
        assertEquals("One chat", 1, posts("/agent/channels"))
    }

    @Test fun switchingTeamWhileAChatIsMadeOpensNothing() {
        history = bot("bot-waiting", "Grace", "2026-11-03T12:15:00Z")
        val release = CountDownLatch(1)
        channelHeld = release
        render()
        waitRow("bot-waiting")
        row("bot-waiting").performClick()
        assertTrue(channelEntered.await(5, TimeUnit.SECONDS))
        compose.runOnIdle { store.select(teamB) }
        compose.runOnIdle { release.countDown() }
        Thread.sleep(800); compose.waitForIdle()
        compose.onNodeWithText("Opened chat-new").assertDoesNotExist()
        assertEquals("The Bot wasn't added after the team changed", 0, posts("/agents"))
    }

    @Test fun anEmptyPageStillOffersPlus() {
        render()
        compose.waitUntil(8_000) { compose.onAllNodesWithContentDescription("New Bot").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("New Bot").assertIsEnabled()
    }

    private fun openSheet() {
        compose.waitUntil(8_000) { compose.onAllNodesWithContentDescription("New Bot").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("New Bot").performClick()
        waitText("Create")
    }
    private fun nameField() = compose.onNodeWithTag("new-bot-name")
    private fun create() = compose.onNodeWithText("Create")

    @Test fun createNeedsAValidNameAndSaysWhatTheBotGets() {
        render()
        openSheet()
        compose.onNodeWithText("A new Bot starts with full access, so it can act without asking first.").assertExists()
        create().assertIsNotEnabled()
        nameField().performTextInput("   ")
        create().assertIsNotEnabled()
        nameField().performTextReplacement("x".repeat(121))
        create().assertIsNotEnabled()
        nameField().performTextReplacement("  " + "x".repeat(120) + "  ")
        create().assertIsEnabled()
        assertEquals(0, posts("/agent/bots"))
    }

    @Test fun aWorkspaceWithNoRuntimeMakesNoBotAndSaysWhy() {
        noRuntimes = true
        render()
        openSheet()
        nameField().performTextInput("Grace")
        create().performClick()
        waitText("This workspace has no runtime yet. Add one on the Runtimes page, then create your Bot.")
        assertEquals("No Bot", 0, posts("/agent/bots"))
        assertEquals("No chat", 0, posts("/agent/channels"))
        nameField().assertTextContains("Grace")
        // Once there's a runtime, the same sheet works.
        noRuntimes = false
        create().performClick()
        waitText("Opened chat-new")
        assertEquals(1, posts("/agent/bots"))
    }

    @Test fun aNewBotSendsItsNameAndFaceAndOpensItsChat() {
        render()
        openSheet()
        nameField().performTextInput("  Grace  ")
        compose.onNodeWithTag("new-bot-face:07-ada").performScrollTo().performClick()
        create().performClick()
        waitText("Opened chat-new")
        assertEquals(1, posts("/agent/bots"))
        assertEquals(listOf("Grace" to "07-ada"), created.toList())
        assertEquals(listOf("bot-new"), added.toList())
        compose.onNodeWithTag("new-bot-sheet").assertDoesNotExist()
    }

    @Test fun aRefusedBotKeepsTheSheetAndTryingAgainOpensTheChat() {
        render()
        openSheet()
        nameField().performTextInput("Grace")
        compose.onNodeWithTag("new-bot-face:07-ada").performScrollTo().performClick()
        failCreatingBot = true
        create().performClick()
        waitText("Couldn't create this Bot. Try again.")
        // What was picked is still there, and the list didn't change underneath.
        nameField().assertTextContains("Grace")
        compose.onNodeWithTag("new-bot-face:07-ada").assertIsSelected()
        failCreatingBot = false
        create().performClick()
        waitText("Opened chat-new")
        assertEquals(listOf("Grace" to "07-ada"), created.toList())
    }

    @Test fun aChatThatFailsAfterTheBotExistsDoesNotMakeASecondBot() {
        render()
        openSheet()
        nameField().performTextInput("Grace")
        failAddingBot = true
        create().performClick()
        waitText("The Bot was created, but its chat didn't open. Try again.")
        nameField().assertIsNotEnabled()
        failAddingBot = false
        create().performClick()
        waitText("Opened chat-new")
        assertEquals("One Bot", 1, posts("/agent/bots"))
        assertEquals("One chat", 1, posts("/agent/channels"))
    }

    @Test fun switchingTeamWhileABotIsMadeOpensNothing() {
        val release = CountDownLatch(1)
        channelHeld = release
        render()
        openSheet()
        nameField().performTextInput("Grace")
        create().performClick()
        assertTrue(channelEntered.await(5, TimeUnit.SECONDS))
        compose.runOnIdle { store.select(teamB) }
        compose.runOnIdle { release.countDown() }
        Thread.sleep(800); compose.waitForIdle()
        compose.onNodeWithText("Opened chat-new").assertDoesNotExist()
        assertEquals(0, posts("/agents"))
    }
}
