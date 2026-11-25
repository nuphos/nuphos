package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.TokenStore
import ai.nuphos.android.model.Team
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.chats.ChannelScreen
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
import java.io.File

/** Synthetic Bot chats only: the header's desktop button follows the Bot's runtime. Never touches a live API. */
@RunWith(AndroidJUnit4::class)
class BotDesktopFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val token = "synthetic-bot-desktop"
    private val team = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A")
    private lateinit var store: AgentStore
    private lateinit var auth: AuthSession
    private lateinit var tokens: TokenStore
    private lateinit var original: OkHttpClient
    private var savedAccess: Any? = null
    private var historicalPosts = false
    @Volatile private var denyBotTask = false
    @Volatile private var composerFixture = false
    @Volatile private var nonOwner = false
    /** The Tasks list carries what Release notes dispatched, oldest waiting first to show state outranks time. */
    @Volatile private var dispatched = false
    /** A pull request linked to the Bot's own session, which Bot details leaves out (#4790). */
    @Volatile private var linkedPr = false
    /** The Bot's instructions save is refused with the server's reason (#4084). */
    @Volatile private var refuseInstructions = false
    /** The Bot's instructions are written in Markdown: bold, a list and a link. */
    @Volatile private var markdownInstructions = false
    @Volatile private var sentInstructions: String? = null
    private val tasks = listOf(
        Triple("task-old", "Prune stale branches", """"lastActiveAt":"2026-11-01T09:00:00Z","runtimeState":{"schemaVersion":2,"state":"idle","phase":"idle"}"""),
        Triple("task-wait", "Confirm the release date", """"lastActiveAt":"2026-11-02T09:00:00Z","inputRequests":[{"id":"q1","question":"Ship 0.26 on Friday?"}]"""),
        Triple("task-run", "Collect merged PRs", """"lastActiveAt":"2026-11-03T09:00:00Z","activeRun":{"streamId":"s1"},"runtimeState":{"schemaVersion":2,"state":"active","phase":"turn"}"""),
        Triple("task-new", "Draft the changelog", """"lastActiveAt":"2026-11-07T09:00:00Z","runtimeState":{"schemaVersion":2,"state":"idle","phase":"idle"}"""),
    )
    private val botReads = java.util.concurrent.atomic.AtomicInteger()
    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>

    /** chat-box is the 1:1 of a Bot whose Box has a desktop; chat-plain's Bot has none. */
    private data class Bot(val id: String, val title: String, val avatar: String, val desktop: Boolean, val asked: String, val answer: String)
    private val bots = mapOf(
        "chat-box" to Bot("bot-box", "Sign-in helper", "05-rembrandt", true,
            "Sign in to the staging dashboard for me.", "I opened the sign-in page in a browser on my Box. Open my desktop to type your password."),
        "chat-plain" to Bot("bot-plain", "Release notes", "02-leonardo", false,
            "Draft the 0.26 release notes.", "Here is a first draft of the 0.26 release notes."),
    )

    private fun chat(id: String, bot: Bot): String {
        fun post(n: String, sender: String, text: String, at: String) =
            """{"id":"$n","role":"user","metadata":{"version":1,"sender":$sender,"sentAt":"$at"${if (n == "a") ""","sourceSessionId":"${bot.id}"""" else ""}},"parts":[{"type":"text","text":"$text"}]}"""
        val posts = (if (historicalPosts) (0..39).map { index ->
            post("history-$index", """{"type":"user","id":"viewer","displayName":"Preview User"}""",
                "Historical post $index. A retained conversation position should survive opening the Bot Task.", "2026-11-08T09:38:00Z")
        } else emptyList()) + listOf(
            post("u", """{"type":"user","id":"viewer","displayName":"Preview User"}""", bot.asked, "2026-11-08T09:38:00Z"),
            post("a", """{"type":"agent","id":"${bot.id}","displayName":"${bot.title}"}""", bot.answer, "2026-11-08T09:39:00Z"),
        )
        return """{"sessionId":"$id","kind":"channel","title":"${bot.title}","isOwner":true,"transcriptUpdatedAt":"t","messageCount":2,"activitySeq":2,"readSeq":2,
            "faces":[{"id":"${bot.id}","name":"${bot.title}","agent":{"avatar":"${bot.avatar}"}}],"messages":[${posts.joinToString(",")}]}"""
    }
    private fun bot(bot: Bot): String {
        val desktop = if (bot.desktop) ""","canOpenDesktop":true""" else ""
        val native = if (composerFixture) ""","agentRuntime":"claude-code","runtimeId":"fixture-runtime","runtimeLabel":"Fixture Box"""" else ""
        return """{"sessionId":"${bot.id}","title":"${bot.title}","avatar":"${bot.avatar}","isOwner":${!nonOwner},"canManage":${!nonOwner},"readOnly":$nonOwner$native,"messages":[
            {"id":"task-prompt","role":"user","parts":[{"type":"text","text":"Draft the 0.26 release notes."}]},
            {"id":"task-answer","role":"assistant","parts":[{"type":"text","text":"Release notes draft: Shared Bot Tasks keep the conversation and working context together."}]}],
            "runtimeState":{"schemaVersion":2,"state":"idle","phase":"idle","actions":{"send":true}$desktop}}"""
    }

    @Before fun before() {
        val target = inst.targetContext
        val context = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("bot-desktop-fixture", mode)
        }
        val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
        original = field.get(null) as OkHttpClient
        field.set(null, OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val path = request.url.encodedPath
            val chatId = bots.keys.firstOrNull { path.endsWith("/agent/conversations/$it") }
            val ofBot = bots.values.firstOrNull { path.endsWith("/agent/conversations/${it.id}") }
            val ofTask = tasks.firstOrNull { path.endsWith("/agent/conversations/${it.first}") }
            if (ofBot != null) {
                botReads.incrementAndGet()
                if (denyBotTask) return@addInterceptor Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
                    .code(403).message("fixture").body("""{"error":{"message":"Session access denied"}}""".toResponseBody(Http.jsonMedia)).build()
            }
            if (request.method == "PATCH" && path.endsWith("/agent/conversations/bot-plain/instructions")) {
                val sent = okio.Buffer().also { request.body?.writeTo(it) }.readUtf8()
                sentInstructions = org.json.JSONObject(sent).getString("instructions")
                val (code, reply) = if (refuseInstructions) 400 to """{"error":{"code":"invalid_request","message":"Instructions must be at most 8000 characters"}}"""
                    else 200 to """{"instructions":"Ship 2.4 on Thursday."}"""
                return@addInterceptor Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("fixture")
                    .body(reply.toResponseBody(Http.jsonMedia)).build()
            }
            val body = when {
                path.endsWith("/model-config") && composerFixture -> """{"status":"ready","options":[{"id":"model","name":"Model","kind":"model","currentValue":"sonnet","options":[{"value":"sonnet","name":"Sonnet"},{"value":"opus","name":"Opus"}]}]}"""
                chatId != null -> chat(chatId, bots.getValue(chatId))
                ofBot != null -> bot(ofBot)
                ofTask != null -> """{"sessionId":"${ofTask.first}","title":"${ofTask.second}","isOwner":true,"canManage":true,"readOnly":false,"parentSessionId":"bot-plain",
                    "messages":[{"id":"m","role":"assistant","parts":[{"type":"text","text":"Working on: ${ofTask.second}."}]}]}"""
                path.endsWith("/agents") -> bots.entries.first { path.contains("/${it.key}/") }.value
                    .let { """{"agents":[{"sessionId":"${it.id}","title":"${it.title}","avatar":"${it.avatar}","ownerId":"${if (denyBotTask || nonOwner) "another-viewer" else "viewer"}"}]}""" }
                path.endsWith("/ai-consent") -> """{"version":"${ai.nuphos.android.data.AccountApi.AI_CONSENT_VERSION}","accepted":true}"""
                path.endsWith("/auth/me") -> """{"id":"viewer","email":"viewer@example.com","name":"Preview User"}"""
                path.endsWith("/agent/conversations") && request.url.queryParameter("bots") == "true" -> """{"conversations":[${bots.values.joinToString(",") {
                    """{"sessionId":"${it.id}","title":"${it.title}","avatar":"${it.avatar}","isOwner":${!nonOwner},"readOnly":$nonOwner,"agentRuntime":"claude-code","runtimeLabel":"Fixture Box","lastActiveAt":"2026-11-08T09:39:00Z",
                        "instructions":"${if (markdownInstructions) MARKDOWN_INSTRUCTIONS_JSON else "Ship the 2.4 release. Ask before tagging."}"}""" }}],"hasMore":false}"""
                path.endsWith("/agent/conversations") && request.url.queryParameter("kind") == "channel" -> """{"conversations":[],"hasMore":false}"""
                path.endsWith("/agent/triggers") -> "[]"
                path.endsWith("/agent/conversations") -> """{"conversations":[${if (!dispatched) "" else tasks.joinToString(",") { (id, title, rest) ->
                    """{"sessionId":"$id","title":"$title","isOwner":true,"agentRuntime":"claude-code","parentSessionId":"bot-plain",$rest}""" }}],"hasMore":false}"""
                linkedPr && path.endsWith("/agent/conversations/bot-plain/resources") ->
                    """{"resources":[{"id":"pr1","provider":"github","title":"Release notes for 0.26","url":"https://github.com/example/project/pull/42","state":"open","number":42}]}"""
                path.endsWith("/resources") -> """{"resources":[]}"""
                path.endsWith("/read") -> """{"activitySeq":2,"readSeq":2,"unread":false}"""
                else -> "{}"
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .body(body.toResponseBody(Http.jsonMedia)).build()
        }.build())
        val app = target.applicationContext as NuphosApplication
        val authContext = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("bot_desktop_fixture_$name", mode)
        }
        tokens = TokenStore(authContext)
        tokens.write(token)
        inst.runOnMainSync {
            savedAccess = access().value
            // Signed in as the Bot's owner, through the app's own restore, since the viewer needs a user.
            auth = AuthSession(app, tokens); auth.restore()
        }
        var ready = false
        repeat(100) { if (!ready) { inst.runOnMainSync { ready = auth.user != null && auth.aiAllowed }; Thread.sleep(50) } }
        assertTrue("The synthetic sign-in did not finish", ready)
        inst.runOnMainSync {
            store = AgentStore(token, context)
            store.acceptMemberships(listOf(team), team.id)
        }
    }

    @After fun after() {
        inst.runOnMainSync {
            if (::store.isInitialized) store.disposeForConsent()
            if (::auth.isInitialized) auth.signOut()
            access().value = savedAccess
        }
        if (::tokens.isInitialized) tokens.clear()
        Http::class.java.getDeclaredField("client").also { it.isAccessible = true }.set(null, original)
    }

    private fun render(chatId: String, taskNavigation: Boolean = false, listBots: Boolean = false) {
        // As Home loads it: where a Bot's face and runtime come from.
        if (listBots) {
            inst.runOnMainSync { store.refresh() }
            var listed = false
            repeat(100) { if (!listed) { inst.runOnMainSync { listed = store.bots.isNotEmpty() }; Thread.sleep(50) } }
            assertTrue("The synthetic Bots listing did not load", listed)
        }
        compose.setContent {
            NuphosTheme(darkTheme = false) {
                CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    if (!taskNavigation) ChannelScreen(chatId, onBack = { fail("The chat closed itself") })
                    else {
                        val nav = rememberNavController()
                        NavHost(nav, startDestination = "chat") {
                            composable("chat") {
                                ChannelScreen(chatId, onBack = { fail("The retained chat closed itself") },
                                    onOpenTask = { id -> nav.navigate("task/$id") })
                            }
                            composable("task/{id}") { entry ->
                                ai.nuphos.android.ui.chat.ConversationScreen(entry.arguments!!.getString("id")!!,
                                    fresh = false, onBack = { nav.popBackStack() }, nav = nav)
                            }
                        }
                    }
                }
            }
        }
        compose.waitUntil(5_000) { compose.onAllNodesWithText(bots.getValue(chatId).answer).fetchSemanticsNodes().isNotEmpty() }
    }
    private val button = hasContentDescription("Desktop") and hasClickAction()

    @Test fun channelMembershipDoesNotExposePrivateBotTask() {
        denyBotTask = true
        render("chat-plain", taskNavigation = true)
        compose.waitUntil(5_000) { botReads.get() > 0 && store.session("bot-plain", "Release notes")?.loadError != null }
        compose.onNodeWithTag("chat-bot-task").assertDoesNotExist()
        compose.onNodeWithTag("bot-details-entry").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("task-summary").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("bot-task-entry").assertDoesNotExist()
        androidx.test.espresso.Espresso.pressBack()
        compose.onNodeWithTag("channel-transcript").assertExists()
    }

    @Test fun botTaskReturnsToOriginalChatScrollAndDraft() {
        historicalPosts = true
        val app = inst.targetContext.applicationContext as NuphosApplication
        kotlinx.coroutines.runBlocking { app.incomingShares.bindAccount(auth.user!!.id) }
        render("chat-plain", taskNavigation = true)
        compose.waitUntil(5_000) { store.session("bot-plain", "Release notes")?.readAllowed == true }
        compose.waitUntil(8_000) { compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().isNotEmpty() }
        compose.onNode(hasSetTextAction()).performTextInput("Retained Bot draft")
        androidx.test.espresso.Espresso.closeSoftKeyboard()
        compose.onNodeWithTag("channel-transcript").performScrollToIndex(12)
        compose.waitForIdle()
        fun position() = compose.onNodeWithTag("channel-transcript").fetchSemanticsNode()
            .config[SemanticsProperties.VerticalScrollAxisRange].value()
        val before = position()
        assertTrue(before > 5)
        // The details card's own entry sits in the details, not in the transcript.
        compose.onNodeWithTag("bot-task-entry").assertDoesNotExist()
        compose.onNodeWithTag("bot-details-entry").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("bot-task-entry").fetchSemanticsNodes().isNotEmpty() }
        compose.waitForIdle()
        capture("5-bot-details-task-button")
        compose.onNodeWithTag("bot-task-entry").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("channel-transcript").fetchSemanticsNodes().isEmpty() }
        compose.waitUntil(5_000) { store.session("bot-plain", "Release notes")?.readAllowed == true }
        compose.onNodeWithText("Release notes draft: Shared Bot Tasks keep the conversation and working context together.").assertExists()
        compose.onNodeWithText(inst.targetContext.getString(R.string.chat_resources_unavailable)).assertDoesNotExist()
        compose.waitUntil(5_000) { compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().isNotEmpty() }
        capture("6-bot-own-task")
        compose.onNodeWithContentDescription(inst.targetContext.getString(R.string.chat_task_actions)).performClick()
        compose.onNodeWithText(inst.targetContext.getString(R.string.chat_share)).assertDoesNotExist()
        // This deep-link fixture did not load the Bots catalog: archive stays disabled rather than using the Task endpoint.
        compose.onNodeWithText(inst.targetContext.getString(R.string.chat_menu_archive)).assertIsNotEnabled()
        androidx.test.espresso.Espresso.pressBack()
        compose.onNodeWithContentDescription(inst.targetContext.getString(R.string.chat_back)).performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("channel-transcript").fetchSemanticsNodes().isNotEmpty() }
        compose.waitForIdle()
        assertEquals(before, position(), 0.05f)
        compose.onNode(hasSetTextAction()).assertTextContains("Retained Bot draft")
        capture("7-task-return-scroll-and-draft")
    }

    @Test fun titleBarTaskButtonOpensBotTaskAndReturns() {
        render("chat-plain", taskNavigation = true)
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("chat-bot-task").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("chat-bot-task")
            .assert(hasContentDescription(inst.targetContext.getString(R.string.chat_task_fallback_title)) and hasClickAction())
        capture("11-title-bar-task-button")
        compose.onNodeWithTag("chat-bot-task").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("channel-transcript").fetchSemanticsNodes().isEmpty() }
        compose.waitUntil(5_000) {
            compose.onAllNodesWithText("Release notes draft: Shared Bot Tasks keep the conversation and working context together.").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithContentDescription(inst.targetContext.getString(R.string.chat_back)).performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("channel-transcript").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("chat-bot-task").assertExists()
    }

    @Test fun aBotWithoutADesktopHasNoButton() {
        render("chat-plain")
        // Long enough for the Bot's own read to land.
        compose.mainClock.advanceTimeBy(2_000)
        compose.waitForIdle()
        assertTrue(compose.onAllNodes(button).fetchSemanticsNodes().isEmpty())
        // Nowhere to open a Task: no Task button either.
        compose.onNodeWithTag("chat-bot-task").assertDoesNotExist()
        // Nothing dispatched: nothing under the name.
        compose.onNodeWithTag("bot-state", useUnmergedTree = true).assertDoesNotExist()
        capture("2-no-desktop")
    }

    @Test fun botPageShowsAndOpensWhatItDispatched() {
        dispatched = true
        render("chat-plain", taskNavigation = true, listBots = true)
        compose.waitUntil(8_000) { compose.onAllNodesWithTag("bot-state", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("bot-state", useUnmergedTree = true).assertTextEquals("1 needs input · 1 running")
        compose.onNodeWithTag("bot-task-entry").assertDoesNotExist()
        capture("8-bot-state")
        compose.onNodeWithTag("bot-details-entry").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("bot-task-row").fetchSemanticsNodes().size == 4 }
        compose.waitForIdle()
        val order = compose.onAllNodesWithTag("bot-task-row").fetchSemanticsNodes()
            .map { node -> node.config[SemanticsProperties.Text].first().text }
        assertEquals(listOf("Confirm the release date", "Collect merged PRs", "Draft the changelog", "Prune stale branches"), order)
        capture("9-bot-details")
        compose.onNodeWithTag("task-summary").performScrollToNode(hasText(inst.targetContext.getString(R.string.chat_bot_details_no_triggers)))
            .performTouchInput { swipeUp() }
        capture("9b-bot-details-triggers")
        compose.onAllNodesWithTag("bot-task-row")[1].performScrollTo().performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Working on: Collect merged PRs.").fetchSemanticsNodes().isNotEmpty() }
        capture("10-sub-task-open")
        compose.onNodeWithContentDescription(inst.targetContext.getString(R.string.chat_back)).performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("channel-transcript").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("bot-state", useUnmergedTree = true).assertExists()
    }

    /** As on Desktop (#4080): a pull request linked to the Bot's own session stays off Bot details. A Task's summary keeps it. */
    @Test fun botDetailsLeavesOutChanges() {
        linkedPr = true
        render("chat-plain")
        compose.waitUntil(5_000) { store.session("bot-plain", "Release notes")?.readAllowed == true }
        compose.onNodeWithTag("bot-details-entry").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("task-summary").fetchSemanticsNodes().isNotEmpty() }
        // The linked pull request has loaded, so its absence is the sheet's choice.
        compose.waitUntil(5_000) { store.session("bot-plain", "Release notes")?.linkedResources?.resources?.isNotEmpty() == true }
        compose.waitForIdle()
        compose.onNodeWithText(inst.targetContext.getString(R.string.chat_summary_changes)).assertDoesNotExist()
        compose.onNodeWithText("Release notes for 0.26").assertDoesNotExist()
        capture("11-bot-details-no-changes")
    }

    @Test fun aBotWithADesktopOpensItFromTheHeader() {
        render("chat-box")
        compose.waitUntil(5_000) { compose.onAllNodes(button).fetchSemanticsNodes().isNotEmpty() }
        capture("3-desktop-button")
        compose.onNode(button).performClick()
        // The Task screen's own viewer, for the Bot's session.
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Close").fetchSemanticsNodes().isNotEmpty() }
        capture("4-desktop-viewer")
    }

    /** A Bot's runtime and model are picked in its details; its chat's composer shows neither. */
    @Test fun ownerPicksBotModelInDetails() {
        composerFixture = true
        render("chat-plain")
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("bot-details-entry").fetchSemanticsNodes().isNotEmpty() }
        assertTrue(compose.onAllNodesWithTag("bot-composer.model").fetchSemanticsNodes().isEmpty())
        captureComposer("bot-details-android-chat")
        compose.onNodeWithTag("bot-details-entry").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Sonnet").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("bot-details-runtime").assertHasClickAction()
        // The runtime's full name wraps rather than being cut short, even at 320 dp.
        compose.onNodeWithText("Claude Code · Fixture Box").assertIsDisplayed()
        captureComposer("bot-details-android-owner")
        compose.onNodeWithTag("bot-details-model").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Opus").fetchSemanticsNodes().isNotEmpty() }
        captureComposer("bot-details-android-model")
    }

    @Test fun nonOwnerSeesBotRuntimeAndModelReadOnly() {
        composerFixture = true
        nonOwner = true
        render("chat-plain")
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("bot-details-entry").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("bot-details-entry").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Sonnet").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("bot-details-runtime").assertHasNoClickAction()
        compose.onNodeWithText("Claude Code · Fixture Box").assertIsDisplayed()
        compose.onNodeWithText("Only the owner can change model settings.").assertIsDisplayed()
        captureComposer("bot-details-android-member")
    }

    /** The owner rewrites a Bot's instructions in Bot details (#4084): Edit opens them in place,
     *  Save shows what the server kept. */
    @Test fun ownerEditsTheBotsInstructions() {
        openPlainDetails()
        compose.onNodeWithTag("bot-instructions-text", useUnmergedTree = true).performScrollTo()
        assertEquals("Ship the 2.4 release. Ask before tagging.", instructionsShown())
        compose.onNodeWithTag("bot-instructions-edit").performScrollTo().performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("bot-instructions-field").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("bot-instructions-save").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithTag("bot-instructions-field").performScrollTo().performTextInputSelection(androidx.compose.ui.text.TextRange(41))
        compose.onNodeWithTag("bot-instructions-field").performTextInput(" Thursday.")
        compose.onNodeWithTag("bot-instructions-save").performScrollTo().assertIsEnabled()
        capture("12-bot-instructions-editing")
        compose.onNodeWithTag("bot-instructions-save").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("bot-instructions-text", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
        assertEquals("Ship the 2.4 release. Ask before tagging. Thursday.", sentInstructions)
        compose.onNodeWithTag("bot-instructions-field").assertDoesNotExist()
        assertEquals("Ship 2.4 on Thursday.", instructionsShown())
        capture("13-bot-instructions-saved")
    }

    @Test fun aRefusedSaveSaysWhyUnderTheField() {
        refuseInstructions = true
        openPlainDetails()
        compose.onNodeWithTag("bot-instructions-edit").performScrollTo().performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("bot-instructions-field").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("bot-instructions-field").performScrollTo().performTextInputSelection(androidx.compose.ui.text.TextRange(41))
        compose.onNodeWithTag("bot-instructions-field").performTextInput(" More.")
        compose.onNodeWithTag("bot-instructions-save").performScrollTo().performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("bot-instructions-error", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("bot-instructions-error", useUnmergedTree = true).assertTextEquals("Instructions must be at most 8000 characters")
        // The edit stays, so nothing typed is lost.
        compose.onNodeWithTag("bot-instructions-field").assertTextContains("Ship the 2.4 release. Ask before tagging. More.")
        compose.onNodeWithTag("bot-instructions-save").assertIsEnabled()
        capture("14-bot-instructions-refused")
    }

    /** With the keyboard open, Cancel and Save stay above it, also once a refusal adds a line under the field. */
    @Test fun theKeyboardLeavesCancelAndSaveInView() {
        refuseInstructions = true
        openPlainDetails()
        compose.onNodeWithTag("bot-instructions-edit").performScrollTo().performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("bot-instructions-field").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("bot-instructions-field").performClick()
        val opened = runCatching { compose.waitUntil(10_000) { keyboardTop() != null } }.isSuccess
        org.junit.Assume.assumeTrue("No soft keyboard on this device", opened)
        assertActionsAboveKeyboard()
        capture("15-bot-instructions-keyboard")
        compose.onNodeWithTag("bot-instructions-field").performTextInput(" More.")
        // Tapped where it is on screen, without scrolling to it first.
        compose.onNodeWithTag("bot-instructions-save").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("bot-instructions-error", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("bot-instructions-field").performClick()
        compose.waitUntil(10_000) { keyboardTop() != null }
        assertActionsAboveKeyboard()
        capture("16-bot-instructions-keyboard-refused")
    }

    /** Where the keyboard starts on screen, or null while it's closed. */
    private fun keyboardTop(): Int? {
        var top: Int? = null
        inst.runOnMainSync {
            val view = compose.activity.window.decorView
            val ime = androidx.core.view.ViewCompat.getRootWindowInsets(view)
                ?.getInsets(androidx.core.view.WindowInsetsCompat.Type.ime())?.bottom ?: 0
            if (ime > 0) {
                val at = IntArray(2).also(view::getLocationOnScreen)
                top = at[1] + view.height - ime
            }
        }
        return top
    }

    /** Waits out the keyboard's slide and the scroll that follows it, however long they take on this device. */
    private fun assertActionsAboveKeyboard() {
        var top: Int? = null
        var bottom = 0f
        val above = runCatching {
            compose.waitUntil(5_000) {
                top = keyboardTop()
                val row = compose.onNodeWithTag("bot-instructions-actions").fetchSemanticsNode()
                bottom = row.positionOnScreen.y + row.size.height
                top?.let { bottom <= it } ?: false
            }
        }.isSuccess
        assertTrue("Cancel and Save end at $bottom, under the keyboard at ${top ?: "closed"}", above)
        compose.onNodeWithTag("bot-instructions-save").assertIsDisplayed()
    }

    /** Bot details shows the instructions as Markdown, as Desktop does (#4697): bold, a list and a link
     *  read as formatted text, not as the characters that mark them up. */
    @Test fun theInstructionsShowAsMarkdown() {
        markdownInstructions = true
        openPlainDetails()
        compose.onNodeWithTag("bot-instructions-text", useUnmergedTree = true).performScrollTo()
        val shown = instructionsShown()
        assertFalse("The instructions show their Markdown syntax: $shown", "**" in shown || "](" in shown || "- Ask" in shown)
        val texts = instructionTexts()
        val lead = texts.firstOrNull { it.text.startsWith("Ship the 2.4 release.") }
        assertNotNull("No paragraph reads \"Ship the 2.4 release.\" in: $shown", lead)
        assertTrue("\"Ship\" is not bold in: $shown", lead!!.spanStyles.any {
            it.start == 0 && it.end == 4 && (it.item.fontWeight?.weight ?: 0) >= androidx.compose.ui.text.font.FontWeight.Bold.weight })
        assertTrue("The list items are not their own lines in: $shown", texts.any { it.text == "Ask before tagging" })
        val notes = texts.firstOrNull { "release notes" in it.text }
        assertNotNull("No item reads \"release notes\" in: $shown", notes)
        val links = notes!!.getLinkAnnotations(0, notes.length).map { (it.item as? androidx.compose.ui.text.LinkAnnotation.Url)?.url }
        assertEquals("\"release notes\" is not a link", listOf("https://example.com/notes"), links)
        capture("18-bot-instructions-markdown")
    }

    /** Every text under the instructions, as accessibility services read it, top to bottom. */
    private fun instructionTexts(): List<androidx.compose.ui.text.AnnotatedString> =
        compose.onAllNodes(hasTestTag("bot-instructions-text") or hasAnyAncestor(hasTestTag("bot-instructions-text")), useUnmergedTree = true)
            .fetchSemanticsNodes().flatMap { it.config.getOrElse(SemanticsProperties.Text) { emptyList() } }

    private fun instructionsShown(): String = instructionTexts().joinToString(" ") { it.text }

    /** A teammate's Bot shows no instructions card, so nothing offers an edit the server would refuse. */
    @Test fun aTeammatesBotShowsNoInstructions() {
        nonOwner = true
        openPlainDetails()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("bot-details-runtime").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("bot-instructions-text", useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithTag("bot-instructions-edit").assertDoesNotExist()
        compose.onNodeWithText(inst.targetContext.getString(R.string.chat_bot_instructions)).assertDoesNotExist()
        capture("17-bot-instructions-teammate")
    }

    private fun openPlainDetails() {
        render("chat-plain", listBots = true)
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("bot-details-entry").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("bot-details-entry").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("task-summary").fetchSemanticsNodes().isNotEmpty() }
    }

    private fun captureComposer(name: String) {
        compose.waitForIdle()
        val output = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")?.let(::File)
            ?: inst.targetContext.getExternalFilesDir(null) ?: error("No screenshot directory")
        output.mkdirs()
        val bitmap = inst.uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(output, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
    }

    private companion object {
        /** Synthetic instructions, escaped for the listing's JSON. */
        const val MARKDOWN_INSTRUCTIONS_JSON = "**Ship** the 2.4 release.\\n\\n- Ask before tagging\\n- Post the [release notes](https://example.com/notes)"
    }

    /** Screenshots for review, only with `-e botDesktopShots true`. */
    private fun capture(name: String) {
        if (InstrumentationRegistry.getArguments().getString("botDesktopShots") != "true") return
        compose.waitForIdle()
        Thread.sleep(500)
        val directory = File(inst.targetContext.getExternalFilesDir(null), "bot-desktop").apply { mkdirs() }
        val bitmap = inst.uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
    }
}
