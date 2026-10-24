package ai.nuphos.android

import android.content.Context
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.*
import ai.nuphos.android.model.*
import ai.nuphos.android.session.*
import ai.nuphos.android.ui.*
import ai.nuphos.android.ui.agent.AgentPage
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList

/** Synthetic local transport only. The outer rule blocks the real Activity's reads. */
@RunWith(AndroidJUnit4::class)
class ConversationUnlinkFixtureDeviceTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val requests = CopyOnWriteArrayList<Request>()
    private val originals = mutableMapOf<String, OkHttpClient>()
    private val token = "pins-fixture-no-credentials"
    private lateinit var store: AgentStore
    private lateinit var app: NuphosApplication
    private var savedAccess: Any? = null
    private var savedAuth: Any? = null
    private var savedAuthToken: String? = null
    private var preferences: Map<String, *> = emptyMap<String, Any>()
    @Volatile private var responseCode = 200
    @Volatile private var responseBody = """{"ok":true,"parentSessionId":null}"""
    @Volatile private var detailBody = """{"messages":[],"title":"Synthetic child","isOwner":true,"canManage":true,"readOnly":false}"""
    @Volatile private var detailCode = 200
    private var detailEntered: java.util.concurrent.CountDownLatch? = null
    private var detailRelease: java.util.concurrent.CountDownLatch? = null
    private var entered: java.util.concurrent.CountDownLatch? = null
    private var release: java.util.concurrent.CountDownLatch? = null
    private val entries = """[{"key":"agent-session:normal","label":"Synthetic pin"}]"""
    @Suppress("UNCHECKED_CAST") private fun state(target: Any, name: String, delegated: Boolean = true) =
        target.javaClass.getDeclaredField(name + if (delegated) "\$delegate" else "").also { it.isAccessible = true }.get(target) as MutableState<Any?>

    private val network = object : ExternalResource() {
        override fun before() {
            app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
            preferences = app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).all.toMap()
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                savedAccess = state(AiAccess, "state", false).value
                savedAuth = state(app.authSession, "state").value
                val tokenField = AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }
                savedAuthToken = tokenField.get(app.authSession) as String?
                tokenField.set(app.authSession, token)
                state(app.authSession, "state").value = AuthSession.State.SignedIn(NuphosUser("pins-fixture", "pins@example.invalid", "Pins fixture"))
                AiAccess.activate(token)
            }
            val client = OkHttpClient.Builder().addInterceptor { chain ->
                val req = chain.request(); requests += req
                val path = req.url.encodedPath
                if (path == "/agent/conversations/child" && req.method == "GET") {
                    detailEntered?.countDown()
                    check(detailRelease?.await(10, java.util.concurrent.TimeUnit.SECONDS) != false)
                }
                if (req.method == "DELETE") {
                    entered?.countDown()
                    check(release?.await(10, java.util.concurrent.TimeUnit.SECONDS) != false)
                }
                val text = when (path) {
                    "/agent/conversations/child/parent" -> responseBody
                    "/agent/conversations/child" -> detailBody
                    "/agent/conversations/child/archive" -> """{"ok":true,"archived":true}"""
                    "/teams/aaaaaaaaaaaaaaaaaaaaaaaa/favorites" -> """{"revision":1,"entries":$entries}"""
                    "/agent/conversations" -> """{"conversations":${kotlinx.serialization.json.Json.encodeToString(kotlinx.serialization.builtins.ListSerializer(AgentConversation.serializer()), if (::store.isInitialized) store.conversations else emptyList())},"hasMore":false}"""
                    else -> "{}"
                }
                val code = when (path) {
                    "/agent/conversations/child/parent" -> responseCode
                    "/agent/conversations/child" -> detailCode
                    "/agent/conversations/child/archive", "/teams/aaaaaaaaaaaaaaaaaaaaaaaa/favorites", "/agent/conversations" -> 200
                    else -> 404
                }
                Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(code).message("fixture")
                    .body(text.toResponseBody(Http.jsonMedia)).build()
            }.build()
            for (name in listOf("client", "chatClient")) {
                val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
                originals[name] = field.get(null) as OkHttpClient; field.set(null, client)
            }
        }
        override fun after() {
            release?.countDown()
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                if (::store.isInitialized) store.disposeForConsent()
                state(AiAccess, "state", false).value = savedAccess
                state(app.authSession, "state").value = savedAuth
                AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(app.authSession, savedAuthToken)
                val editor = app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).edit().clear()
                preferences.forEach { (key, value) -> when(value) {
                    is String -> editor.putString(key, value)
                    is Boolean -> editor.putBoolean(key, value)
                    is Int -> editor.putInt(key, value)
                    is Long -> editor.putLong(key, value)
                    is Float -> editor.putFloat(key, value)
                    is Set<*> -> @Suppress("UNCHECKED_CAST") editor.putStringSet(key, value as Set<String>)
                } }; editor.commit()
            }
            originals.forEach { (name, client) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client) }
        }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(network).around(compose)

    private fun render() {
        compose.runOnIdle {
            AiAccess.grant(token)
            store = AgentStore(token, compose.activity)
            state(store, "selectedTeam").value = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A")
            store.acceptMemberships(listOf(Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A"), Team("bbbbbbbbbbbbbbbbbbbbbbbb", "Fixture B")))
            state(store, "phase").value = AgentStore.Phase.Loaded
            state(store, "conversations").value = listOf(AgentConversation("normal", "aaaaaaaaaaaaaaaaaaaaaaaa", "Synthetic parent", parentSessionId = null),
                AgentConversation("child", "aaaaaaaaaaaaaaaaaaaaaaaa", "Synthetic child", parentSessionId = "normal", isOwner = true),
                AgentConversation("leaf", "aaaaaaaaaaaaaaaaaaaaaaaa", "Synthetic leaf", parentSessionId = "child", isOwner = true, unread = JsonValue.Bool(true)),
                AgentConversation("mine", "aaaaaaaaaaaaaaaaaaaaaaaa", "Synthetic own chat", isOwner = true),
                AgentConversation("shared", "aaaaaaaaaaaaaaaaaaaaaaaa", "Synthetic shared chat", isOwner = false))
            val auth = AuthSession(app, app.tokenStore)
            state(auth, "state").value = AuthSession.State.SignedIn(NuphosUser("pins-fixture", "pins@example.invalid", "Unlink fixture"))
            AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, token)
            compose.activity.setContent {
                NuphosTheme { androidx.compose.material3.Surface(Modifier.fillMaxSize().systemBarsPadding()) { CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    val nav = rememberNavController()
                    NavHost(nav, startDestination = "history") {
                        composable("history") { AgentPage(false, {}, nav) }
                        composable("conversation/{sessionId}") { back ->
                            androidx.compose.material3.Text("Opened synthetic ${back.arguments!!.getString("sessionId")!!}")
                        }
                    }
                } } }
            }
        }
        waitText("Synthetic parent")
    }
    private fun waitText(text: String) { compose.waitUntil(5_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() } }

    private fun shot(name: String) {
        compose.waitForIdle()
        Thread.sleep(350)
        val bitmap = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        val file = java.io.File(app.getExternalFilesDir(null), "unlink-$name.png")
        file.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }

    private fun deletes() = requests.count { it.method == "DELETE" }
    private fun child() = store.conversations.first { it.sessionId == "child" }
    private fun openConfirm() {
        compose.onNodeWithTag("row-more:child").performClick()
        compose.onNodeWithTag("menu-unlink:child").performClick()
        waitText("Unlink agent?")
    }
    private fun confirm() { compose.onAllNodesWithText("Unlink").onLast().performClick() }

    @Test fun cancelPreservesTreeAndNavigationWithoutMutation() {
        render(); openConfirm(); shot("confirmation")
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(0, deletes()); assertEquals("normal", child().parentSessionId)
        compose.onNodeWithText("Synthetic child").performClick()
        compose.onNodeWithText("Opened synthetic child").assertExists()
    }
    @Test fun successPromotesChildAndKeepsDescendantsPinsAndOtherRows() {
        render(); openConfirm(); confirm()
        compose.waitUntil(5_000) { child().parentSessionId == null && store.unlinkingSessionId == null }
        assertEquals(1, deletes())
        assertEquals("child", store.conversations.first { it.sessionId == "leaf" }.parentSessionId)
        compose.onNodeWithContentDescription("Hide 1 sub-agents").assertExists()
        compose.onNodeWithContentDescription("Hide 2 sub-agents").assertDoesNotExist()
        compose.onNodeWithText("Synthetic parent").assertExists()
        shot("success-root")
    }
    @Test fun deniedAndMalformedResponsesRetainTreeAndAllowRetry() {
        render(); responseCode = 403; responseBody = """{"error":"forbidden","message":"Synthetic access denied"}"""
        openConfirm(); confirm()
        compose.waitUntil(5_000) { store.unlinkError != null && store.unlinkingSessionId == null }
        assertEquals("normal", child().parentSessionId); assertEquals(1, deletes())
        compose.onNodeWithText("This agent is unavailable or you no longer have permission to unlink it.").assertExists()
        shot("denied")
        responseCode = 200; responseBody = "{}"; confirm()
        compose.waitUntil(5_000) { deletes() == 2 && store.unlinkingSessionId == null }
        assertEquals("normal", child().parentSessionId)
        responseBody = """{"ok":true,"parentSessionId":null}"""; confirm()
        compose.waitUntil(5_000) { child().parentSessionId == null }
        assertEquals(3, deletes())
    }
    @Test fun missingOwnerReadOnlyRootAndForeignTeamCannotUnlinkEvenViaStore() {
        render()
        val denied = listOf(child().copy(isOwner = false), child().copy(isOwner = null),
            child().copy(readOnly = true), child().copy(parentSessionId = null), child().copy(teamId = "bbbbbbbbbbbbbbbbbbbbbbbb"))
        for (row in denied) {
            compose.runOnIdle { state(store, "conversations").value = listOf(row) }
            compose.onNodeWithTag("row-more:child").performClick()
            compose.onNodeWithTag("menu-unlink:child").assertDoesNotExist()
            androidx.test.espresso.Espresso.pressBack()
            runBlocking(Dispatchers.Main) { store.unlinkParent(row) }
        }
        assertEquals(0, deletes())
    }
    @Test fun pendingRequestCannotRepeatAndLateResultCannotWriteAfterTeamRoundTrip() {
        render(); entered = java.util.concurrent.CountDownLatch(1); release = java.util.concurrent.CountDownLatch(1)
        openConfirm(); confirm()
        assertTrue(entered!!.await(5, java.util.concurrent.TimeUnit.SECONDS))
        compose.onAllNodesWithText("Unlinking…").onLast().assertIsNotEnabled()
        runBlocking(Dispatchers.Main) { store.unlinkParent(child()) }
        assertEquals(1, deletes())
        val rows = store.conversations
        compose.runOnIdle {
            store.select(Team("bbbbbbbbbbbbbbbbbbbbbbbb", "Fixture B")); store.select(Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A"))
        }
        compose.waitUntil(5_000) { store.phase == AgentStore.Phase.Loaded }
        compose.runOnIdle { state(store, "conversations").value = rows }
        release!!.countDown()
        Thread.sleep(400); compose.waitForIdle()
        assertEquals("normal", child().parentSessionId); assertNull(store.unlinkError)
        assertNull(store.unlinkingSessionId); assertEquals(1, deletes())
    }
    @Test fun revokedAccountDiscardsLateSuccess() {
        render(); entered = java.util.concurrent.CountDownLatch(1); release = java.util.concurrent.CountDownLatch(1)
        openConfirm(); confirm(); assertTrue(entered!!.await(5, java.util.concurrent.TimeUnit.SECONDS))
        compose.runOnIdle { store.disposeForConsent() }
        release!!.countDown(); Thread.sleep(400); compose.waitForIdle()
        assertTrue(store.conversations.isEmpty()); assertNull(store.unlinkError)
    }

    @Test fun rowArchiveReadsCurrentPermissionsAndDoesNotResumeAChat() {
        render()
        val target = child()
        detailBody = """{"messages":[],"isOwner":true,"canManage":false,"readOnly":false}"""
        runBlocking(Dispatchers.Main) { store.archive(target, true) }
        assertNotNull(store.rowActionError)
        assertTrue(requests.none { it.method == "PATCH" })
        detailBody = """{"messages":[],"isOwner":true,"canManage":true,"readOnly":false}"""
        runBlocking(Dispatchers.Main) { store.archive(target, true) }
        assertEquals(1, requests.count { it.method == "PATCH" && it.url.encodedPath.endsWith("/archive") })
        assertNull(store.rowActionError)
        assertTrue(requests.none { it.url.encodedPath.contains("stream") || it.url.encodedPath.contains("bypass") })
    }

    @Test fun deniedDetailPreventsPinWriteAndRetainsRetry() {
        render()
        compose.waitUntil(5_000) { store.favorites != null }
        detailCode = 403
        runBlocking(Dispatchers.Main) { store.pin(child(), true) }
        assertNotNull(store.rowActionError)
        assertTrue(requests.none { it.method == "PUT" })
        assertNull(store.rowActionSessionId)
    }

    @Test fun archiveConfirmationCancelAndFullSwipeDoNotWrite() {
        render()
        compose.onNodeWithTag("conversation-row:child").performTouchInput { swipeLeft() }
        compose.waitForIdle()
        assertTrue(requests.none { it.method in setOf("PUT", "PATCH", "DELETE") })
        androidx.test.espresso.Espresso.pressBack()
        compose.onNodeWithTag("row-more:child").performClick()
        compose.onNodeWithTag("menu-archive:child").performClick()
        compose.onNodeWithText("Archive agent?").assertIsDisplayed()
        compose.onNodeWithText("Cancel").performClick()
        assertTrue(requests.none { it.method in setOf("PUT", "PATCH", "DELETE") })
    }

    @Test fun rowPinReadsMetadataAndRejectsDuplicateWhilePending() {
        render()
        compose.waitUntil(5_000) { store.favorites != null && !store.favoritesLoading }
        detailEntered = java.util.concurrent.CountDownLatch(1)
        detailRelease = java.util.concurrent.CountDownLatch(1)
        val target = child()
        val job = CoroutineScope(Dispatchers.Main).launch { store.pin(target, true) }
        assertTrue(detailEntered!!.await(5, java.util.concurrent.TimeUnit.SECONDS))
        runBlocking(Dispatchers.Main) { store.pin(target, true); store.archive(target, true) }
        assertEquals(1, requests.count { it.url.encodedPath == "/agent/conversations/child" })
        detailRelease!!.countDown()
        runBlocking { job.join() }
        assertEquals(1, requests.count { it.method == "PUT" })
        assertTrue(requests.none { it.method == "PATCH" || it.url.encodedPath.contains("stream") })
    }

    @Test fun rowMetadataReadCannotWriteAfterWorkspaceRoundTrip() {
        render()
        compose.waitUntil(5_000) { store.favorites != null && !store.favoritesLoading }
        detailEntered = java.util.concurrent.CountDownLatch(1)
        detailRelease = java.util.concurrent.CountDownLatch(1)
        val job = CoroutineScope(Dispatchers.Main).launch { store.pin(child(), true) }
        assertTrue(detailEntered!!.await(5, java.util.concurrent.TimeUnit.SECONDS))
        compose.runOnIdle {
            store.select(Team("bbbbbbbbbbbbbbbbbbbbbbbb", "Fixture B"))
            store.select(Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A"))
        }
        detailRelease!!.countDown()
        runBlocking { job.join() }
        assertTrue(requests.none { it.method in setOf("PUT", "PATCH", "DELETE") })
        assertNull(store.rowActionSessionId)
    }

    @Test fun reorderingLoadedRowsClosesRevealedActions() {
        render()
        compose.onNodeWithTag("conversation-row:child").performTouchInput { swipeLeft() }
        compose.onNodeWithTag("row-rail:child").assertExists()
        compose.runOnIdle { state(store, "conversations").value = store.conversations.reversed() }
        compose.onNodeWithTag("row-rail:child").assertDoesNotExist()
        assertTrue(requests.none { it.method in setOf("PUT", "PATCH", "DELETE") })
    }
}
