package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
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
import kotlinx.coroutines.runBlocking
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

/** Synthetic Bot chats only: `@` in a Bot's chat offers the viewer's other Bots by name, as a Task's composer does, and a post linking one shows its name. Never touches a live API. */
@RunWith(AndroidJUnit4::class)
class BotMentionFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val token = "synthetic-bot-mention"
    private val team = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A")
    private lateinit var store: AgentStore
    private lateinit var auth: AuthSession
    private lateinit var tokens: TokenStore
    private lateinit var original: OkHttpClient
    private var savedAccess: Any? = null
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
        val posts = listOf(
            post("u", """{"type":"user","id":"viewer","displayName":"Preview User"}""", bot.asked, "2026-11-08T09:38:00Z"),
            post("a", """{"type":"agent","id":"${bot.id}","displayName":"${bot.title}"}""", bot.answer, "2026-11-08T09:39:00Z"),
        ) + listOfNotNull(
            // A post that links the other Bot, as a picked mention is sent.
            if (id == "chat-plain") post("m", """{"type":"user","id":"viewer","displayName":"Preview User"}""",
                "Ask https://nuphos.ai/teams/${team.id}/agent/bot-box how the login fix went", "2026-11-08T09:40:00Z") else null,
        )
        return """{"sessionId":"$id","kind":"channel","title":"${bot.title}","isOwner":true,"transcriptUpdatedAt":"t","messageCount":2,"activitySeq":2,"readSeq":2,
            "faces":[{"id":"${bot.id}","name":"${bot.title}","agent":{"avatar":"${bot.avatar}"}}],"messages":[${posts.joinToString(",")}]}"""
    }
    private fun bot(bot: Bot): String {
        val desktop = if (bot.desktop) ""","canOpenDesktop":true""" else ""
        return """{"sessionId":"${bot.id}","title":"${bot.title}","avatar":"${bot.avatar}","isOwner":true,"canManage":true,"readOnly":false,"messages":[],
            "runtimeState":{"schemaVersion":2,"state":"idle","phase":"idle","actions":{"send":true}$desktop}}"""
    }

    @Before fun before() {
        val target = inst.targetContext
        val context = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("bot-mention-fixture", mode)
        }
        val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
        original = field.get(null) as OkHttpClient
        field.set(null, OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val path = request.url.encodedPath
            val chatId = bots.keys.firstOrNull { path.endsWith("/agent/conversations/$it") }
            val ofBot = bots.values.firstOrNull { path.endsWith("/agent/conversations/${it.id}") }
            val body = when {
                chatId != null -> chat(chatId, bots.getValue(chatId))
                ofBot != null -> bot(ofBot)
                path.endsWith("/agents") -> bots.entries.first { path.contains("/${it.key}/") }.value
                    .let { """{"agents":[{"sessionId":"${it.id}","title":"${it.title}","ownerId":"viewer"}]}""" }
                path.endsWith("/ai-consent") -> """{"version":"${ai.nuphos.android.data.AccountApi.AI_CONSENT_VERSION}","accepted":true}"""
                path.endsWith("/auth/me") -> """{"id":"viewer","email":"viewer@example.com","name":"Preview User"}"""
                // Every listing but the chats one: an `@` (blank or not) and the Bots read, as the server lists them.
                path.endsWith("/agent/conversations") && request.url.queryParameter("kind") != "channel" ->
                    bots.values.joinToString(",", """{"conversations":[""", """],"hasMore":false}""") {
                        """{"sessionId":"${it.id}","teamId":"${team.id}","title":"${it.title}","isOwner":true}"""
                    }
                path.endsWith("/agent/conversations") -> """{"conversations":[],"hasMore":false}"""
                path.endsWith("/read") -> """{"activitySeq":2,"readSeq":2,"unread":false}"""
                else -> "{}"
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .body(body.toResponseBody(Http.jsonMedia)).build()
        }.build())
        val app = target.applicationContext as NuphosApplication
        val authContext = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("bot_mention_fixture_$name", mode)
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

    @Test fun atOffersTheOtherBotByName() {
        // The viewer's Bots, as the Chats list loads them, so a link to one reads as its name.
        runBlocking {
            store.loadChannels()
            // The root binds shares to the signed-in account; until then a chat's composer takes no text.
            (inst.targetContext.applicationContext as NuphosApplication).incomingShares.bindAccount(requireNotNull(auth.user).id)
        }
        compose.setContent {
            NuphosTheme(darkTheme = false) {
                CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    ChannelScreen("chat-plain", onBack = { fail("The chat closed itself") })
                }
            }
        }
        val plain = bots.getValue("chat-plain")
        compose.waitUntil(5_000) { compose.onAllNodesWithText(plain.answer).fetchSemanticsNodes().isNotEmpty() }
        val posted = compose.onAllNodesWithText("Ask @Sign-in helper how the login fix went", substring = true)
            .fetchSemanticsNodes().isNotEmpty()
        capture("0-post")
        val field = compose.onNodeWithContentDescription("Message ${plain.title}")
        val ownTitle = { compose.onAllNodesWithText(plain.title).fetchSemanticsNodes().size }
        val ownBefore = ownTitle()
        field.performClick().performTextInput("Ask @")
        val other = hasText("Sign-in helper") and hasClickAction()
        val offered = runCatching { compose.waitUntil(5_000) { compose.onAllNodes(other).fetchSemanticsNodes().isNotEmpty() } }.isSuccess
        capture("1-mention-list")
        if (InstrumentationRegistry.getArguments().getString("evidenceBaseline") == "true") return
        assertTrue("A post linking another Bot does not show it by name", posted)
        assertTrue("`@` in a Bot's chat does not offer the other Bot", offered)
        // The chat's own Bot is never offered.
        assertEquals(ownBefore, ownTitle())
        compose.onNode(other).performClick()
        field.assertTextEquals("Ask @Sign-in helper ")
        capture("2-mention-picked")
    }

    /** Screenshots for review, only with `-e botMentionShots true`. */
    private fun capture(name: String) {
        if (InstrumentationRegistry.getArguments().getString("botMentionShots") != "true") return
        compose.waitForIdle()
        Thread.sleep(500)
        val directory = File(inst.targetContext.getExternalFilesDir(null), "bot-mention").apply { mkdirs() }
        val bitmap = inst.uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
    }
}
