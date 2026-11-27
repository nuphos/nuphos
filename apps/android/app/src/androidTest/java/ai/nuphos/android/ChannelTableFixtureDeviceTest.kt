package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
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

/** Synthetic chat only: a Bot post with a Markdown table renders in the chat instead of crashing it. Never touches a live API. */
@RunWith(AndroidJUnit4::class)
class ChannelTableFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val token = "synthetic-chats-table"
    private val team = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A")
    private lateinit var store: AgentStore
    private lateinit var auth: AuthSession
    private lateinit var tokens: TokenStore
    private lateinit var original: OkHttpClient
    private var savedAccess: Any? = null
    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>

    private val table = "Release status:\\n\\n| Service | State |\\n| --- | --- |\\n| Backend | Healthy |\\n| Desktop | Rolling out |"

    private fun detail(): String {
        val post = """{"id":"p1","role":"user","metadata":{"version":1,"sender":{"type":"agent","id":"agent-ops","displayName":"Release ops"},"sentAt":"2026-11-03T09:01:00Z","sourceSessionId":"agent-ops"},"parts":[{"type":"text","text":"$table"}]}"""
        return """{"kind":"channel","title":"chat-a","transcriptUpdatedAt":"t1","messageCount":1,"activitySeq":1,"messages":[$post]}"""
    }

    @Before fun before() {
        val target = inst.targetContext
        val context = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("chats-table-fixture", mode)
        }
        val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
        original = field.get(null) as OkHttpClient
        field.set(null, OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val path = request.url.encodedPath
            val body = when {
                path.endsWith("/agent/conversations/chat-a") -> detail()
                path.endsWith("/agent/conversations/agent-ops") -> """{"sessionId":"agent-ops","title":"Release ops","isOwner":true,"messages":[]}"""
                path.endsWith("/agents") -> """{"agents":[{"sessionId":"agent-ops","title":"Release ops"}]}"""
                path.endsWith("/agent/conversations") -> """{"conversations":[],"hasMore":false}"""
                path.endsWith("/read") -> """{"activitySeq":1,"readSeq":1,"unread":false}"""
                else -> "{}"
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .body(body.toResponseBody(Http.jsonMedia)).build()
        }.build())
        val app = target.applicationContext as NuphosApplication
        val authContext = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("chats_table_fixture_$name", mode)
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

    @Test fun aBotPostWithATableShowsItsCells() {
        compose.setContent {
            NuphosTheme {
                CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    ChannelScreen("chat-a", onBack = { fail("The chat closed itself") }, onLink = {})
                }
            }
        }
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Release status:", substring = true).fetchSemanticsNodes().isNotEmpty() }
        for (cell in listOf("Service", "State", "Backend", "Healthy", "Desktop", "Rolling out"))
            // The table renderer pads each cell's text with a trailing space.
            compose.onAllNodesWithText(cell, substring = true, useUnmergedTree = true).onFirst().assertExists()
    }
}
