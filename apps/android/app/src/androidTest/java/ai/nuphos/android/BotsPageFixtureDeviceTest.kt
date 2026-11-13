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
import kotlinx.coroutines.cancel
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
    private val reads = CopyOnWriteArrayList<String>()
    private val added = CopyOnWriteArrayList<String>()
    private val originals = mutableMapOf<String, OkHttpClient>()
    private lateinit var store: AgentStore
    private var auth: ai.nuphos.android.session.AuthSession? = null
    private var savedAccess: Any? = null
    @Volatile private var avatarDetail: String? = null
    @Volatile private var chats = ""
    @Volatile private var history = ""
    @Volatile private var failAddingBot = false
    @Volatile private var failCreatingBot = false
    @Volatile private var noRuntimes = false
    @Volatile private var runtimesFail = false
    @Volatile private var runtimesHeld: CountDownLatch? = null
    private val runtimesEntered = CountDownLatch(1)
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
            if (request.method != "GET") writes += "${request.method} $path" else reads += path
            val body = when {
                request.method == "GET" && path == "/agent/conversations/chat-avatar" && avatarDetail != null -> avatarDetail!!
                path == "/agent/conversations/chat-avatar/agents" -> """{"agents":[]}"""

                request.method == "GET" && path.endsWith("/agent-runtimes") -> {
                    runtimesHeld?.let { runtimesEntered.countDown(); check(it.await(10, TimeUnit.SECONDS)) }
                    if (runtimesFail) return@addInterceptor Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
                        .code(500).message("fixture").body("""{"error":{"message":"Synthetic failure"}}""".toResponseBody(Http.jsonMedia)).build()
                    if (noRuntimes) """{"runtimes":[]}"""
                    else """{"runtimes":[{"id":"r1","provider":"codex","label":"Synthetic runtime","status":"active","kind":"managed"}]}"""
                }
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
        auth?.let { (ai.nuphos.android.session.AuthSession::class.java.getDeclaredField("scope").also { f -> f.isAccessible = true }
            .get(it) as kotlinx.coroutines.CoroutineScope).cancel() }
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            if (::store.isInitialized) store.disposeForConsent()
            access().value = savedAccess
        }
        originals.forEach { (name, client) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client) }
    }

    private fun render(realChannel: Boolean = false, page: @androidx.compose.runtime.Composable (androidx.navigation.NavHostController) -> Unit = { ChatsPage(it) }) {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
        val auth = ai.nuphos.android.session.AuthSession(app, app.tokenStore).also { auth = it }
        // Signed in, as the runtime setup needs an account.
        ai.nuphos.android.session.AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, token)
        @Suppress("UNCHECKED_CAST") (ai.nuphos.android.session.AuthSession::class.java.getDeclaredField("state\$delegate")
            .also { it.isAccessible = true }.get(auth) as MutableState<Any>).value =
            ai.nuphos.android.session.AuthSession.State.SignedIn(ai.nuphos.android.model.NuphosUser.preview)
        compose.setContent {
            NuphosTheme { CompositionLocalProvider(LocalAgentStore provides store, ai.nuphos.android.ui.LocalAuthSession provides auth) {
                val nav = rememberNavController()
                NavHost(nav, startDestination = "list") {
                    composable("list") { page(nav) }
                    composable("channel/{id}") { entry ->
                        val id = entry.arguments?.getString("id").orEmpty()
                        if (realChannel) ai.nuphos.android.ui.chats.ChannelScreen(id, onBack = { nav.popBackStack() })
                        else Text("Opened $id")
                    }
                }
            } }
        }
        compose.runOnIdle { store.refresh() }
    }
    private fun row(id: String) = compose.onNodeWithTag("chat-row:$id")
    private fun waitRow(id: String) = compose.waitUntil(8_000) { compose.onAllNodesWithTag("chat-row:$id").fetchSemanticsNodes().isNotEmpty() }
    private fun waitText(text: String) = compose.waitUntil(8_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
    private fun posts(suffix: String) = writes.count { it.startsWith("POST") && it.endsWith(suffix) }

    private fun avatarFaces(provider: String) = """[{"id":"avatar-bot","name":"Bot","agent":{"avatar":"02-leonardo","provider":"$provider"}},{"id":"avatar-other","name":"Other Bot","agent":{"avatar":"07-ada","provider":"grok"}}]"""

    private fun avatarChat(provider: String) = """{"sessionId":"chat-avatar","title":"Avatar group","kind":"channel","lastActiveAt":"2026-11-03T12:30:00Z","faces":${avatarFaces(provider)},"lastMessage":{"text":"Runtime $provider"}}"""

    private fun avatarShot(name: String) {
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.waitForIdleSync()
        Thread.sleep(300) // Wait for the actual window after the Compose idle frame.
        val image = instrumentation.uiAutomation.takeScreenshot() ?: error("No synthetic screenshot")
        val directory = java.io.File(instrumentation.targetContext.getExternalFilesDir(null), "review-bot-runtime-avatar").apply { mkdirs() }
        java.io.File(directory, "$name.png").outputStream().use { image.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        image.recycle()
    }

    @Test fun avatarBadgesInRealListAncestorsFollowTheKnownRuntime() {
        chats = avatarChat("codex")
        render()
        waitRow("chat-avatar")
        waitText("Runtime codex")
        avatarShot("04-real-list-codex-grok")
        chats = avatarChat("grok")
        waitText("Runtime grok") // The actual poll replaced the same row's face metadata.
        avatarShot("05-real-list-same-bot-grok")
    }

    @Test fun avatarBadgesInRealHeaderAncestors() {
        chats = avatarChat("codex")
        avatarDetail = """{"sessionId":"chat-avatar","kind":"channel","title":"Avatar group","faces":${avatarFaces("codex")},"messages":[],"messageCount":0,"timelineEvents":[],"activitySeq":1,"readSeq":1}"""
        render(realChannel = true)
        waitRow("chat-avatar")
        row("chat-avatar").performClick()
        waitText("Avatar group")
        avatarShot("06-real-header-28-codex-grok")
    }

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

    @Test fun aBotsRowShowsItsChatsDotsWhileItAnswersThenItsReply() {
        fun ada(state: String) = """{"sessionId":"bot-chatted","title":"Ada","avatar":"07-ada","lastActiveAt":"2026-11-03T13:30:00Z",""" +
            """"runtimeState":{"state":"$state","channelIds":["chat-bot"]}}"""
        chats = oneOnOne
        history = ada("active")
        render()
        compose.waitUntil(8_000) { compose.onAllNodesWithContentDescription("Ada is typing", substring = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Ready when you are").assertDoesNotExist()
        chats = oneOnOne.replace("Ready when you are", "Here is the plan")
        history = ada("idle")
        waitText("Here is the plan")
        compose.onAllNodesWithContentDescription("Ada is typing", substring = true).assertCountEquals(0)
        assertTrue("The row reads the agent list, not each Bot", reads.none { it.startsWith("/agent/conversations/") })
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
        render()
        openSheet()
        // The last runtime went away after the page listed them.
        noRuntimes = true
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

    @Test fun aRuntimeListThatFailsMakesNoBotAndCanBeRetried() {
        runtimesFail = true
        render()
        openSheet()
        nameField().performTextInput("Grace")
        create().performClick()
        waitText("Couldn't create this Bot. Try again.")
        // A list that didn't load says nothing about whether there are runtimes.
        compose.onNodeWithText("This workspace has no runtime yet. Add one on the Runtimes page, then create your Bot.").assertDoesNotExist()
        assertEquals(0, posts("/agent/bots"))
        runtimesFail = false
        create().performClick()
        waitText("Opened chat-new")
        assertEquals(1, posts("/agent/bots"))
    }

    private fun changeWhileTheListLoads(change: () -> Unit) {
        val release = CountDownLatch(1)
        render()
        openSheet()
        runtimesHeld = release
        nameField().performTextInput("Grace")
        create().performClick()
        assertTrue(runtimesEntered.await(5, TimeUnit.SECONDS))
        compose.runOnIdle(change)
        compose.runOnIdle { release.countDown() }
        Thread.sleep(800); compose.waitForIdle()
        assertEquals("No Bot for the old workspace", 0, posts("/agent/bots"))
        assertEquals("No chat for the old workspace", 0, posts("/agent/channels"))
        assertNull("No error left from the old workspace", store.newBotError)
        compose.onNodeWithText("Opened chat-new").assertDoesNotExist()
    }
    @Test fun switchingTeamWhileTheRuntimeListLoadsMakesNothing() = changeWhileTheListLoads { store.select(teamB) }
    @Test fun withdrawingConsentWhileTheRuntimeListLoadsMakesNothing() = changeWhileTheListLoads { AiAccess.revoke() }

    // MARK: No runtime yet: the first-runtime prompt, as on iOS.
    private val prompt = "Connect your first runtime"
    private val adminWords = "Open Nuphos on your computer to add a Box or connect your own computer, or ask a workspace administrator to connect one."
    private val memberWords = "Open Nuphos on your computer to add a Box or connect your own computer, or ask a workspace administrator to connect one."
    private fun asAdministrator() = InstrumentationRegistry.getInstrumentation().runOnMainSync {
        store.acceptMemberships(listOf(teamA.copy(role = "ADMINISTRATOR"), teamB), teamA.id)
    }
    private fun gone(text: String) = compose.onNodeWithText(text).assertDoesNotExist()
    private fun noPlus() = compose.onNodeWithContentDescription("New Bot").assertDoesNotExist()

    @Test fun anAdministratorWithNoRuntimeIsToldToConnectAComputer() {
        noRuntimes = true
        chats = oneOnOne
        asAdministrator()
        render()
        waitText(prompt)
        compose.onNodeWithText(adminWords).assertExists()
        // Like iOS: no "+" and no list, even with a chat.
        noPlus()
        row("chat-bot").assertDoesNotExist()
        gone("Set up runtime")
        gone("Create runtime")
        assertTrue("Opening the setup writes nothing: $writes", writes.isEmpty())
    }

    @Test fun aMemberWithNoRuntimeIsToldWhoCanSetOneUp() {
        noRuntimes = true
        render()
        waitText(prompt)
        compose.onNodeWithText(memberWords).assertExists()
        gone("Set up runtime")
        noPlus()
    }

    @Test fun runtimesNotListedYetOrFailingAreNotAnEmptyWorkspace() {
        val release = CountDownLatch(1)
        runtimesHeld = release
        noRuntimes = true
        render()
        assertTrue(runtimesEntered.await(5, TimeUnit.SECONDS))
        compose.waitUntil(8_000) { compose.onAllNodesWithContentDescription("New Bot").fetchSemanticsNodes().isNotEmpty() }
        gone(prompt)
        release.countDown()
        waitText(prompt)
        runtimesHeld = null
        // A failed listing keeps the last answer instead of guessing.
        runtimesFail = true
        compose.runOnIdle { store.refresh() }
        Thread.sleep(800); compose.waitForIdle()
        compose.onNodeWithText(prompt).assertExists()
    }

    @Test fun aFailingListingShowsTheBotsAsBefore() {
        runtimesFail = true
        chats = oneOnOne
        render()
        waitRow("chat-bot")
        compose.onNodeWithContentDescription("New Bot").assertIsEnabled()
        gone(prompt)
    }

    @Test fun aRuntimeAddedElsewhereReplacesThePromptOnRefresh() {
        noRuntimes = true
        render()
        waitText(prompt)
        noRuntimes = false
        compose.runOnIdle { store.refresh() }
        compose.waitUntil(8_000) { compose.onAllNodesWithContentDescription("New Bot").fetchSemanticsNodes().isNotEmpty() }
        gone(prompt)
    }

    @Test fun anotherWorkspaceAsksAgain() {
        noRuntimes = true
        render()
        waitText(prompt)
        noRuntimes = false
        compose.runOnIdle { store.select(teamB) }
        compose.waitUntil(8_000) { compose.onAllNodesWithContentDescription("New Bot").fetchSemanticsNodes().isNotEmpty() }
        gone(prompt)
    }

    private fun tasks() = render { nav ->
        ai.nuphos.android.ui.agent.AgentPage(searching = false, onSearchingChange = {}, nav = nav,
            newChatComposer = { Text("Synthetic composer") })
    }
    @Test fun tasksWithNoneAndNoRuntimeShowThePromptAboveTheComposer() {
        noRuntimes = true
        asAdministrator()
        tasks()
        waitText(prompt)
        compose.onNodeWithText(adminWords).assertExists()
        compose.onNodeWithText("Synthetic composer").assertExists()
        gone("No tasks yet")
    }
    @Test fun tasksStayListedWithNoRuntime() {
        noRuntimes = true
        history = """{"sessionId":"task-1","title":"Fix the build","agentRuntime":"codex","lastActiveAt":"2026-11-03T12:00:00Z"}"""
        tasks()
        waitText("Fix the build")
        Thread.sleep(800); compose.waitForIdle()
        gone(prompt)
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
