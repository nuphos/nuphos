package ai.nuphos.android

import android.content.Context
import android.app.Instrumentation
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.content.pm.PackageManager
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.printToLog
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import ai.nuphos.android.data.Http
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.session.ConnectorIntents
import ai.nuphos.android.session.ConversationLink
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.cancel
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.IOException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Explicitly opted-in emulator or isolated app only. HTTP is synthetic and socket-free. */
@RunWith(AndroidJUnit4::class)
class ConversationLinksFixtureDeviceTest {
    @get:Rule val compose = createEmptyComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private lateinit var app: NuphosApplication
    private lateinit var originalAuth: AuthSession
    private lateinit var auth: AuthSession
    private var activity: MainActivity? = null
    private val originals = mutableMapOf<String, OkHttpClient>()
    private val requests = CopyOnWriteArrayList<Request>()
    private val unexpected = CopyOnWriteArrayList<String>()
    private val a = "507f1f77bcf86cd799439011"
    private val b = "507f1f77bcf86cd799439012"
    private val token = "conversation-link-synthetic-no-credentials"
    @Volatile private var detailStatus = 200
    @Volatile private var adaptiveHistory = false

    @Suppress("UNCHECKED_CAST")
    private fun setState(value: AuthSession.State) {
        val field = AuthSession::class.java.getDeclaredField("state\$delegate").also { it.isAccessible = true }
        (field.get(auth) as MutableState<AuthSession.State>).value = value
    }

    private fun identity() = instrumentation.runOnMainSync {
        AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, token)
        AiAccess.activate(token)
        AiAccess.grant(token)
        setState(AuthSession.State.SignedIn(NuphosUser.preview))
    }

    @Before fun setup() {
        val optedIn = InstrumentationRegistry.getArguments().getString("isolatedConversationLinks") == "true"
        assumeTrue("Disposable emulator fixture is disabled by default", optedIn)
        assertTrue("Physical devices require the isolated fixture package",
            Build.HARDWARE in setOf("ranchu", "goldfish") || instrumentation.targetContext.packageName == "ai.nuphos.android.adaptivefixture")
        app = instrumentation.targetContext.applicationContext as NuphosApplication
        assertNull("Refuse to replace an installed account", app.tokenStore.read())
        originalAuth = app.authSession
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            requests += request
            val path = request.url.encodedPath
            var status = 200
            val body = when {
                request.method != "GET" -> {
                    unexpected += "${request.method} $path"
                    throw IOException("No link-triggered writes are allowed")
                }
                path == "/auth/ai-consent" -> """{"version":"2026-09-28","accepted":true}"""
                path == "/auth/me" -> Http.json.encodeToString(NuphosUser.serializer(), NuphosUser.preview)
                path == "/teams" -> """{"teams":[{"id":"$a","name":"Fixture Alpha"},{"id":"$b","name":"Fixture Beta"}]}"""
                path == "/agent/credential-options" -> """{"options":{}}"""
                path.endsWith("/agent-runtimes/quota") -> """{"quotas":{}}"""
                path.endsWith("/agent-runtimes") -> """{"runtimes":[]}"""
                path == "/agent/conversations" -> if (adaptiveHistory)
                    """{"conversations":[{"sessionId":"fixture-chat","teamId":"$a","title":"Fixture first"},{"sessionId":"second-fixture-chat","teamId":"$a","title":"Fixture second"}],"nextCursor":null}"""
                    else """{"conversations":[],"nextCursor":null}"""
                path.endsWith("/resources") -> """{"resources":[]}"""
                path.startsWith("/agent/conversations/") -> {
                    status = detailStatus
                    if (status == 200) """{"title":"Linked fixture chat","messages":[{"id":"fixture-answer","role":"assistant","parts":[{"type":"text","text":"Fixture content: ${request.url.pathSegments.last()}"}]}],"isOwner":false,"readOnly":true}"""
                    else """{"error":{"message":"fixture unavailable"}}"""
                }
                path.endsWith("/favorites") -> """{"entries":[],"revision":0}"""
                path.endsWith("/members") -> """{"members":[]}"""
                path.endsWith("/connectors") -> "{}"
                path == "/agent/plans" -> """{"plans":[],"hasMore":false}"""
                path == "/agent/plan-approval-policy" -> """{"requesterApprovalRequired":true,"minimumOtherApprovals":0}"""
                path == "/agent/auto-mode/bypass" -> """{"bypass":false}"""
                else -> {
                    unexpected += "${request.method} $path"
                    throw IOException("Unexpected synthetic request")
                }
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(status)
                .message("fixture").body(body.toResponseBody(Http.jsonMedia)).build()
        }.build()
        for (name in listOf("client", "chatClient")) {
            val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
            originals[name] = field.get(null) as OkHttpClient
            field.set(null, client)
        }
        instrumentation.runOnMainSync {
            app.conversationLinks.value.value?.let(app.conversationLinks::complete)
            ConnectorIntents.callback.value = null
            auth = AuthSession(app, app.tokenStore)
            NuphosApplication::class.java.getDeclaredField("authSession").also { it.isAccessible = true }.set(app, auth)
            app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).edit()
                .putString("nuphos.workspace.lastTeamId", a).commit()
        }
    }

    @After fun cleanup() {
        activity?.let { target ->
            val destroyed = CountDownLatch(1)
            val callback = androidx.test.runner.lifecycle.ActivityLifecycleCallback { current, stage ->
                if (current === target && stage == Stage.DESTROYED) destroyed.countDown()
            }
            instrumentation.runOnMainSync {
                val monitor = ActivityLifecycleMonitorRegistry.getInstance()
                monitor.addLifecycleCallback(callback)
                if (monitor.getLifecycleStageOf(target) == Stage.DESTROYED) destroyed.countDown()
                else target.finish()
            }
            assertTrue("Fixture Activity did not close", destroyed.await(5, TimeUnit.SECONDS))
            instrumentation.runOnMainSync { ActivityLifecycleMonitorRegistry.getInstance().removeLifecycleCallback(callback) }
        }
        if (::auth.isInitialized) instrumentation.runOnMainSync {
            (AuthSession::class.java.getDeclaredField("scope").also { it.isAccessible = true }.get(auth) as CoroutineScope).cancel()
            AiAccess.revoke()
            NuphosApplication::class.java.getDeclaredField("authSession").also { it.isAccessible = true }.set(app, originalAuth)
            app.conversationLinks.value.value?.let(app.conversationLinks::complete)
        }
        originals.forEach { (name, client) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client) }
        if (::app.isInitialized) assertNull("Fixture persisted an account", app.tokenStore.read())
        assertTrue("Unexpected requests: $unexpected", unexpected.isEmpty())
    }

    private fun link(team: String = a, id: String = "fixture-chat") = "https://nuphos.ai/teams/$team/agent/$id"
    private fun awaitActivity(start: () -> Unit): MainActivity {
        // Match the Activity class rather than the original URI: production consumes its intent.
        val monitor = Instrumentation.ActivityMonitor(MainActivity::class.java.name, null, false)
        instrumentation.addMonitor(monitor)
        try {
            start()
            return monitor.waitForActivityWithTimeout(10_000) as? MainActivity
                ?: throw AssertionError("MainActivity did not launch")
        } finally { instrumentation.removeMonitor(monitor) }
    }
    private fun launch(url: String) {
        activity = awaitActivity {
            app.startActivity(Intent(app, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse(url))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
    private fun recreate() {
        val old = activity!!
        var replacement: MainActivity? = null
        val resumed = CountDownLatch(1)
        val callback = androidx.test.runner.lifecycle.ActivityLifecycleCallback { current, stage ->
            if (current is MainActivity && current !== old && stage == Stage.RESUMED) {
                replacement = current
                resumed.countDown()
            }
        }
        instrumentation.runOnMainSync {
            ActivityLifecycleMonitorRegistry.getInstance().addLifecycleCallback(callback)
            old.recreate()
        }
        try {
            assertTrue("Recreated Activity never resumed", resumed.await(10, TimeUnit.SECONDS))
            activity = replacement
        } finally {
            instrumentation.runOnMainSync { ActivityLifecycleMonitorRegistry.getInstance().removeLifecycleCallback(callback) }
        }
    }
    private fun warm(url: String) {
        app.startActivity(Intent(app, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse(url))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
    }
    private fun awaitText(text: String) {
        compose.waitUntil(10_000) {
            runCatching { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }.getOrDefault(false)
        }
        compose.onNodeWithText(text).assertIsDisplayed()
    }

    private fun snapshot(name: String) {
        if (InstrumentationRegistry.getArguments().getString("captureSynthetic") != "true") return
        val file = java.io.File(app.getExternalFilesDir(null), "$name.png")
        file.outputStream().use {
            compose.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
        val config = activity!!.resources.configuration
        java.io.File(app.getExternalFilesDir(null), "$name.json").writeText(
            """{"widthDp":${config.screenWidthDp},"heightDp":${config.screenHeightDp},"orientation":${config.orientation}}"""
        )
    }

    @Test fun adaptiveBackNewDraftAndReopenAfterRecreation() {
        adaptiveHistory = true
        identity()
        launch(link())
        awaitText("Fixture content: fixture-chat")
        snapshot("selected-chat")
        val wide = activity!!.resources.configuration.screenWidthDp >= 600
        if (wide) compose.onNodeWithText("New agent").performClick()
        else compose.onNodeWithContentDescription("Back").performClick()
        awaitText("Fixture first")
        if (wide) awaitText("Start a new agent")
        compose.onNode(hasSetTextAction()).performClick()
        compose.onNode(hasSetTextAction()).performTextReplacement("Synthetic new draft")
        snapshot("new-chat")
        recreate()
        awaitText("Synthetic new draft")
        compose.onNodeWithText("Fixture second").performClick()
        awaitText("Fixture content: second-fixture-chat")
        recreate()
        awaitText("Fixture content: second-fixture-chat")
        snapshot("recreated-chat")
        assertNull(app.conversationLinks.value.value)
    }

    @Test fun simulatedWindowResizeKeepsSelectionAndNextChatLoads() {
        val args = InstrumentationRegistry.getArguments()
        val size = args.getString("compactWindowSize")
        assumeTrue("Explicit simulated viewport size is required", size != null)
        check(size!!.matches(Regex("[0-9]{3,4}x[0-9]{3,4}")))
        val rotation = args.getString("expandedWindowRotation")?.toIntOrNull()
        assumeTrue("Explicit expanded viewport rotation is required", rotation != null)
        check(rotation!! in 0..3)
        fun shell(value: String): String = instrumentation.uiAutomation.executeShellCommand(value).use { fd ->
            android.os.ParcelFileDescriptor.AutoCloseInputStream(fd).use { it.bufferedReader().readText() }
        }
        val originalRotation = shell("wm user-rotation").trim()
        check(originalRotation.matches(Regex("free|lock [0-3]")))
        fun command(value: String) {
            shell("wm size $value")
            shell("wm user-rotation lock $rotation")
        }
        fun awaitWidth(wide: Boolean) {
            compose.waitUntil(10_000) {
                var matches = false
                instrumentation.runOnMainSync {
                    val resumed = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED)
                        .filterIsInstance<MainActivity>().singleOrNull()
                    if (resumed != null) {
                        activity = resumed
                        matches = (resumed.resources.configuration.screenWidthDp >= 600) == wide
                    }
                }
                matches
            }
        }
        shell("wm user-rotation lock $rotation")
        identity()
        adaptiveHistory = true
        launch(link())
        awaitText("Fixture content: fixture-chat")
        awaitWidth(true)
        try {
            command(size)
            awaitWidth(false)
            awaitText("Fixture content: fixture-chat")
            snapshot("collapse-selected-chat")
            warm(link(id = "second-fixture-chat"))
            awaitText("Fixture content: second-fixture-chat")
            snapshot("opened-after-collapse")
            command("reset")
            awaitWidth(true)
            awaitText("Fixture content: second-fixture-chat")
            snapshot("expanded-selected-chat")
        } finally {
            shell("wm size reset")
            shell("wm user-rotation $originalRotation")
        }
        assertNull(app.conversationLinks.value.value)
    }

    @Test fun coldAndWarmLaunchUseAuthorizedWorkspaceAndDoNotReplayOnRecreation() {
        identity()
        launch(link())
        awaitText("Fixture content: fixture-chat")
        assertNull(app.conversationLinks.value.value)
        val originalActivity = activity
        warm(link(b, "other-fixture-chat"))
        compose.waitUntil(10_000) { requests.any { it.url.encodedPath.endsWith("/other-fixture-chat") } && app.conversationLinks.value.value == null }
        awaitText("Fixture content: other-fixture-chat")
        instrumentation.runOnMainSync {
            val resumed = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED)
                .filterIsInstance<MainActivity>().single()
            assertSame("Warm intent created a second activity", originalActivity, resumed)
            assertNull("Intent was not consumed", resumed.intent.data)
        }
        assertEquals(b, requests.last { it.url.encodedPath.endsWith("/other-fixture-chat") }.url.queryParameter("teamId"))
        val membershipReads = requests.count { it.url.encodedPath == "/teams" }
        recreate()
        awaitText("Fixture content: other-fixture-chat")
        // A restored host reads memberships once; replaying the consumed intent would add another read.
        assertEquals(membershipReads + 1, requests.count { it.url.encodedPath == "/teams" })
        assertNull(app.conversationLinks.value.value)
    }

    @Test fun signedOutLinkSurvivesRecreationAndSyntheticLogin() {
        instrumentation.runOnMainSync { setState(AuthSession.State.SignedOut(null)) }
        launch(link(b))
        compose.waitUntil(5_000) { app.conversationLinks.value.value != null }
        assertFalse(requests.any { it.url.encodedPath.startsWith("/agent/conversations") })
        recreate()
        assertEquals(ConversationLink.parse(link(b)), app.conversationLinks.value.value?.destination)
        identity() // Simulate a completed login; no real login or token-store write.
        awaitText("Fixture content: fixture-chat")
        assertNull(app.conversationLinks.value.value)
        assertEquals(b, requests.last { it.url.encodedPath.endsWith("/fixture-chat") }.url.queryParameter("teamId"))
    }

    @Test fun nonMemberLinkNeverReadsConversation() {
        identity()
        launch(link("507f1f77bcf86cd799439099"))
        awaitText("This agent is unavailable or your account does not have access.")
        assertFalse(requests.any { it.url.encodedPath == "/agent/conversations/fixture-chat" })
        assertNull(app.conversationLinks.value.value)
    }

    @Test fun forbiddenAndDeletedConversationsHaveNoContent() {
        identity()
        detailStatus = 403
        launch(link())
        awaitText("This agent is unavailable or your account does not have access.")
        assertTrue(compose.onAllNodesWithText("Fixture content: fixture-chat").fetchSemanticsNodes().isEmpty())
        detailStatus = 404
        warm(link(id = "deleted-fixture-chat"))
        compose.waitUntil(10_000) { requests.any { it.url.encodedPath.endsWith("/deleted-fixture-chat") } && app.conversationLinks.value.value == null }
        awaitText("This agent is unavailable or your account does not have access.")
        assertTrue(compose.onAllNodesWithText("Fixture content: deleted-fixture-chat").fetchSemanticsNodes().isEmpty())
    }

    @Test fun malformedUrlsAndOAuthReturnsCannotSupplyIdentityOrDestination() {
        instrumentation.runOnMainSync { setState(AuthSession.State.SignedOut(null)) }
        launch(link() + "?token=attacker")
        assertNull(app.conversationLinks.value.value)
        warm("nuphos://google-callback?token=attacker")
        instrumentation.waitForIdleSync()
        assertNull(auth.token)
        assertTrue(auth.state is AuthSession.State.SignedOut)
        assertNull(app.conversationLinks.value.value)
        warm("nuphos://github-callback?state=fixture")
        compose.waitUntil(5_000) { ConnectorIntents.callback.value != null }
        assertEquals("nuphos://github-callback?state=fixture", ConnectorIntents.callback.value)
    }

    @Test fun platformManifestMatcherCoversOnlySupportedConversationPaths() {
        fun matches(url: String): Boolean {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(app.packageName)
                .addCategory(Intent.CATEGORY_BROWSABLE).addCategory(Intent.CATEGORY_DEFAULT)
            return app.packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
                .any { it.activityInfo.name == MainActivity::class.java.name }
        }
        assertTrue(matches(link()))
        assertTrue(matches(link() + "/"))
        assertFalse(matches(link() + "/extra"))
        assertFalse(matches("https://nuphos.ai/teams/$a/settings"))
        assertFalse(matches("https://nuphos.ai/teams/$a/agent/"))
        assertFalse(matches(link().replace("nuphos.ai", "nuphos.ai.evil.example")))
        assertFalse(matches(link().replace("https:", "http:")))
        assertTrue(matches("nuphos://google-callback"))
        assertTrue(matches("nuphos://github-callback"))
    }
}
