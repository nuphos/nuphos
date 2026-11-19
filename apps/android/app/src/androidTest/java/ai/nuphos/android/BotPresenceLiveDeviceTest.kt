package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.TokenStore
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.model.Team
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.chats.ChannelScreen
import ai.nuphos.android.ui.theme.NuphosTheme
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * #3308 against a real backend: `scripts/e2e/android-presence-stack.ts` starts one with a Bot whose
 * computer is offline and another online, and its `presence.json` gives this test its arguments
 * (`presencePort`, `presenceToken`, `presenceUser`, `presenceTeam`, `presenceBotChat`,
 * `presenceGroupChat`). Skipped without them.
 */
@RunWith(AndroidJUnit4::class)
class BotPresenceLiveDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val args = InstrumentationRegistry.getArguments()
    private val port = args.getString("presencePort")
    private val token = args.getString("presenceToken").orEmpty()
    private val dark = args.getString("darkTheme") == "true"
    private lateinit var store: AgentStore
    private lateinit var auth: AuthSession
    private lateinit var tokens: TokenStore
    private lateinit var original: OkHttpClient
    private var savedAccess: Any? = null
    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>
    @Suppress("UNCHECKED_CAST") private fun signedIn() = AuthSession::class.java.getDeclaredField("state\$delegate")
        .also { it.isAccessible = true }.get(auth) as MutableState<Any?>

    @Before fun before() {
        assumeTrue("Needs the presence stack's arguments", port != null)
        // Every request goes to the local backend, reached through `adb reverse`, as the stack's user.
        val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
        original = field.get(null) as OkHttpClient
        field.set(null, original.newBuilder().addInterceptor { chain ->
            val request = chain.request()
            val url = request.url.newBuilder().scheme("http").host("127.0.0.1").port(port!!.toInt()).build()
            chain.proceed(request.newBuilder().url(url).header("Authorization", "Bearer $token").build())
        }.build())
        val app = inst.targetContext.applicationContext as NuphosApplication
        val context = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("presence_live_$name", mode)
        }
        tokens = TokenStore(context)
        inst.runOnMainSync {
            savedAccess = access().value
            auth = AuthSession(app, tokens); auth.signOut()
            // Signed in as the stack's user, who owns the Bot.
            AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, token)
            signedIn().value = AuthSession.State.SignedIn(NuphosUser(args.getString("presenceUser")!!))
            AiAccess.activate(token); AiAccess.grant(token)
            store = AgentStore(token, context)
            val team = args.getString("presenceTeam")!!
            store.acceptMemberships(listOf(Team(team, "E2E")), team)
        }
    }

    @After fun after() {
        if (port == null) return
        inst.runOnMainSync {
            if (::store.isInitialized) store.disposeForConsent()
            // Without its token first, or signing out would end the stack user's session for the next test.
            if (::auth.isInitialized) {
                AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, null)
                auth.signOut()
            }
            access().value = savedAccess
        }
        if (::tokens.isInitialized) tokens.clear()
        Http::class.java.getDeclaredField("client").also { it.isAccessible = true }.set(null, original)
    }

    /**
     * Coil decodes the SVG faces off the main thread, so an idle composition can still have none drawn.
     * Wait until each avatar's top-left quarter, where the face sits clear of the runtime badge, has ink.
     */
    private fun waitForFaces() = compose.waitUntil(10_000) {
        val avatars = compose.onAllNodesWithTag("agent-identity-avatar", useUnmergedTree = true)
        avatars.fetchSemanticsNodes().indices.all { i ->
            val image = avatars[i].captureToImage().asAndroidBitmap()
            val blank = image.getPixel(0, 0)
            (0 until image.width / 2).any { x -> (0 until image.height / 2).any { y -> image.getPixel(x, y) != blank } }
        }
    }

    private fun shoot(name: String) {
        compose.waitForIdle()
        waitForFaces()
        val dir = inst.targetContext.getExternalFilesDir("presence")!!
        java.io.File(dir, "$name-${if (dark) "dark" else "light"}.png").outputStream().use {
            inst.uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    private fun open(chat: String) {
        compose.setContent {
            NuphosTheme(darkTheme = dark) {
                CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    ChannelScreen(chat, onBack = {})
                }
            }
        }
    }

    private fun waitFor(text: String) =
        compose.waitUntil(30_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }

    @Test fun aGroupChatNamesTheBotWhoseComputerIsOffline() {
        open(args.getString("presenceGroupChat")!!)
        waitFor("Scribe’s computer is offline.")
        compose.onNodeWithTag("offline-strip").assertIsDisplayed()
        // Only the Bot's owner moves it, from its own chat.
        compose.onNodeWithText("Switch runtime").assertDoesNotExist()
        // Its title shows that it opens the chat's Bots.
        compose.onNodeWithTag("chat-bots-entry", useUnmergedTree = true).assertIsDisplayed()
        shoot("presence-group")
    }

    @Test fun aBotsOwnChatShowsTheTasksOfflineStrip() {
        open(args.getString("presenceBotChat")!!)
        waitFor("The computer running this runtime is offline. Open Nuphos on it, or switch to another runtime.")
        compose.onNodeWithText("Switch runtime").assertIsDisplayed()
        // A Bot's chat title opens its triggers, not a list of Bots.
        compose.onNodeWithTag("chat-bots-entry", useUnmergedTree = true).assertDoesNotExist()
        shoot("presence-bot-chat")
    }

    @Test fun aGroupChatsMembersShowWhoCanReply() {
        open(args.getString("presenceGroupChat")!!)
        waitFor("Scribe’s computer is offline.")
        compose.onNodeWithTag("chat-title").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("members-sheet").fetchSemanticsNodes().isNotEmpty() }
        compose.onNode(hasTestTag("member-row") and hasAnyDescendant(hasText("Scribe")) and hasAnyDescendant(hasText("Offline")))
            .assertIsDisplayed()
        compose.onNode(hasTestTag("member-row") and hasAnyDescendant(hasText("Atlas")) and hasAnyDescendant(hasText("Online")))
            .assertIsDisplayed()
        shoot("presence-members")
    }
}
