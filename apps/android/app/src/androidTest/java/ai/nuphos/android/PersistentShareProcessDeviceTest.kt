package ai.nuphos.android

import android.content.Context
import android.app.Instrumentation
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.content.pm.PackageManager
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.assertCountEquals
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
class PersistentShareProcessDeviceTest {
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
    @Volatile private var onlyOtherTeam = false

    @Suppress("UNCHECKED_CAST")
    private fun setState(value: AuthSession.State) {
        val field = AuthSession::class.java.getDeclaredField("state\$delegate").also { it.isAccessible = true }
        (field.get(auth) as MutableState<AuthSession.State>).value = value
    }

    private fun onMain(block: suspend () -> Unit) = kotlinx.coroutines.runBlocking {
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main.immediate) { block() }
    }

    private fun identity() = onMain {
        AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, token)
        AiAccess.activate(token)
        AiAccess.grant(token)
        setState(AuthSession.State.SignedIn(NuphosUser.preview))
    }

    @Before fun setup() {
        val optedIn = InstrumentationRegistry.getArguments().getString("persistentSharePhase") != null
        assumeTrue("Disposable emulator fixture is disabled by default", optedIn)
        assertTrue("Physical devices require the isolated fixture package",
            instrumentation.targetContext.packageName == "ai.nuphos.android.sharepersist1359")
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
                path == "/teams" && onlyOtherTeam -> """{"teams":[{"id":"$b","name":"Fixture Beta"}]}"""
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
        onMain {
            app.conversationLinks.value.value?.let(app.conversationLinks::complete)
            ConnectorIntents.callback.value = null
            auth = AuthSession(app, app.tokenStore)
            auth.onIdentityReset = originalAuth.onIdentityReset
            auth.awaitIdentityCleanup = originalAuth.awaitIdentityCleanup
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
            onMain {
                val monitor = ActivityLifecycleMonitorRegistry.getInstance()
                monitor.addLifecycleCallback(callback)
                if (monitor.getLifecycleStageOf(target) == Stage.DESTROYED) destroyed.countDown()
                else target.finish()
            }
            assertTrue("Fixture Activity did not close", destroyed.await(5, TimeUnit.SECONDS))
            onMain { ActivityLifecycleMonitorRegistry.getInstance().removeLifecycleCallback(callback) }
        }
        if (::auth.isInitialized) onMain {
            (AuthSession::class.java.getDeclaredField("scope").also { it.isAccessible = true }.get(auth) as CoroutineScope).cancel()
            val callback = AiAccess.onRevoked
            AiAccess.onRevoked = {}
            try { AiAccess.revoke() } finally { AiAccess.onRevoked = callback }
            NuphosApplication::class.java.getDeclaredField("authSession").also { it.isAccessible = true }.set(app, originalAuth)
            app.conversationLinks.value.value?.let(app.conversationLinks::complete)
        }
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
            onMain {
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
        onMain {
            ActivityLifecycleMonitorRegistry.getInstance().addLifecycleCallback(callback)
            old.recreate()
        }
        try {
            assertTrue("Recreated Activity never resumed", resumed.await(10, TimeUnit.SECONDS))
            activity = replacement
            compose.waitForIdle()
        } finally {
            onMain { ActivityLifecycleMonitorRegistry.getInstance().removeLifecycleCallback(callback) }
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
    private fun key() = ai.nuphos.android.session.ComposerDrafts.Key(NuphosUser.preview.id, a,
        ai.nuphos.android.session.ComposerDrafts.Destination.Chat("fixture-chat"))
    private fun newKey() = key().copy(destination = ai.nuphos.android.session.ComposerDrafts.Destination.NewChat)
    private fun ordinaryKey() = key().copy(destination = ai.nuphos.android.session.ComposerDrafts.Destination.Chat("ordinary-untouched"))
    private val sharedText = "Synthetic shared note https://example.com/share-fixture"
    private val mergedText = "Existing synthetic draft\n\n$sharedText"
    private fun open(existing: Boolean = false) {
        val intent = Intent(app, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (existing) { intent.action = Intent.ACTION_VIEW; intent.data = Uri.parse("https://nuphos.ai/teams/$a/agent/fixture-chat") }
        activity = instrumentation.startActivitySync(intent) as MainActivity
        compose.waitForIdle()
    }
    private fun assertFiles(address: ai.nuphos.android.session.ComposerDrafts.Key) {
        val files = app.incomingShares.attachments(address)
        assertEquals(2, files.size)
        assertEquals("Synthetic attachment bytes", (files.first().kind as ai.nuphos.android.model.ComposerAttachment.Kind.RetainedFile)
            .source.open().bufferedReader().use { it.readText() })
        assertTrue(files[1].isImage)
    }
    @Test fun processDeathPhase() {
        val phase = requireNotNull(InstrumentationRegistry.getArguments().getString("persistentSharePhase"))
        val markers = app.getSharedPreferences("share-persistence-fixture", Context.MODE_PRIVATE)
        val previousPid = markers.getInt("previousPid", -1)
        assertNotEquals("Run each phase in a genuinely new target process", previousPid, android.os.Process.myPid())
        identity()
        onMain { auth.composerDrafts.onIdentity(NuphosUser.preview.id) }
        when (phase) {
            "seedPending" -> {
                onMain {
                    app.incomingShares.identityReset(); app.incomingShares.cancel(); app.incomingShares.awaitIdle()
                    auth.composerDrafts.clear()
                    app.incomingShares.bindAccount(NuphosUser.preview.id)
                    // Match ChatComposer.updateText: a deliberate new edit replaces any old cleanup guard first.
                    app.incomingShares.writeText(key(), "Existing synthetic draft")
                    auth.composerDrafts.bind(NuphosUser.preview.id, a, key().destination)!!.write("Existing synthetic draft")
                }
                sender("multiple")
                assertEquals(2, app.incomingShares.state.value!!.attachments.size)
                sender("revoke")
                try {
                    app.contentResolver.openInputStream(Uri.parse("content://$senderPackage.files/fixture.txt"))?.close()
                    fail("Original grant must be revoked before killing the receiver")
                } catch (_: SecurityException) { }
                snapshot("persistent-pending-before-kill")
            }
            "consumeExisting" -> {
                try {
                    app.contentResolver.openInputStream(Uri.parse("content://$senderPackage.files/fixture.txt"))?.close()
                    fail("A restarted process must not need or retain the original provider grant")
                } catch (_: SecurityException) { }
                assertNotNull(app.incomingShares.state.value)
                assertNull(app.incomingShares.state.value!!.destination)
                assertEquals(sharedText, app.incomingShares.state.value!!.text)
                open()
                awaitText("Fixture first")
                snapshot("persistent-pending-after-restart")
                compose.onNodeWithTag("incoming-share-agent-fixture-chat").performClick()
                compose.waitUntil(15_000) { app.incomingShares.state.value == null }
                awaitText(mergedText)
                assertFiles(key())
            }
            "verifyExisting" -> {
                assertNull(app.incomingShares.state.value)
                open(existing = true)
                awaitText(mergedText)
                assertFiles(key())
                compose.onNode(hasSetTextAction() and androidx.compose.ui.test.hasText(mergedText)).performTextReplacement("Edited persisted synthetic draft")
                snapshot("persistent-existing-after-restart")
            }
            "verifyEditedAndWarmCancel" -> {
                open(existing = true)
                awaitText("Edited persisted synthetic draft")
                assertFiles(key())
                sender("text")
                compose.onNodeWithText("Cancel share").performClick()
                compose.waitUntil(15_000) { app.incomingShares.state.value == null }
                assertNull(app.incomingShares.state.value)
                awaitText("Edited persisted synthetic draft")
                assertFiles(key())
            }
            "consumeNew" -> {
                open()
                sender("multiple")
                awaitText("New agent draft")
                compose.onNodeWithText("New agent draft").performClick()
                compose.waitUntil(15_000) { app.incomingShares.state.value == null }
                awaitText(sharedText)
                assertFiles(newKey())
            }
            "verifyNewAndHandoff" -> {
                open()
                awaitText(sharedText)
                assertFiles(newKey())
                snapshot("persistent-new-after-restart")
                // Simulate the composer's accepted local submission boundary; no backend message is sent.
                onMain {
                    app.incomingShares.sent(newKey())
                    auth.composerDrafts.bind(NuphosUser.preview.id, a, newKey().destination)!!.submitted(true, sharedText)
                }
            }
            "verifyNoReplay" -> {
                open()
                assertNull(app.incomingShares.state.value)
                assertTrue(app.incomingShares.attachments(newKey()).isEmpty())
                assertEquals("", app.incomingShares.text(newKey()))
            }
            "cancelPending" -> {
                open()
                awaitText("Cancel share")
                compose.onNodeWithText("Cancel share").performClick()
                compose.waitUntil(15_000) { app.incomingShares.state.value == null }
                assertNull(app.incomingShares.state.value)
            }
            "verifyCanceled" -> {
                open()
                assertNull(app.incomingShares.state.value)
                assertTrue(app.shareDraftStore.load().pending == null)
            }
            "switchAccount" -> {
                open()
                onMain {
                    val otherToken = "other-synthetic-no-credentials"
                    AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, otherToken)
                    AiAccess.activate(otherToken); AiAccess.grant(otherToken)
                    auth.composerDrafts.onIdentity("other-synthetic-account")
                    setState(AuthSession.State.SignedIn(NuphosUser.preview.copy(id = "other-synthetic-account")))
                }
                compose.waitUntil(15_000) { app.incomingShares.state.value == null }
                kotlinx.coroutines.runBlocking { app.incomingShares.awaitIdle() }
                assertNull(app.incomingShares.state.value)
                assertTrue(app.shareDraftStore.load().drafts.isEmpty())
                assertTrue(app.shareDraftStore.load().pending == null)
            }
            "removeTeam" -> {
                onlyOtherTeam = true
                open()
                awaitText("Fixture Beta")
                compose.waitUntil(15_000) { app.shareDraftStore.load().drafts.filter { it.address.team == a }.all { it.text.isEmpty() && it.blobs.isEmpty() } }
                assertTrue(app.incomingShares.attachments(key()).isEmpty())
            }
            "signOut" -> {
                open()
                onMain { auth.signOut() }
                kotlinx.coroutines.runBlocking { app.incomingShares.awaitIdle() }
                assertNull(app.incomingShares.state.value)
                assertTrue(app.shareDraftStore.load().drafts.isEmpty())
            }
            "consentReset" -> {
                onMain { AiAccess.revoke() }
                kotlinx.coroutines.runBlocking { app.incomingShares.awaitIdle() }
                assertNull(app.incomingShares.state.value)
                assertTrue(app.shareDraftStore.load().drafts.isEmpty())
            }
            "damageDeliveredMetadata", "removeDeliveredFile" -> {
                onMain { app.incomingShares.bindAccount(NuphosUser.preview.id) }
                assertFiles(key())
                onMain {
                    auth.composerDrafts.bind(NuphosUser.preview.id, a, key().destination)!!.write("Stale shared preference must never return")
                    auth.composerDrafts.bind(NuphosUser.preview.id, a, ordinaryKey().destination)!!.write("Unrelated ordinary draft survives")
                    assertTrue(app.getSharedPreferences("nuphos.composer-drafts", Context.MODE_PRIVATE).edit().commit())
                }
                if (phase == "damageDeliveredMetadata") java.io.File(app.noBackupFilesDir, "share-drafts-v1/state.json").writeText("{unfinished")
                else app.incomingShares.attachments(key()).first().releaseOwnedCopy()
            }
            "verifyDeliveredCorrupt" -> {
                assertNull(app.incomingShares.state.value)
                onMain {
                    assertEquals("", app.incomingShares.text(key()) ?: auth.composerDrafts.bind(NuphosUser.preview.id, a, key().destination)!!.text)
                    assertEquals("Unrelated ordinary draft survives", auth.composerDrafts.bind(NuphosUser.preview.id, a, ordinaryKey().destination)!!.text)
                }
                assertTrue(app.incomingShares.attachments(key()).isEmpty())
                open(existing = true)
                awaitText("Linked fixture chat")
                compose.onAllNodesWithText("Stale shared preference must never return").assertCountEquals(0)
            }
            "removeFile" -> {
                val pending = requireNotNull(app.incomingShares.state.value)
                pending.attachments.first().releaseOwnedCopy()
            }
            "damageMetadata" -> {
                java.io.File(app.noBackupFilesDir, "share-drafts-v1/state.json").writeText("{unfinished")
            }
            "verifyCorrupt" -> {
                assertNull(app.incomingShares.state.value)
                assertTrue(app.shareDraftStore.assets.listFiles().orEmpty().isEmpty())
                open()
            }
            "seedLegacy" -> {
                onMain { app.incomingShares.identityReset(); app.incomingShares.cancel(); app.incomingShares.awaitIdle() }
                java.io.File(app.filesDir, "incoming-share-attachments").mkdirs()
                java.io.File(app.filesDir, "incoming-share-attachments/legacy.upload").writeText("legacy synthetic")
                onMain {
                    app.incomingShares.bindAccount(NuphosUser.preview.id)
                    app.incomingShares.writeText(newKey(), "Legacy synthetic text draft")
                    auth.composerDrafts.bind(NuphosUser.preview.id, a, newKey().destination)!!.write("Legacy synthetic text draft")
                    app.getSharedPreferences("nuphos.composer-drafts", Context.MODE_PRIVATE).edit().commit()
                }
            }
            "verifyLegacy" -> {
                assertFalse(java.io.File(app.filesDir, "incoming-share-attachments").exists())
                open()
                awaitText("Legacy synthetic text draft")
                assertTrue(app.incomingShares.attachments(newKey()).isEmpty())
            }
            "denyConversation" -> {
                detailStatus = 403
                open(existing = true)
                awaitText("Could not open agent")
                compose.waitUntil(15_000) { app.incomingShares.attachments(key()).isEmpty() }
                assertEquals("", app.incomingShares.text(key()))
            }
            else -> error("Unknown phase $phase")
        }
        kotlinx.coroutines.runBlocking { app.incomingShares.awaitIdle() }
        assertTrue("Unexpected writes: $requests", requests.all { it.method == "GET" })
        assertTrue(markers.edit().putInt("previousPid", android.os.Process.myPid()).commit())
        instrumentation.sendStatus(2, android.os.Bundle().apply {
            putString("stream", "PERSISTENT_SHARE_PHASE=$phase PID=${android.os.Process.myPid()}\n")
        })
    }
}
