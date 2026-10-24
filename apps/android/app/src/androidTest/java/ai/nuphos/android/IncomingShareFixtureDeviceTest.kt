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
import androidx.compose.ui.test.onNodeWithTag
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
class IncomingShareFixtureDeviceTest {
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
    private val senderPackage get() = if (instrumentation.targetContext.packageName.endsWith("sharepersist1359")) "ai.nuphos.sharepersist1359.sender" else "ai.nuphos.shareinput1355.sender"
    private val token = "incoming-share-synthetic-no-credentials"
    @Volatile private var detailStatus = 200
    @Volatile private var adaptiveHistory = true

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
        val optedIn = InstrumentationRegistry.getArguments().getString("isolatedIncomingShares") == "true"
        assumeTrue("Disposable emulator fixture is disabled by default", optedIn)
        assertTrue("Physical devices require the isolated fixture package",
            Build.HARDWARE in setOf("ranchu", "goldfish") || instrumentation.targetContext.packageName in setOf("ai.nuphos.android.shareinput1355", "ai.nuphos.android.sharepersist1359"))
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
                    if (status == 200) """{"title":"Linked fixture chat","messages":[{"id":"fixture-answer","role":"assistant","parts":[{"type":"text","text":"Fixture content: ${request.url.pathSegments.last()}"}]}],"isOwner":false,"readOnly":false}"""
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
        kotlinx.coroutines.runBlocking { app.incomingShares.awaitIdle() }
        instrumentation.runOnMainSync {
            app.incomingShares.cancel()
            app.conversationLinks.value.value?.let(app.conversationLinks::complete)
            ConnectorIntents.callback.value = null
            // Reset only this explicitly isolated, token-free synthetic package between cases.
            app.getSharedPreferences("nuphos.composer-drafts", Context.MODE_PRIVATE).edit().clear().commit()
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
            app.incomingShares.cancel()
            app.conversationLinks.value.value?.let(app.conversationLinks::complete)
        }
        if (::app.isInitialized) kotlinx.coroutines.runBlocking { app.incomingShares.awaitIdle() }
        originals.forEach { (name, client) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client) }
        if (::app.isInitialized) assertNull("Fixture persisted an account", app.tokenStore.read())
        assertTrue("Unexpected requests: $unexpected", unexpected.isEmpty())
    }

    private fun sender(mode: String) {
        val previous = app.incomingShares.state.value?.id
        val receipt = java.util.UUID.randomUUID().toString()
        app.startActivity(Intent().setClassName(senderPackage, "ai.nuphos.sharefixture.ShareSenderActivity")
            .putExtra("fixtureMode", mode).putExtra("fixtureReceipt", receipt).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        compose.waitUntil(10_000) {
            var ready = false
            instrumentation.runOnMainSync {
                activity = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).filterIsInstance<MainActivity>().firstOrNull()
                val pending = app.incomingShares.state.value
                ready = activity != null && if (mode == "revoke") activity?.intent?.getStringExtra("fixtureReceipt") == receipt
                    else pending != null && pending.id != previous && !pending.loading
            }
            ready
        }
    }
    private fun recreate() {
        compose.waitForIdle()
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
            compose.waitForIdle()
        } finally {
            instrumentation.runOnMainSync { ActivityLifecycleMonitorRegistry.getInstance().removeLifecycleCallback(callback) }
        }
    }
    private fun awaitText(value: String) {
        compose.waitUntil(15_000) { runCatching { compose.onAllNodesWithText(value).fetchSemanticsNodes().isNotEmpty() }.getOrDefault(false) }
    }
    private fun snapshot(name: String) {
        if (InstrumentationRegistry.getArguments().getString("captureSynthetic") != "true") return
        val file = java.io.File(app.getExternalFilesDir(null), "$name.png")
        file.outputStream().use { compose.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    }
    @Test fun crossUidMultipleFilesReachExistingDraftWithoutSendingAndSurviveRotation() {
        identity()
        kotlinx.coroutines.runBlocking { app.incomingShares.bindAccount(NuphosUser.preview.id) }
        instrumentation.runOnMainSync {
            app.incomingShares.writeText(ai.nuphos.android.session.ComposerDrafts.Key(NuphosUser.preview.id, a,
                ai.nuphos.android.session.ComposerDrafts.Destination.Chat("fixture-chat")), "Existing synthetic draft")
            app.authSession.composerDrafts.onIdentity(NuphosUser.preview.id)
            app.authSession.composerDrafts.bind(NuphosUser.preview.id, a,
                ai.nuphos.android.session.ComposerDrafts.Destination.Chat("fixture-chat"))!!.write("Existing synthetic draft")
        }
        sender("multiple")
        val pending = app.incomingShares.state.value!!
        assertEquals(2, pending.attachments.size)
        assertEquals("Synthetic attachment bytes", (pending.attachments.first().kind as ai.nuphos.android.model.ComposerAttachment.Kind.RetainedFile).source.open().bufferedReader().use { it.readText() })
        sender("revoke")
        try {
            app.contentResolver.openInputStream(Uri.parse("content://$senderPackage.files/fixture.txt"))?.close()
            fail("Source URI remained readable after the sender revoked its grant")
        } catch (_: SecurityException) { }
        assertEquals("Synthetic attachment bytes", (pending.attachments.first().kind as ai.nuphos.android.model.ComposerAttachment.Kind.RetainedFile).source.open().bufferedReader().use { it.readText() })
        snapshot("share-picker")
        awaitText("Fixture first")
        compose.onNodeWithTag("incoming-share-agent-fixture-chat").performClick()
        snapshot("share-after-pick")
        compose.waitUntil(15_000) { app.incomingShares.state.value == null }
        val merged = "Existing synthetic draft\n\nSynthetic shared note https://example.com/share-fixture"
        awaitText(merged)
        snapshot("share-existing-draft")
        recreate()
        awaitText(merged)
        assertNull(app.incomingShares.state.value)
        assertEquals(2, app.incomingShares.attachments(ai.nuphos.android.session.ComposerDrafts.Key(NuphosUser.preview.id, a,
            ai.nuphos.android.session.ComposerDrafts.Destination.Chat("fixture-chat"))).size)
        assertEquals(0, requests.count { it.method != "GET" })
    }
    @Test fun warmTextShareGoesToNewDraftAndCancelLeavesOldDraftUntouched() {
        identity()
        sender("text")
        compose.onNodeWithText("Cancel share").performClick()
                compose.waitUntil(15_000) { app.incomingShares.state.value == null }
        assertNull(app.incomingShares.state.value)
        sender("text")
        awaitText("New agent draft")
        compose.onNodeWithText("New agent draft").performClick()
        compose.waitUntil(15_000) { app.incomingShares.state.value == null }
        awaitText("Synthetic shared note https://example.com/share-fixture")
        snapshot("share-new-draft")
        assertEquals(0, requests.count { it.method != "GET" })
    }
    @Test fun deniedAndOversizeInputsRemainErrorsAndCanBeCanceled() {
        identity()
        for (mode in listOf("denied", "oversize")) {
            sender(mode)
            assertNotNull(app.incomingShares.state.value?.error)
            assertTrue(app.incomingShares.state.value!!.attachments.isEmpty())
            compose.onNodeWithText("Cancel share").performClick()
                compose.waitUntil(15_000) { app.incomingShares.state.value == null }
            assertNull(app.incomingShares.state.value)
        }
        assertEquals(0, requests.count { it.method != "GET" })
    }
    @Test fun systemChooserDispatchesReceiverAndCreatesOnlyAnEditableDraft() {
        identity()
        app.startActivity(Intent().setClassName(senderPackage, "ai.nuphos.sharefixture.ShareSenderActivity")
            .putExtra("fixtureMode", "text").putExtra("chooser", true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        var target: android.view.accessibility.AccessibilityNodeInfo? = null
        compose.waitUntil(10_000) {
            val root = instrumentation.uiAutomation.rootInActiveWindow
            if (root?.packageName?.toString() in setOf("android", "com.android.intentresolver"))
                target = root?.findAccessibilityNodeInfosByText("Nuphos")?.firstOrNull()
            instrumentation.runOnMainSync {
                activity = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).filterIsInstance<MainActivity>().firstOrNull()
            }
            // Android may immediately dispatch a chooser that has exactly one matching target.
            target != null || (activity != null && app.incomingShares.state.value?.loading == false)
        }
        if (target != null && app.incomingShares.state.value == null && InstrumentationRegistry.getArguments().getString("captureSynthetic") == "true") {
            java.io.File(app.getExternalFilesDir(null), "share-system-sheet.png").outputStream().use {
                instrumentation.uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
            }
        }
        if (target != null && app.incomingShares.state.value == null) {
            var clickable = target
            while (clickable != null && !clickable.isClickable) clickable = clickable.parent
            assertTrue("System share target did not accept selection", clickable?.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK) == true)
        }
        compose.waitUntil(10_000) {
            instrumentation.runOnMainSync {
                activity = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).filterIsInstance<MainActivity>().firstOrNull()
            }
            activity != null && app.incomingShares.state.value?.loading == false
        }
        awaitText("New agent draft")
        compose.onNodeWithText("New agent draft").performClick()
        compose.waitUntil(10_000) { app.incomingShares.state.value == null }
        awaitText("Synthetic shared note https://example.com/share-fixture")
        assertEquals(0, requests.count { it.method != "GET" })
    }

}
