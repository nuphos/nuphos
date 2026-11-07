package ai.nuphos.android

import android.content.ContextWrapper
import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.model.Team
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.session.BotArchive
import ai.nuphos.android.session.BotArchiveIssues
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.agent.AgentPage
import ai.nuphos.android.ui.chats.ChatsPage
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.CoroutineScope
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
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Make this a Bot, Turn into a Task and Archive Bot against a synthetic server, with every write in order. */
@RunWith(AndroidJUnit4::class)
class BotActionsFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private val token = "synthetic-bot-actions"
    private val teamA = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A")
    private val teamB = Team("bbbbbbbbbbbbbbbbbbbbbbbb", "Fixture B")
    private val writes = CopyOnWriteArrayList<String>()
    private val originals = mutableMapOf<String, OkHttpClient>()
    private lateinit var store: AgentStore
    private var auth: AuthSession? = null
    private var savedAccess: Any? = null

    // The server's state.
    private val bots: MutableSet<String> = ConcurrentHashMap.newKeySet<String>().apply { add("bot-1") }
    private val archived: MutableSet<String> = ConcurrentHashMap.newKeySet()
    @Volatile private var manyChats = false
    /** Status each archive write answers with, by "id archived". Absent: 200. */
    private val archiveAnswers = ConcurrentHashMap<String, Int>()
    /** Holds an archive write until released, by "id archived". */
    private val held = ConcurrentHashMap<String, CountDownLatch>()
    private val entered = ConcurrentHashMap<String, CountDownLatch>()
    @Volatile private var searchHeld: CountDownLatch? = null
    private val searchEntered = CountDownLatch(1)

    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>

    private fun task(id: String, title: String, owner: Boolean = true) = buildString {
        append("""{"sessionId":"$id","title":"$title","agentRuntime":"codex","lastActiveAt":"2026-11-03T12:00:00Z","isOwner":$owner,"canManage":$owner""")
        if (id in bots) append(""","avatar":"05-rembrandt"""")
        if (id in archived) append(""","archivedAt":"2026-11-03T13:00:00Z"""")
        append("}")
    }
    private fun chat(id: String, bot: String) = buildString {
        append("""{"sessionId":"$id","title":"","kind":"channel","lastActiveAt":"2026-11-03T12:30:00Z","isOwner":true,""")
        append(""""faces":[{"id":"$bot","name":"Grace"${if (bot in bots) ""","agent":{"avatar":"05-rembrandt"}""" else ""}}]""")
        if (id in archived) append(""","archivedAt":"2026-11-03T13:00:00Z"""")
        append("}")
    }

    @Before fun before() {
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        val context = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("bot-actions-fixture", mode)
        }
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val path = request.url.encodedPath
            if (request.method != "GET") writes += "${request.method} $path"
            val excludeArchived = request.url.queryParameter("archived") == "exclude"
            var code = 200
            val body = when {
                request.method == "GET" && path.endsWith("/agent-runtimes") ->
                    """{"runtimes":[{"id":"r1","provider":"codex","label":"Synthetic runtime","status":"active","kind":"managed"}]}"""
                request.method == "POST" && path.endsWith("/bot") -> { bots += path.split("/")[3]; "{}" }
                request.method == "PATCH" && path.endsWith("/avatar") -> { bots -= path.split("/")[3]; "{}" }
                request.method == "PATCH" && path.endsWith("/archive") -> {
                    val id = path.split("/")[3]
                    val value = okio.Buffer().also { request.body?.writeTo(it) }.readUtf8().contains("\"archived\":true")
                    val key = "$id $value"
                    entered[key]?.countDown()
                    held[key]?.let { check(it.await(10, TimeUnit.SECONDS)) }
                    code = archiveAnswers[key] ?: 200
                    if (code == 200) { if (value) archived += id else archived -= id; """{"ok":true,"archived":$value}""" }
                    else """{"error":{"code":"fixture","message":"Synthetic refusal"}}"""
                }
                request.method == "POST" && path == "/agent/channels" -> """{"sessionId":"chat-new"}"""
                request.method == "POST" && path.endsWith("/agents") -> "{}"
                path == "/agent/conversations" && request.url.queryParameter("kind") == "channel" -> {
                    if (request.url.queryParameter("scope") != "mine") """{"conversations":[],"hasMore":false}"""
                    else {
                        // Archive Bot's search is the only listing that includes archived chats.
                        if (!excludeArchived) { searchEntered.countDown(); searchHeld?.let { check(it.await(10, TimeUnit.SECONDS)) } }
                        val all = buildList {
                            if (manyChats) repeat(100) { add(chat("filler-$it", "someone-else")) }
                            add(chat("chat-bot1", "bot-1"))
                        }.filter { !excludeArchived || !it.contains("archivedAt") }
                        val page = request.url.queryParameter("cursor")?.toInt() ?: 0
                        val rows = all.drop(page * 100).take(100)
                        val more = all.size > (page + 1) * 100
                        """{"conversations":[${rows.joinToString(",")}],"hasMore":$more${if (more) ""","nextCursor":"${page + 1}"""" else ""}}"""
                    }
                }
                path == "/agent/conversations" -> {
                    val rows = listOf(task("task-1", "Fix the build"), task("bot-1", "Grace"), task("mate-1", "Teammate task", owner = false))
                        .filter { !excludeArchived || !it.contains("archivedAt") }
                    """{"conversations":[${rows.joinToString(",")}],"hasMore":false}"""
                }
                else -> "{}"
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("fixture")
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
            BotArchiveIssues.clearAll()
            store = AgentStore(token, context)
            store.acceptMemberships(listOf(teamA, teamB), teamA.id)
        }
    }

    @After fun after() {
        held.values.forEach { it.countDown() }
        searchHeld?.countDown()
        auth?.let { (AuthSession::class.java.getDeclaredField("scope").also { f -> f.isAccessible = true }.get(it) as CoroutineScope).cancel() }
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            if (::store.isInitialized) store.disposeForConsent()
            BotArchiveIssues.clearAll()
            access().value = savedAccess
        }
        originals.forEach { (name, client) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client) }
    }

    private fun render(page: @Composable (NavHostController) -> Unit = { nav ->
        AgentPage(searching = false, onSearchingChange = {}, nav = nav, newChatComposer = { Text("Synthetic composer") })
    }) {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
        val session = AuthSession(app, app.tokenStore).also { auth = it }
        AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(session, token)
        @Suppress("UNCHECKED_CAST") (AuthSession::class.java.getDeclaredField("state\$delegate").also { it.isAccessible = true }
            .get(session) as MutableState<Any>).value = AuthSession.State.SignedIn(NuphosUser.preview)
        compose.setContent {
            NuphosTheme { CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides session) {
                val nav = rememberNavController()
                NavHost(nav, startDestination = "home") {
                    composable("home") { page(nav) }
                    composable("channel/{id}") { entry -> Text("Opened ${entry.arguments?.getString("id")}") }
                    composable("conversation/{id}") { entry -> Text("Conversation ${entry.arguments?.getString("id")}") }
                }
            } }
        }
        compose.runOnIdle { store.refresh() }
    }
    private fun waitText(text: String) = compose.waitUntil(8_000) { compose.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty() }
    private fun waitTag(tag: String) = compose.waitUntil(8_000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
    private fun menu(id: String) {
        waitTag("conversation-row:$id")
        compose.onNodeWithTag("conversation-row:$id").performTouchInput { longClick() }
    }
    private fun settle() { Thread.sleep(800); compose.waitForIdle() }
    private fun archiveWrites() = writes.filter { it.endsWith("/archive") }
    private fun hold(key: String) = CountDownLatch(1).also { held[key] = it; entered[key] = CountDownLatch(1) }
    private fun archiveFromTasks() {
        menu("bot-1")
        compose.onNodeWithTag("menu-archive:bot-1").assertTextContains("Archive Bot").performClick()
        waitText("Archive Bot?")
        compose.onNodeWithText("Archive").performClick()
    }

    // MARK: Make this a Bot, Turn into a Task

    @Test fun ownTaskBecomesABotAndItsChatOpens() {
        render()
        menu("task-1")
        compose.onNodeWithTag("menu-bot:task-1").assertTextContains("Make this a Bot").performClick()
        waitText("Opened chat-new")
        assertEquals(listOf("POST /agent/conversations/task-1/bot", "POST /agent/channels", "POST /agent/conversations/chat-new/agents"), writes)
    }

    @Test fun aBotTurnsBackIntoATaskAndNothingOpens() {
        render()
        menu("bot-1")
        compose.onNodeWithTag("menu-bot:bot-1").assertTextContains("Turn into a Task").performClick()
        settle()
        assertEquals(listOf("PATCH /agent/conversations/bot-1/avatar"), writes)
        compose.onNodeWithText("Opened", substring = true).assertDoesNotExist()
        menu("bot-1")
        compose.onNodeWithTag("menu-bot:bot-1").assertTextContains("Make this a Bot")
    }

    @Test fun aTeammatesTaskOffersNeither() {
        render()
        menu("mate-1")
        compose.onNodeWithTag("menu-bot:mate-1").assertDoesNotExist()
        compose.onNodeWithTag("menu-archive:mate-1").assertDoesNotExist()
    }

    // MARK: Archive Bot

    @Test fun archiveBotFromTasksArchivesItsChatThenTheBot() {
        render()
        archiveFromTasks()
        compose.waitUntil(8_000) { compose.onAllNodesWithTag("conversation-row:bot-1").fetchSemanticsNodes().isEmpty() }
        assertEquals(listOf("PATCH /agent/conversations/chat-bot1/archive", "PATCH /agent/conversations/bot-1/archive"), archiveWrites())
        assertNull(BotArchiveIssues.of(token))
    }

    @Test fun archiveBotFromALongPressOnBots() {
        render { nav -> ChatsPage(nav) }
        waitTag("chat-row:chat-bot1")
        compose.onNodeWithTag("chat-row:chat-bot1").performTouchInput { longClick() }
        compose.onNodeWithText("Archive Bot").performClick()
        waitText("Archive Bot?")
        compose.onNodeWithText("Archive").performClick()
        compose.waitUntil(8_000) { compose.onAllNodesWithTag("chat-row:chat-bot1").fetchSemanticsNodes().isEmpty() }
        assertEquals(listOf("PATCH /agent/conversations/chat-bot1/archive", "PATCH /agent/conversations/bot-1/archive"), archiveWrites())
    }

    @Test fun aChatPastTheFirstHundredGoesToo() {
        manyChats = true
        render()
        archiveFromTasks()
        compose.waitUntil(8_000) { archiveWrites().size == 2 }
        assertEquals("chat-bot1 is on the second page", "PATCH /agent/conversations/chat-bot1/archive", archiveWrites().first())
    }

    @Test fun theBotFailingRestoresTheChatAndTryAgainFinishes() {
        archiveAnswers["bot-1 true"] = 500
        render()
        archiveFromTasks()
        waitText(BotArchive.FAILED)
        assertEquals(listOf("PATCH /agent/conversations/chat-bot1/archive", "PATCH /agent/conversations/bot-1/archive",
            "PATCH /agent/conversations/chat-bot1/archive"), archiveWrites())
        assertFalse("chat-bot1" in archived)
        archiveAnswers.clear()
        compose.onNodeWithText("Try again").performClick()
        compose.waitUntil(8_000) { "bot-1" in archived && "chat-bot1" in archived }
        settle()
        compose.onNodeWithText(BotArchive.FAILED).assertDoesNotExist()
    }

    @Test fun aRestoreThatFailsSaysWhatIsLeftAndRestoreChatsReadsFirst() {
        archiveAnswers["bot-1 true"] = 500
        archiveAnswers["chat-bot1 false"] = 500
        render()
        archiveFromTasks()
        waitText("Archive Bot didn't finish")
        compose.onNodeWithText(BotArchive.NOT_RESTORED).assertExists()
        compose.onNodeWithText("“Grace”: not archived.").assertExists()
        compose.onNodeWithText("Your chats with it: 1 archived.").assertExists()
        assertTrue("chat-bot1" in archived)
        archiveAnswers.clear()
        writes.clear()
        compose.onNodeWithText("Restore chats").performClick()
        waitText(BotArchive.RESTORED)
        assertEquals(listOf("PATCH /agent/conversations/chat-bot1/archive"), writes)
        assertFalse("chat-bot1" in archived)
    }

    @Test fun refusedForAccessSendsNoRestore() {
        archiveAnswers["bot-1 true"] = 403
        render()
        archiveFromTasks()
        waitText(BotArchive.NO_ACCESS)
        assertEquals("No restore after a 403", 2, archiveWrites().size)
        compose.onNodeWithText("Your chats with it: 1 archived.").assertExists()
    }

    @Test fun withdrawingConsentAfterTheFirstWriteSendsNothingMore() {
        val release = hold("chat-bot1 true")
        render()
        archiveFromTasks()
        assertTrue(entered.getValue("chat-bot1 true").await(5, TimeUnit.SECONDS))
        compose.runOnIdle { AiAccess.revoke() }
        release.countDown()
        settle()
        assertEquals("Neither the Bot nor a restore", listOf("PATCH /agent/conversations/chat-bot1/archive"), archiveWrites())
        val issue = requireNotNull(BotArchiveIssues.of(token))
        assertEquals(BotArchive.Result.Partial(mapOf("chat-bot1" to BotArchive.State.Archived), BotArchive.State.NotArchived, BotArchive.STOPPED), issue.result)
        // Back with consent the app makes a new store for the same sign-in, which says so in that workspace only.
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        val context = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("bot-actions-fixture", mode)
        }
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            store.disposeForConsent()
            AiAccess.activate(token); AiAccess.grant(token)
            store = AgentStore(token, context)
            store.acceptMemberships(listOf(teamA, teamB), teamB.id)
            assertNull("Not in another workspace", store.botArchiveIssue)
            store.select(teamA)
            assertEquals(issue, store.botArchiveIssue)
        }
        assertEquals("Still nothing more sent", 1, archiveWrites().size)
    }

    @Test fun signingOutWhileAWriteIsHeldLeavesNoReportAndSendsNothingMore() {
        val release = hold("chat-bot1 true")
        render()
        archiveFromTasks()
        assertTrue(entered.getValue("chat-bot1 true").await(5, TimeUnit.SECONDS))
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
        // Signing out clears identity state, then the account's store goes away.
        compose.runOnIdle { app.authSession.onIdentityReset(); store.disposeForConsent() }
        release.countDown()
        settle()
        assertEquals("Nothing after the held write", listOf("PATCH /agent/conversations/chat-bot1/archive"), archiveWrites())
        assertNull("The old sign-in's report doesn't come back", BotArchiveIssues.of(token))
    }

    @Test fun switchingTeamAfterTheFirstWriteStopsAndReportsOnlyBackInThatTeam() {
        val release = hold("chat-bot1 true")
        render()
        archiveFromTasks()
        assertTrue(entered.getValue("chat-bot1 true").await(5, TimeUnit.SECONDS))
        compose.runOnIdle { store.select(teamB) }
        release.countDown()
        settle()
        assertEquals(listOf("PATCH /agent/conversations/chat-bot1/archive"), archiveWrites())
        compose.onNodeWithText(BotArchive.STOPPED).assertDoesNotExist()
        compose.runOnIdle { store.select(teamA) }
        waitText(BotArchive.STOPPED)
    }

    @Test fun switchingTeamBeforeAnyWriteSendsNothingAndSaysNothing() {
        val release = CountDownLatch(1)
        searchHeld = release
        render()
        archiveFromTasks()
        assertTrue(searchEntered.await(5, TimeUnit.SECONDS))
        compose.runOnIdle { store.select(teamB) }
        release.countDown()
        settle()
        assertTrue(archiveWrites().isEmpty())
        assertNull(BotArchiveIssues.of(token))
    }

    @Test fun signingOutForgetsTheReport() {
        archiveAnswers["bot-1 true"] = 403
        render()
        archiveFromTasks()
        waitText(BotArchive.NO_ACCESS)
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
        compose.runOnIdle { app.authSession.onIdentityReset() }
        assertNull(BotArchiveIssues.of(token))
        compose.waitForIdle()
        compose.onNodeWithText(BotArchive.NO_ACCESS).assertDoesNotExist()
    }
}
