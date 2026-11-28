package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
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
import java.io.File
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Synthetic chat only: the records Nuphos leaves in a chat show as muted lines. Never touches a live API. */
@RunWith(AndroidJUnit4::class)
class ChannelRecordsFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val token = "synthetic-chat-records"
    private val team = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A")
    private lateinit var store: AgentStore
    private lateinit var auth: AuthSession
    private lateinit var tokens: TokenStore
    private lateinit var original: OkHttpClient
    private var savedAccess: Any? = null
    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>

    private fun post(id: String, type: String, sender: String, name: String, minute: Int, text: String) =
        """{"id":"$id","role":"user","metadata":{"version":1,"sender":{"type":"$type","id":"$sender","displayName":"$name"},"sentAt":"2026-11-16T09:0$minute:00Z"},"parts":[{"type":"text","text":"$text"}]}"""

    private val messages = listOf(
        post("p1", "user", "user-ann", "Ann", 1, "Kickoff notes are in the doc."),
        post("p2", "user", "user-bruce", "Bruce", 2, "Ship today?"),
        post("r1", "system", "nuphos:decision", "Nuphos", 3, "Ann answered: Ship today? → Ship it"),
        post("r2", "system", "nuphos", "Nuphos", 4, "Release Helper finished a turn."),
        post("r3", "system", "nuphos:chat", "Nuphos", 5, "Ann left. Bruce now owns this chat."),
    ).joinToString(",")

    @Before fun before() {
        val target = inst.targetContext
        val context = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("chat-records-fixture", mode)
        }
        val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
        original = field.get(null) as OkHttpClient
        field.set(null, OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val path = request.url.encodedPath
            val body = when {
                path.endsWith("/agent/conversations/chat-a") ->
                    """{"kind":"channel","group":true,"title":"Launch plan","transcriptUpdatedAt":"t5","messageCount":5,"activitySeq":5,"messages":[$messages]}"""
                path.endsWith("/agents") -> """{"agents":[]}"""
                path.endsWith("/agent/conversations") -> """{"conversations":[],"hasMore":false}"""
                path.endsWith("/read") -> """{"activitySeq":5,"readSeq":5,"unread":false}"""
                else -> "{}"
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .body(body.toResponseBody(Http.jsonMedia)).build()
        }.build())
        val app = target.applicationContext as NuphosApplication
        val authContext = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("chat_records_fixture_$name", mode)
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

    private fun has(text: String) = compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()

    private fun capture(name: String) {
        compose.waitForIdle()
        inst.waitForIdleSync()
        File(inst.targetContext.getExternalFilesDir(null), name).outputStream().use {
            inst.uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test fun anAnswerAndANewOwnerShowAsRecordsAndOtherNoticesStayHidden() {
        compose.setContent {
            NuphosTheme {
                CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    ChannelScreen("chat-a", onBack = { fail("The chat closed itself") }, onLink = {})
                }
            }
        }
        compose.waitUntil(8_000) { has("Kickoff notes are in the doc.") }
        capture("chat-records.png")
        compose.onNodeWithText("Ann answered: Ship today? → Ship it").assertIsDisplayed()
        compose.onNodeWithText("Ann left. Bruce now owns this chat.").assertIsDisplayed()
        compose.onNodeWithText("Release Helper finished a turn.").assertDoesNotExist()
        compose.onAllNodesWithTag("channel-record").assertCountEquals(2)
    }
}
