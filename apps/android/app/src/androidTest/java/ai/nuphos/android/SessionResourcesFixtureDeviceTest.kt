package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.navigation.compose.rememberNavController
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.*
import ai.nuphos.android.model.*
import ai.nuphos.android.session.*
import ai.nuphos.android.ui.*
import ai.nuphos.android.ui.chat.ConversationScreen
import ai.nuphos.android.ui.chat.SessionResourceStrip
import ai.nuphos.android.ui.theme.NuphosTheme
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.IOException
import java.util.concurrent.CopyOnWriteArrayList

/** Run only in a separate ai.nuphos.android.resourcefixture install. No real data or sockets. */
@RunWith(AndroidJUnit4::class)
class SessionResourcesFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val pr = SessionResource("pr", "github", "Synthetic pull request", "https://github.com/example/synthetic/pull/42", "open", number = 42)
    @Before fun isolate() {
        assumeTrue("Requires isolated fixture package", instrumentation.targetContext.packageName == "ai.nuphos.android.resourcefixture")
        val app = instrumentation.targetContext.applicationContext as NuphosApplication
        assertNull("Fixture must never contain credentials", app.tokenStore.read())
    }
    private fun snap(name: String) {
        compose.waitForIdle()
        val image = instrumentation.uiAutomation.takeScreenshot() ?: error("No screenshot")
        val dir = File(instrumentation.targetContext.filesDir, "resource-synthetic").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
        image.recycle()
    }
    @Test fun chipsStatesSafeLinksLoadingEmptyAndFailure() {
        var dark by mutableStateOf(false)
        var loading by mutableStateOf(false)
        var failed by mutableStateOf(false)
        var rows by mutableStateOf(listOf(pr, pr.copy(id = "closed", state = "closed", number = 43), pr.copy(id = "merged", state = "merged", number = 44),
            pr.copy(id = "issue", provider = "linear", title = "SYN-1 Synthetic issue", state = "In Review", number = null, url = "https://linear.app/example/issue/SYN-1"),
            pr.copy(id = "unsafe", title = "Unsafe synthetic URL", url = "javascript:alert(1)", number = 45)))
        val opened = mutableListOf<String>()
        var noHandler = false
        var retries = 0
        compose.setContent {
            NuphosTheme(darkTheme = dark) {
                CompositionLocalProvider(LocalUriHandler provides object : UriHandler {
                    override fun openUri(uri: String) { if (noHandler) throw IllegalArgumentException("Synthetic missing browser"); opened += uri }
                }) {
                    Surface(Modifier.fillMaxSize()) {
                        Column(Modifier.padding(top = 48.dp)) {
                            Text("Synthetic fixture · no real service data", Modifier.padding(16.dp))
                            SessionResourceStrip(rows, loading, failed) { retries++ }
                            Text("Synthetic transcript remains available", Modifier.padding(16.dp))
                        }
                    }
                }
            }
        }
        compose.onNodeWithText("#42").performClick()
        assertEquals(listOf(pr.url), opened)
        snap("synthetic-resources-light")
        compose.runOnIdle { dark = true }; snap("synthetic-resources-dark")
        compose.onNode(hasScrollAction()).performScrollToIndex(2)
        compose.onNodeWithText("#44").assertExists()
        compose.onNode(hasScrollAction()).performScrollToIndex(3)
        compose.onNodeWithText("SYN-1").performClick()
        assertEquals("https://linear.app/example/issue/SYN-1", opened.last())
        snap("synthetic-linear-dark")
        compose.onNode(hasScrollAction()).performScrollToIndex(4)
        compose.onNodeWithContentDescription("GitHub, Unsafe synthetic URL, open, link unavailable").assertIsNotEnabled()
        compose.onNodeWithText("Link unavailable").assertExists()
        snap("synthetic-unsafe-dark")
        compose.runOnIdle { dark = false }; snap("synthetic-unsafe-light")
        compose.runOnIdle { dark = true }
        assertEquals(2, opened.size)
        compose.runOnIdle { rows = listOf(pr); noHandler = true }
        compose.onNodeWithText("#42").performClick()
        compose.onNodeWithText("Could not open this link.").assertExists()
        compose.runOnIdle { rows = emptyList(); loading = true }
        compose.onNodeWithContentDescription("Loading linked resources").assertExists()
        compose.onNodeWithText("Synthetic transcript remains available").assertExists()
        compose.runOnIdle { loading = false; failed = true }
        compose.onNodeWithText("Retry").performClick(); assertEquals(1, retries)
        snap("synthetic-resources-failure")
        compose.runOnIdle { failed = false }
        compose.onNodeWithText("Linked resources unavailable").assertDoesNotExist()
        compose.onNodeWithText("#42").assertDoesNotExist()
        snap("synthetic-resources-empty")
    }
    @Suppress("UNCHECKED_CAST")
    private fun setState(target: Any, name: String, value: Any?) {
        val field = target.javaClass.getDeclaredField("$name\$delegate").also { it.isAccessible = true }
        (field.get(target) as MutableState<Any?>).value = value
    }
    @Test fun actualConversationRefreshesOnForegroundAndIsolatesSessionsAndDenials() {
        val app = instrumentation.targetContext.applicationContext as NuphosApplication
        val originals = mutableMapOf<String, OkHttpClient>()
        val requests = CopyOnWriteArrayList<Request>()
        val unexpected = CopyOnWriteArrayList<String>()
        val token = "synthetic-resource-no-credentials"
        var status = 200
        var resourceState = "open"
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val req = chain.request(); requests += req
            if (req.method != "GET") { unexpected += req.method; throw IOException("No writes allowed") }
            val path = req.url.encodedPath
            var code = 200
            val body = when {
                path.endsWith("/resources") -> {
                    assertEquals("fixture-team", req.url.queryParameter("teamId"))
                    assertEquals("Bearer $token", req.header("Authorization"))
                    code = status
                    if (status != 200) """{"error":{"message":"Synthetic denied"}}"""
                    else if (path.contains("/empty/")) """{"resources":[],"canManage":false}"""
                    else Http.json.encodeToString(SessionResourcesEnvelope.serializer(), SessionResourcesEnvelope(listOf(pr.copy(state = resourceState))))
                }
                path == "/agent/conversations/saved" || path == "/agent/conversations/empty" ->
                    """{"title":"Synthetic resource conversation","agentRuntime":"nuphos","isOwner":false,"readOnly":true,"messages":[{"id":"m","role":"assistant","parts":[{"type":"text","text":"Synthetic chat still available"}]}]}"""
                path.endsWith("/favorites") -> """{"entries":[],"revision":0}"""
                path == "/agent/auto-mode/bypass" -> """{"bypass":false}"""
                else -> { unexpected += path; throw IOException("Unexpected synthetic request") }
            }
            Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(code).message("synthetic")
                .body(body.toResponseBody(Http.jsonMedia)).build()
        }.build()
        lateinit var store: AgentStore
        lateinit var auth: AuthSession
        var storeReady = false
        lateinit var lifecycle: LifecycleRegistry
        var selected by mutableStateOf("saved")
        try {
            for (name in listOf("client", "chatClient")) {
                val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
                originals[name] = field.get(null) as OkHttpClient; field.set(null, client)
            }
            compose.runOnIdle {
                AiAccess.activate(token); AiAccess.grant(token)
                store = AgentStore(token, app)
                storeReady = true
                setState(store, "selectedTeam", Team("fixture-team", "Synthetic team"))
                // An already-running session must still show its existing links on first entry.
                setState(store.session("saved", "Synthetic resource conversation"), "isStreaming", true)
                auth = AuthSession(app, app.tokenStore)
                AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, token)
            }
            val fixtureOwner = object : LifecycleOwner { override val lifecycle get() = lifecycle }
            compose.runOnIdle { lifecycle = LifecycleRegistry(fixtureOwner); lifecycle.currentState = Lifecycle.State.RESUMED }
            compose.setContent { NuphosTheme { CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth,
                LocalLifecycleOwner provides fixtureOwner) {
                ConversationScreen(selected, false, {}, rememberNavController())
            } } }
            compose.waitUntil(8000) { compose.onAllNodesWithText("#42").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Synthetic chat still available").assertExists()
            var activeReads = requests.count { it.url.encodedPath.endsWith("/resources") }
            compose.runOnIdle { lifecycle.currentState = Lifecycle.State.CREATED }
            compose.waitForIdle()
            compose.runOnIdle { lifecycle.currentState = Lifecycle.State.RESUMED }
            compose.waitUntil(8000) { requests.count { it.url.encodedPath.endsWith("/resources") } > activeReads }
            compose.waitForIdle()
            activeReads = requests.count { it.url.encodedPath.endsWith("/resources") }
            compose.onNodeWithContentDescription("Refresh linked resources").performClick()
            compose.waitUntil(8000) { requests.count { it.url.encodedPath.endsWith("/resources") } > activeReads }
            val initialReads = requests.count { it.url.encodedPath.endsWith("/resources") }
            compose.runOnIdle {
                assertTrue(store.session("saved", "Synthetic resource conversation").isStreaming)
                setState(store.session("saved", "Synthetic resource conversation"), "isStreaming", false)
            }
            compose.waitUntil(8000) { requests.count { it.url.encodedPath.endsWith("/resources") } > initialReads }
            compose.runOnIdle { resourceState = "merged" }
            // Allow Compose to observe each lifecycle state before resuming.
            compose.runOnIdle { lifecycle.currentState = Lifecycle.State.CREATED }
            compose.waitForIdle()
            compose.runOnIdle { lifecycle.currentState = Lifecycle.State.RESUMED }
            compose.waitUntil(8000) { compose.onAllNodesWithText("Merged").fetchSemanticsNodes().isNotEmpty() }
            snap("synthetic-conversation-merged")
            val beforeTurn = requests.count { it.url.encodedPath.endsWith("/resources") }
            compose.runOnIdle {
                resourceState = "closed"
                setState(store.session("saved", "Synthetic resource conversation"), "isStreaming", true)
            }
            compose.waitForIdle()
            assertEquals(beforeTurn, requests.count { it.url.encodedPath.endsWith("/resources") })
            compose.runOnIdle { setState(store.session("saved", "Synthetic resource conversation"), "isStreaming", false) }
            compose.waitUntil(8000) { compose.onAllNodesWithText("Closed").fetchSemanticsNodes().isNotEmpty() }
            assertTrue(requests.count { it.url.encodedPath.endsWith("/resources") } > beforeTurn)
            compose.runOnIdle { selected = "empty" }
            compose.waitUntil(8000) { requests.any { it.url.encodedPath == "/agent/conversations/empty/resources" } }
            compose.waitForIdle(); compose.onNodeWithText("#42").assertDoesNotExist()
            compose.onNodeWithText("Synthetic chat still available").assertExists()
            compose.runOnIdle { status = 403; selected = "saved" }
            compose.waitUntil(8000) { compose.onAllNodesWithText("Linked resources unavailable").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Synthetic chat still available").assertExists()
            compose.onNodeWithText("#42").assertDoesNotExist()
            compose.runOnIdle { status = 200 }
            compose.onNodeWithText("Retry").performClick()
            compose.waitUntil(8000) { compose.onAllNodesWithText("#42").fetchSemanticsNodes().isNotEmpty() }
            assertTrue(unexpected.toString(), unexpected.isEmpty())
            assertTrue(requests.count { it.url.encodedPath.endsWith("/resources") } >= 5)
        } finally {
            compose.runOnIdle { if (storeReady) store.disposeForConsent(); AiAccess.revoke() }
            originals.forEach { (name, old) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, old) }
        }
    }
}
