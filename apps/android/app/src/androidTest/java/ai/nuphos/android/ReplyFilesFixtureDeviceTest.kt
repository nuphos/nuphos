package ai.nuphos.android

import android.content.Context
import android.graphics.Bitmap
import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.navigation.compose.rememberNavController
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.*
import ai.nuphos.android.model.*
import ai.nuphos.android.session.*
import ai.nuphos.android.ui.*
import ai.nuphos.android.ui.chat.ConversationScreen
import ai.nuphos.android.ui.theme.NuphosTheme
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import java.io.File
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList

/** An agent reply that cites a file it sent, through the real conversation screen. Synthetic responses only. */
@RunWith(AndroidJUnit4::class)
class ReplyFilesFixtureDeviceTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val requests = CopyOnWriteArrayList<Request>()
    private val originals = mutableMapOf<String, OkHttpClient>()
    private val token = "reply-files-fixture-no-credentials"
    private val team = "0123456789abcdef0123abcd"
    private val group = "0123456789abcdef01234567"
    private val sent = Instant.parse("2026-11-22T00:00:00Z")
    private lateinit var store: AgentStore
    private lateinit var app: NuphosApplication
    private var savedAccess: Any? = null
    private var savedLastTeam: String? = null
    @Suppress("UNCHECKED_CAST") private fun state(target: Any, name: String, delegated: Boolean = true) =
        target.javaClass.getDeclaredField(name + if (delegated) "\$delegate" else "").also { it.isAccessible = true }.get(target) as MutableState<Any?>
    private val files = TransferDownloadGroup(group, "2099-01-01T00:00:00Z",
        listOf(TransferDownloadFile("f1", "release-notes.txt", "ready", "text/plain", "https://storage.example.test/release-notes.txt", 18)), sent.toString())
    private val network = object : ExternalResource() {
        override fun before() {
            app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
            savedLastTeam = app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).getString("nuphos.workspace.lastTeamId", null)
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                savedAccess = state(AiAccess, "state", false).value
                AiAccess.activate(token)
            }
            val detail = AgentConversationDetail(isOwner = true, agentRuntime = "nuphos", title = "Reply files fixture", messages = listOf(
                ChatMessage(id = "ask", role = ChatMessage.Role.User, createdAt = sent.minusSeconds(60), parts = listOf(ChatPart.Text(text = "Send me the release notes"))),
                ChatMessage(id = "reply", role = ChatMessage.Role.Assistant, createdAt = sent, parts = listOf(ChatPart.Text(
                    text = "Here are the release notes:\n\n![release notes](https://nuphos.ai/_reply-images/$group)\n\nThey cover this week's fixes.")))))
            val client = OkHttpClient.Builder().addInterceptor { chain ->
                val request = chain.request(); requests += request
                val path = request.url.encodedPath
                val body = when {
                    path == "/agent/conversations/saved" -> Http.json.encodeToString(AgentConversationDetail.serializer(), detail)
                    path.endsWith("/file-transfers/downloads") -> """{"groups":[${Http.json.encodeToString(TransferDownloadGroup.serializer(), files)}]}"""
                    path == "/teams/$team/file-transfers/$group/download" -> Http.json.encodeToString(TransferDownloadGroup.serializer(), files)
                    path == "/agent/conversations/saved/resources" -> """{"resources":[]}"""
                    path == "/agent/auto-mode/bypass" -> """{"bypass":false}"""
                    path == "/teams/$team/favorites" -> """{"entries":[],"revision":0}"""
                    else -> null
                }
                Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(if (body == null) 500 else 200)
                    .message("fixture").body((body ?: "{}").toResponseBody(Http.jsonMedia)).build()
            }.build()
            for (name in listOf("client", "chatClient")) {
                val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
                originals[name] = field.get(null) as OkHttpClient; field.set(null, client)
            }
        }
        override fun after() {
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                if (::store.isInitialized) store.disposeForConsent()
                state(AiAccess, "state", false).value = savedAccess
                val editor = app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).edit()
                if (savedLastTeam == null) editor.remove("nuphos.workspace.lastTeamId") else editor.putString("nuphos.workspace.lastTeamId", savedLastTeam)
                editor.commit()
            }
            originals.forEach { (name, client) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client) }
        }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(network).around(compose)
    private fun screenshot(name: String) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val bitmap = requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(instrumentation.targetContext.cacheDir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }

    @Test fun aCitedFileShowsOnceWhereTheReplyCitesIt() {
        compose.runOnIdle {
            AiAccess.grant(token)
            store = AgentStore(token, compose.activity)
            state(store, "selectedTeam").value = Team(team, "Fixture")
            val auth = AuthSession(app, app.tokenStore)
            AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, token)
            compose.activity.setContent {
                NuphosTheme { CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    ConversationScreen("saved", false, {}, rememberNavController())
                } }
            }
        }
        compose.waitUntil(10_000) { compose.onAllNodesWithContentDescription("Save release-notes.txt").fetchSemanticsNodes().isNotEmpty() }
        compose.waitUntil(10_000) { requests.any { it.url.encodedPath.endsWith("/file-transfers/downloads") } }
        screenshot("reply-files-light")
        compose.onAllNodesWithContentDescription("Save release-notes.txt").assertCountEquals(1)
        compose.onAllNodesWithText("_reply-images", substring = true).assertCountEquals(0)
        val card = compose.onNodeWithContentDescription("Save release-notes.txt").fetchSemanticsNode().boundsInRoot
        val before = compose.onNodeWithText("Here are the release notes:", substring = true).fetchSemanticsNode().boundsInRoot
        val after = compose.onNodeWithText("They cover this week's fixes.", substring = true).fetchSemanticsNode().boundsInRoot
        assertTrue("The card sits between the text around the citation", before.bottom <= card.top && card.bottom <= after.top)
        assertTrue(requests.any { it.url.encodedPath == "/teams/$team/file-transfers/$group/download" })
    }
}
