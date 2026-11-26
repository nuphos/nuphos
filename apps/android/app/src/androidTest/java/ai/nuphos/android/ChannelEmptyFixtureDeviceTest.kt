package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
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
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

/** Synthetic chat only: a chat with no posts says what it is, and gives way to the first post. Never touches a live API. */
@RunWith(AndroidJUnit4::class)
class ChannelEmptyFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val token = "synthetic-chats-empty"
    private val team = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A")
    private val listings = AtomicInteger()
    private val checks = AtomicInteger()
    @Volatile private var failFullReads = false
    @Volatile private var failChecks = false
    private val reads = CopyOnWriteArrayList<Int>()
    @Volatile private var messages = 0
    @Volatile private var running = false
    @Volatile private var answering = "chat-a"
    /** The chat is a Bot's own: its one face is the Bot's. */
    @Volatile private var botChat = false
    /** The Bot's own session as the listing gives it; null leaves it out. */
    @Volatile private var botRow: String? = null
    @Volatile private var opened: String? = null
    private lateinit var store: AgentStore
    private lateinit var auth: AuthSession
    private lateinit var tokens: TokenStore
    private lateinit var original: OkHttpClient
    private var savedAccess: Any? = null
    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>

    private fun detail(): String {
        val posts = (1..messages).joinToString(",") {
            """{"id":"p$it","role":"user","metadata":{"version":1,"sender":{"type":"agent","id":"agent-ops","displayName":"Release ops"},"sentAt":"2026-11-03T09:0$it:00Z","sourceSessionId":"agent-ops"},"parts":[{"type":"text","text":"Post $it"}]}"""
        }
        val face = if (botChat) ""","faces":[{"id":"agent-ops","name":"Release ops","agent":{"avatar":"07-ada"}}]""" else ""
        val title = if (botChat) "Release ops" else "chat-a"
        return """{"kind":"channel","title":"$title","transcriptUpdatedAt":"t$messages","messageCount":$messages,"activitySeq":$messages,"createdAt":"2026-11-25T02:00:00.000Z"$face,"messages":[$posts]}"""
    }
    /** The agent is asked directly, so being past the first page of the agent list makes no difference. */
    private fun agent(): String {
        val run = if (running) ""","activeRun":{"streamId":"run-1"},"runtimeState":{"state":"active","schemaVersion":2,"phase":"working","channelIds":["$answering"]}""" else ""
        return """{"sessionId":"agent-ops","title":"Release ops","isOwner":true,"messages":[]$run}"""
    }

    private val chatsContext by lazy {
        object : ContextWrapper(inst.targetContext) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("chats-empty-fixture", mode)
        }
    }

    @Before fun before() {
        val target = inst.targetContext
        val context = chatsContext
        val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
        original = field.get(null) as OkHttpClient
        field.set(null, OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val path = request.url.encodedPath
            var code = 200
            val body = when {
                path.endsWith("/agent/conversations/chat-a") -> {
                    reads += messages
                    if (failFullReads && request.url.queryParameter("tail") != "1") { code = 500; "{}" } else detail()
                }
                path.endsWith("/agent/conversations/agent-ops") -> { checks.incrementAndGet(); if (failChecks) { code = 500; "{}" } else agent() }
                path.endsWith("/agents") -> """{"agents":[{"sessionId":"agent-ops","title":"Release ops","ownerId":"viewer"}]}"""
                path.endsWith("/ai-consent") -> """{"version":"${ai.nuphos.android.data.AccountApi.AI_CONSENT_VERSION}","accepted":true}"""
                path.endsWith("/auth/me") -> """{"id":"viewer","email":"viewer@example.com","name":"Preview User"}"""
                path.endsWith("/agent/conversations") -> { if (request.url.queryParameter("kind") == null) listings.incrementAndGet(); """{"conversations":[${botRow.orEmpty()}],"hasMore":false}""" }
                path.endsWith("/read") -> """{"activitySeq":1,"readSeq":1,"unread":false}"""
                else -> "{}"
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("fixture")
                .body(body.toResponseBody(Http.jsonMedia)).build()
        }.build())
        val app = target.applicationContext as NuphosApplication
        val authContext = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("chats_empty_fixture_$name", mode)
        }
        tokens = TokenStore(authContext)
        inst.runOnMainSync {
            savedAccess = access().value
            auth = AuthSession(app, tokens); auth.signOut()
            AiAccess.activate(token); AiAccess.grant(token)
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

    private val words = "Everyone here sees each message and decides for themselves whether to reply, as in any group chat."
    private fun render() {
        compose.setContent {
            NuphosTheme(darkTheme = InstrumentationRegistry.getArguments().getString("darkTheme") == "true") {
                CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    ChannelScreen("chat-a", onBack = { fail("The chat closed itself") }, onLink = {}, onOpenTask = { opened = it })
                }
            }
        }
    }
    private fun has(text: String) = compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()

    @Test fun aChatWithNoPostsSaysWhatItIs() {
        render()
        compose.waitUntil(5_000) { has(words) }
        compose.onNodeWithTag("chat-empty").assertIsDisplayed()
        // Its name, once in the bar and once in the placeholder.
        assertEquals(2, compose.onAllNodesWithText("chat-a").fetchSemanticsNodes().size)
        // Nothing to scroll to.
        compose.onNodeWithContentDescription("Scroll to latest").assertDoesNotExist()
    }

    @Test fun aBotsOwnChatIntroducesTheBotInstead() {
        botChat = true
        render()
        val intro = "This is where you and Release ops get things done. Talk about what you want help with, and shape how you work together."
        compose.waitUntil(8_000) { has(intro) }
        compose.onNodeWithText("You can start by telling Release ops what you would like to do.").assertIsDisplayed()
        // The group chat's line is not for a chat with one person and one Bot.
        compose.onNodeWithText(words).assertDoesNotExist()
        compose.waitForIdle()
        val dark = InstrumentationRegistry.getArguments().getString("darkTheme") == "true"
        java.io.File(inst.targetContext.getExternalFilesDir("intro")!!, "bot-chat-intro-${if (dark) "dark" else "light"}.png").outputStream().use {
            inst.uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    private fun bot(messages: Int, lastActive: String) =
        """{"sessionId":"agent-ops","title":"Release ops","isOwner":true,"messageCount":$messages,"lastActiveAt":"$lastActive","avatar":"07-ada","teamId":"${team.id}"}"""
    private val earlier = "See earlier messages with Release ops"

    /** Signed in as the Bot's owner, through the app's own restore: only a viewer who can open the Bot's Task is led to it. */
    private fun signInAsOwner() {
        val app = inst.targetContext.applicationContext as NuphosApplication
        tokens.write(token)
        inst.runOnMainSync { auth = AuthSession(app, tokens); auth.restore() }
        var ready = false
        repeat(100) { if (!ready) { inst.runOnMainSync { ready = auth.user != null && auth.aiAllowed }; Thread.sleep(50) } }
        assertTrue("The synthetic sign-in did not finish", ready)
        // The sign-in renews AI access, so the chats are read again under it, as after a real sign-in.
        inst.runOnMainSync {
            store.disposeForConsent()
            store = AgentStore(token, chatsContext)
            store.acceptMemberships(listOf(team), team.id)
        }
    }

    @Test fun anOlderBotsEmptyChatLeadsBackToItsTask() {
        botChat = true
        botRow = bot(12, "2026-11-17T08:00:00.000Z")
        signInAsOwner()
        render()
        compose.waitUntil(12_000) { has(earlier) }
        compose.onNodeWithTag("chat-earlier").assertIsDisplayed()
        compose.waitForIdle()
        val size = InstrumentationRegistry.getArguments().getString("shotName") ?: "default"
        java.io.File(inst.targetContext.getExternalFilesDir("intro")!!, "bot-chat-earlier-$size.png").outputStream().use {
            inst.uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
        compose.onNodeWithTag("chat-earlier").performClick()
        compose.waitUntil(5_000) { opened != null }
        assertEquals("agent-ops", opened)
    }

    @Test fun aBotThatOnlyMovedOnceItsChatExistedHasNothingEarlier() {
        botChat = true
        botRow = bot(1, "2026-11-25T02:00:05.000Z")
        signInAsOwner()
        render()
        val intro = "This is where you and Release ops get things done. Talk about what you want help with, and shape how you work together."
        compose.waitUntil(8_000) { has(intro) }
        // The Bot's Task is open to this viewer and its row is read: only the times keep the link away.
        compose.waitUntil(12_000) { listings.get() > 0 && compose.onAllNodesWithTag("chat-bot-task").fetchSemanticsNodes().isNotEmpty() }
        compose.waitForIdle()
        compose.onNodeWithTag("chat-earlier").assertDoesNotExist()
    }

    @Test fun theFirstPostReplacesIt() {
        render()
        compose.waitUntil(5_000) { has(words) }
        messages = 1
        compose.waitUntil(8_000) { has("Post 1") }
        compose.onNodeWithTag("chat-empty").assertDoesNotExist()
    }

    @Test fun anAgentAtWorkInAnEmptyChatShowsItsDotsInstead() {
        running = true
        render()
        compose.waitUntil(8_000) { compose.onAllNodes(hasContentDescription("Release ops is typing")).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("chat-empty").assertDoesNotExist()
    }

    @Test fun aChatThatFailedToLoadShowsTheErrorNotThePlaceholder() {
        failFullReads = true
        render()
        compose.waitUntil(8_000) { has("Try again") }
        compose.onNodeWithTag("chat-empty").assertDoesNotExist()
        failFullReads = false
        compose.onNodeWithText("Try again").performClick()
        compose.waitUntil(8_000) { has(words) }
    }
}
