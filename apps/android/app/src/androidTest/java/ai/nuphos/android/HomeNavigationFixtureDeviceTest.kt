package ai.nuphos.android

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.res.Configuration
import android.os.ParcelFileDescriptor
import android.view.WindowInsets
import android.view.WindowManager
import android.view.inspector.WindowInspector
import android.view.accessibility.AccessibilityNodeInfo
import android.util.DisplayMetrics
import android.content.Context
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.test.espresso.Espresso
import androidx.compose.ui.input.key.Key
import android.graphics.Bitmap
import java.io.File
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.navigation.compose.rememberNavController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.*
import ai.nuphos.android.model.*
import ai.nuphos.android.session.*
import ai.nuphos.android.ui.*
import ai.nuphos.android.ui.home.HomeScreen
import ai.nuphos.android.ui.theme.NuphosTheme
import ai.nuphos.android.ui.workspace.WorkspaceSetupSheet
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.serialization.builtins.ListSerializer
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import java.io.IOException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assume.assumeTrue

/** All responses are synthetic. Unknown requests fail; this client never opens a socket. */
@RunWith(AndroidJUnit4::class)
class HomeNavigationFixtureDeviceTest {
    private val compose = createComposeRule()
    private val a = Team("507f1f77bcf86cd799439011", "Fixture Alpha", role = "ADMINISTRATOR", isOwner = true)
    private val b = Team("507f1f77bcf86cd799439012", "Fixture Beta", role = "EDITOR", isOwner = false)
    private val token = "workspace-synthetic-no-credentials"
    private val requests = CopyOnWriteArrayList<Request>()
    private val unexpected = CopyOnWriteArrayList<Request>()
    @Volatile private var memberships = emptyList<Team>()
    private lateinit var savedConfiguration: Configuration
    private lateinit var savedMetrics: DisplayMetrics
    @Volatile private var archiveFailure = false
    @Volatile private var archived = false
    @Volatile private var historyFailure = false
    @Volatile private var historyFamilies = false
    @Volatile private var runtimeCatalogHold: CountDownLatch? = null
    @Volatile private var runtimeCatalogFailure = false
    @Volatile private var runtimeRemoved = false
    @Volatile private var runtimeReplaced = false
    @Volatile private var signedInAgain = false
    private lateinit var plansStore: PlansStore
    private lateinit var app: NuphosApplication
    private lateinit var agent: AgentStore
    private lateinit var auth: AuthSession
    private var savedAccess: Any? = null
    private lateinit var savedAuth: AuthSession
    private var savedLastTeam: String? = null
    private val originals = mutableMapOf<String, OkHttpClient>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    @Suppress("UNCHECKED_CAST") private fun state(target: Any, name: String, delegated: Boolean = true) =
        target.javaClass.getDeclaredField(name + if (delegated) "\$delegate" else "").also { it.isAccessible = true }.get(target) as MutableState<Any?>
    private val network = object : ExternalResource() {
        override fun before() {
            app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
            savedConfiguration = Configuration(app.resources.configuration)
            savedMetrics = DisplayMetrics().also { it.setTo(app.resources.displayMetrics) }
            savedAuth = app.authSession
            savedLastTeam = app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).getString("nuphos.workspace.lastTeamId", null)
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                savedAccess = state(AiAccess, "state", false).value
                AiAccess.activate(token); AiAccess.grant(token)
                auth = AuthSession(app, app.tokenStore)
                AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, token)
                state(auth, "state").value = AuthSession.State.SignedIn(NuphosUser.preview)
                NuphosApplication::class.java.getDeclaredField("authSession").also { it.isAccessible = true }.set(app, auth)
            }
            val client = OkHttpClient.Builder().addInterceptor { chain ->
                val request = chain.request()
                if (ChatsFixture.isListing(request)) return@addInterceptor ChatsFixture.empty(request)
                requests += request
                val path = request.url.encodedPath
                val runtimeCatalog = request.method == "GET" && path in setOf("/teams/${a.id}/agent-runtimes", "/teams/${b.id}/agent-runtimes")
                val runtimeQuotas = request.method == "GET" && path in setOf("/teams/${a.id}/agent-runtimes/quota", "/teams/${b.id}/agent-runtimes/quota")
                val devices = request.method == "GET" && path == "/agent/devices" && request.url.queryParameter("teamId") in setOf(a.id,b.id)
                val teamRead = request.method == "GET" && path == "/teams"
                val discovery = request.method == "GET" && path == "/teams/discoverable"
                val favorites = request.method == "GET" && path in setOf("/teams/${a.id}/favorites", "/teams/${b.id}/favorites")
                val archive = request.method == "PATCH" && path == "/agent/conversations/fixture-chat/archive" && request.url.queryParameter("teamId") == a.id
                val detail = request.method == "GET" && path == "/agent/conversations/fixture-chat" && request.url.queryParameter("teamId") == a.id
                val credentials = request.method == "GET" && path == "/agent/credential-options"
                val consent = request.method == "GET" && path == "/auth/ai-consent"
                val connectors = request.method == "GET" && path in setOf("/teams/${a.id}/connectors", "/teams/${b.id}/connectors")
                val history = request.method == "GET" && path == "/agent/conversations" && request.url.queryParameter("teamId") in setOf(a.id, b.id)
                val plans = request.method == "GET" && path == "/agent/plans" && request.url.queryParameter("teamId") in setOf(a.id, b.id)
                val members = request.method == "GET" && path in setOf("/teams/${a.id}/members", "/teams/${b.id}/members")
                val browsing = request.method == "GET" && path in setOf("/teams/${a.id}/monitoring/overview", "/teams/${b.id}/monitoring/overview")
                val mfa = request.method == "GET" && path == "/auth/mfa"
                val mfaSetup = request.method == "POST" && path == "/auth/mfa/totp/setup"
                val endSession = request.method == "DELETE" && path == "/auth/sessions/current"
                if (!mfa && !mfaSetup && !endSession && !runtimeCatalog && !runtimeQuotas && !devices && !teamRead && !discovery && !favorites && !history && !consent && !connectors && !plans && !members && !browsing && !credentials && !archive && !detail) unexpected += request
                var code = 200
                val body = when {
                    runtimeCatalog -> {
                        check(runtimeCatalogHold?.await(15, TimeUnit.SECONDS) != false)
                        if (runtimeCatalogFailure) { code = 503; "{}" } else if (runtimeReplaced) """{"runtimes":[{"id":"replacement","provider":"codex","label":"Other Cloud","status":"active","kind":"managed"}]}""" else if (runtimeRemoved) "{\"runtimes\":[]}" else """{"runtimes":[{"id":"synthetic-cloud","provider":"codex","label":"Synthetic Cloud","status":"active","kind":"managed"}]}"""
                    }
                    runtimeQuotas -> """{"quotas":[]}"""
                    devices -> """{"devices":[]}"""
                    teamRead -> { """{"teams":${Http.json.encodeToString(ListSerializer(Team.serializer()), memberships)}}""" }
                    discovery -> "{\"teams\":[]}"
                    archive -> {
                        val body = okio.Buffer().also { request.body!!.writeTo(it) }.readUtf8()
                        check(JsonValue.parse(body)?.get("archived")?.boolValue == true)
                        if (archiveFailure) { code = 503; "{}" } else { archived = true; "{\"ok\":true,\"archived\":true}" }
                    }
                    detail -> """{"sessionId":"fixture-chat","title":"Synthetic active conversation","archivedAt":${if (archived) "\"2026-01-02T00:00:00Z\"" else "null"},"canManage":true,"isOwner":true,"messages":[]}"""
                    credentials -> "{}"
                    consent -> """{"version":"2026-09-28","accepted":true}"""
                    connectors -> "{}"
                    favorites -> """{"entries":[],"revision":0}"""
                    history -> {
                        if (request.url.queryParameter("pendingDecision") == "true")
                            return@addInterceptor Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200)
                                .message("fixture").body("""{"conversations":[{"sessionId":"question-fixture","teamId":"${a.id}","title":"Synthetic question","isOwner":true,"inputRequests":[{"id":"q1","category":"preference","question":"Choose a color","options":["Blue","Green"]}]}],"hasMore":false}""".toResponseBody(Http.jsonMedia)).build()

                        // Archived chats are excluded from the list, matching iOS.
                        if (historyFailure) { code = 403; "{}" } else if (historyFamilies) {
                            """{"conversations":[
                                {"sessionId":"recent","title":"Recent standalone task","lastActiveAt":"2026-01-02T00:00:00Z","isOwner":true},
                                {"sessionId":"parent","title":"Task with a waiting thread","lastActiveAt":"2026-01-01T00:00:00Z","isOwner":true},
                                {"sessionId":"child","parentSessionId":"parent","title":"Waiting thread","isOwner":true,
                                 "inputRequests":[{"id":"q","category":"approval","question":"Continue?","status":"open"}]}
                            ],"nextCursor":null}"""
                        } else if (archived || request.url.queryParameter("archived") != "exclude") "{\"conversations\":[],\"nextCursor\":null}" else
                            """{"conversations":[{"sessionId":"fixture-chat","teamId":"${request.url.queryParameter("teamId")}","title":"Synthetic active conversation","archivedAt":null,"canManage":true,"isOwner":true,"createdAt":"2026-01-01T00:00:00Z"}],"nextCursor":null}"""
                    }
                    browsing -> "{}"
                    plans -> """{"plans":[],"hasMore":false}"""
                    members -> """{"members":[]}"""
                    mfa -> """{"enabled":false}"""
                    // A sign-in older than ten minutes may not start setup (the backend's rule for accounts without 2FA).
                    mfaSetup -> if (signedInAgain) """{"secret":"JBSWY3DPEHPK3PXP","otpauthUrl":"otpauth://totp/Nuphos:fixture?secret=JBSWY3DPEHPK3PXP"}"""
                        else { code = 403; """{"error":{"code":"reauth_required","message":"Sign in again","details":{"method":"sign_in"}}}""" }
                    endSession -> "{}"
                    else -> { code = 500; "{}" }
                }
                Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("fixture")
                    .body(body.toResponseBody(Http.jsonMedia)).build()
            }.build()
            for (name in listOf("client", "chatClient")) {
                val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
                originals[name] = field.get(null) as OkHttpClient; field.set(null, client)
            }
        }
        override fun after() {
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                if (::agent.isInitialized) agent.disposeForConsent()
                scope.cancel()
                @Suppress("DEPRECATION")
                app.resources.updateConfiguration(savedConfiguration, savedMetrics)
                NuphosApplication::class.java.getDeclaredField("authSession").also { it.isAccessible = true }.set(app, savedAuth)
                state(AiAccess, "state", false).value = savedAccess
                app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).edit().apply {
                    if (savedLastTeam == null) remove("nuphos.workspace.lastTeamId") else putString("nuphos.workspace.lastTeamId", savedLastTeam)
                    remove("nuphos.resumeTwoFactor") // A failed two-factor test must not open the next test's account sheet.
                }.commit()
            }
            originals.forEach { (name, client) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client) }
            assertTrue("Unexpected requests: ${unexpected.map { it.method + " " + it.url }}", unexpected.isEmpty())
        }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(network).around(compose)
    private fun waitText(text: String) {
        compose.waitUntil(8_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
    }
    private fun render(newTask: Boolean = false, compact: Boolean = false, restoration: StateRestorationTester? = null, keyboard: Boolean = false) {
        memberships = listOf(a, b)
        compose.runOnIdle {
            if (compact) {
                // Process-local fixture resources only: popup windows must also see fontScale=2.
                val config = Configuration(app.resources.configuration).apply { fontScale = 2f }
                val metrics = DisplayMetrics().also { it.setTo(app.resources.displayMetrics); it.scaledDensity = it.density * 2f }
                @Suppress("DEPRECATION")
                app.resources.updateConfiguration(config, metrics)
            }
            agent = AgentStore(token, app); agent.acceptMemberships(memberships, a.id)
            auth.composerDrafts.onIdentity(NuphosUser.preview.id)
            plansStore = PlansStore(token)
            val connectors = ConnectorsStore(ConnectorApi(token))
            val content: @Composable () -> Unit = {
                val inputMode = LocalInputModeManager.current
                SideEffect { if (keyboard) inputMode.requestInputMode(InputMode.Keyboard) }
                val density = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(density.density, if (compact) 2f else density.fontScale),
                    LocalLayoutDirection provides if (compact) LayoutDirection.Rtl else LayoutDirection.Ltr,
                    LocalAgentStore provides agent, LocalAuthSession provides auth,
                    LocalPlansStore provides plansStore, LocalConnectorsStore provides connectors) {
                    NuphosTheme(darkTheme = InstrumentationRegistry.getArguments().getString("fixtureDark") == "true") { Box(if (compact) Modifier.width(320.dp) else Modifier) {
                        // As in the app, home leaves on sign-out and comes back fresh on the next sign-in.
                        if (auth.state !is AuthSession.State.SignedIn) return@Box
                        val nav = rememberNavController()
                        if (newTask) NavHost(nav, startDestination = "fixture-home") {
                            composable("fixture-home") {
                                HomeScreen(NuphosUser.preview, nav, showComposer = true,
                                    newChatComposer = { ai.nuphos.android.ui.agent.NewChatComposer(nav) })
                            }
                            composable("conversation/{id}?fresh={fresh}") {
                                androidx.compose.material3.Text("Synthetic task destination")
                            }
                        } else HomeScreen(NuphosUser.preview, nav, showComposer = false)
                    } }
                }
            }
            if (restoration != null) restoration.setContent(content) else compose.setContent(content)
        }
        compose.waitUntil(8_000) { compose.onAllNodesWithTag("home-page-switcher").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("home-page-switcher").assertIsDisplayed()
    }
    private fun pressSystemBack() {
        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
        compose.waitForIdle()
    }
    private fun menu() { compose.onNodeWithTag("home-page-switcher").performClick() }
    private fun select(route: String) {
        if (route in listOf("chats", "agent", "inbox")) compose.onNodeWithTag("home-tab-$route").performClick()
        else if (route == "runtimes") compose.onNodeWithTag("home-runtimes").performClick()
        else { menu(); compose.onNodeWithTag("home-page-$route").performScrollTo().performClick() }
        compose.waitForIdle()
    }
    // The Tasks list's reads. The Bots listing reads mine and shared, as the chats do (#3852).
    private fun assertFixedListSelectors() = assertTrue(requests.filter {
        it.url.encodedPath == "/agent/conversations" && it.url.queryParameter("bots") != "true"
    }.all {
        it.url.queryParameter("scope") == "mine" && it.url.queryParameter("sort") == "activity" && it.url.queryParameter("archived") == "exclude"
    })
    private fun noWrites() = assertTrue(requests.none { it.method != "GET" })
    private fun shot(name: String) {
        compose.waitForIdle()
        Thread.sleep(250) // Wait for the platform popup window to draw before capturing its pixels.
        val file = File(app.getExternalFilesDir(null), "navigation-$name.png")
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        try { file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } } finally { bitmap.recycle() }
    }
    @Test fun newTaskComposerMeetsKeyboardAndGreetingFits() {
        app.incomingShares.identityReset()
        kotlinx.coroutines.runBlocking { app.incomingShares.bindAccount(NuphosUser.preview.id) }
        val registry = InstrumentationRegistry.getInstrumentation()
        val automation = registry.uiAutomation
        val serviceInfo = automation.serviceInfo
        val originalFlags = serviceInfo.flags
        serviceInfo.flags = originalFlags or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        automation.serviceInfo = serviceInfo

        fun keyboardTop(): Int? = compose.runOnIdle {
            val decor = WindowInspector.getGlobalWindowViews().firstOrNull { it.hasWindowFocus() }
                ?: return@runOnIdle null
            val insets = decor.rootWindowInsets ?: return@runOnIdle null
            val ime = insets.getInsets(WindowInsets.Type.ime()).bottom
            if (ime == 0) return@runOnIdle null
            decor.context.getSystemService(WindowManager::class.java).currentWindowMetrics.bounds.bottom - ime
        }
        fun shell(command: String) =
            ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand(command)).bufferedReader().use { it.readText().trim() }
        val previousImeSetting = shell("settings get secure show_ime_with_hard_keyboard")

        try {
            shell("settings put secure show_ime_with_hard_keyboard 1")
            render(newTask = true)
            compose.onNodeWithTag("new-task-open").performClick()
            compose.onNodeWithTag("new-task-sheet").assertIsDisplayed()
            compose.waitUntil(8_000) { compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().isNotEmpty() }
            compose.onNode(hasSetTextAction()).performClick()
            compose.waitUntil(8_000) { keyboardTop() != null }
            automation.waitForIdle(300, 5_000)
            compose.waitForIdle()

            val imeTop = requireNotNull(keyboardTop())
            val composer = compose.onNodeWithTag("chat-composer-surface").fetchSemanticsNode().boundsInWindow
            assertEquals("Composer bottom should meet the IME", imeTop.toFloat(), composer.bottom, 2f)
            compose.onNodeWithContentDescription(app.getString(R.string.send)).assertIsDisplayed()

            val greetingText = app.getString(R.string.new_task_welcome_name, NuphosUser.preview.name.orEmpty().substringBefore(' '))
            val greeting = compose.onNodeWithText(greetingText)
            val shortScreen = InstrumentationRegistry.getArguments().getString("newTaskShortScreen") == "true"
            fun greetingExposed(): Boolean {
                val roots = automation.windows.mapNotNull { it.root }.filter { it.packageName == app.packageName }
                assertTrue("Expected a Nuphos accessibility window", roots.isNotEmpty())
                fun visibleGreeting(node: AccessibilityNodeInfo): Boolean {
                    return (node.isVisibleToUser && node.text?.toString() == greetingText) ||
                        (0 until node.childCount).any { node.getChild(it)?.let(::visibleGreeting) == true }
                }
                return roots.any(::visibleGreeting)
            }
            if (shortScreen) {
                greeting.assertIsNotDisplayed()
                assertFalse("Hidden greeting should not be exposed to accessibility", greetingExposed())
            } else {
                greeting.assertIsDisplayed()
                compose.waitUntil(8_000) { greetingExposed() }
            }
            shot("3799-keyboard-open")

            compose.onNode(hasSetTextAction()).performTextClearance()
            compose.onNode(hasSetTextAction()).performTextInput("Synthetic keyboard draft")
            val draft = compose.onNodeWithText("Synthetic keyboard draft")
            compose.waitUntil(8_000) { draft.isDisplayed() }
            pressSystemBack()
            compose.waitUntil(8_000) { keyboardTop() == null && draft.isDisplayed() && greeting.isDisplayed() }
            compose.onNodeWithTag("new-task-sheet").assertIsDisplayed()
            compose.waitUntil(8_000) { greetingExposed() }
            shot("3799-keyboard-closed")
            compose.onNodeWithTag("new-task-cancel").performClick()
            compose.onNodeWithTag("new-task-sheet").assertDoesNotExist()
            noWrites()
        } finally {
            if (previousImeSetting in setOf("0", "1")) {
                shell("settings put secure show_ime_with_hard_keyboard $previousImeSetting")
            } else {
                shell("settings delete secure show_ime_with_hard_keyboard")
            }
            serviceInfo.flags = originalFlags
            automation.serviceInfo = serviceInfo
        }
    }

    @Test fun newTaskSheetCancelAndReopenPreservesDraft() {
        app.incomingShares.identityReset()
        kotlinx.coroutines.runBlocking { app.incomingShares.bindAccount(NuphosUser.preview.id) }
        render(newTask = true)
        shot("new-task-entry")
        compose.onNodeWithTag("new-task-open").performClick()
        compose.onNodeWithTag("new-task-sheet").assertIsDisplayed()
        compose.onNode(androidx.compose.ui.test.hasSetTextAction()).assertIsFocused()
        shot("new-task-open")
        compose.onNode(androidx.compose.ui.test.hasSetTextAction()).performTextClearance()
        compose.onNode(androidx.compose.ui.test.hasSetTextAction()).performTextInput("Synthetic new task draft")
        compose.onNodeWithTag("new-task-cancel").performClick()
        compose.onNodeWithTag("new-task-sheet").assertDoesNotExist()
        compose.onNodeWithTag("new-task-open").performClick()
        shot("new-task-draft")
        compose.onNodeWithText("Synthetic new task draft").assertIsDisplayed()
        noWrites()
    }

    @Test fun newTaskShareOpensSheetAndKeepsFileInDraft() {
        app.incomingShares.identityReset()
        kotlinx.coroutines.runBlocking { app.incomingShares.bindAccount(NuphosUser.preview.id) }
        app.incomingShares.cancel()
        kotlinx.coroutines.runBlocking { app.incomingShares.awaitIdle() }
        render(newTask = true)
        select("runtimes")
        compose.onNodeWithTag("home-runtimes-close").assertIsDisplayed()
        val key = ai.nuphos.android.session.ComposerDrafts.Key(NuphosUser.preview.id, a.id,
            ai.nuphos.android.session.ComposerDrafts.Destination.NewChat)
        kotlinx.coroutines.runBlocking {
            val id = requireNotNull(app.incomingShares.begin(NuphosUser.preview.id))
            val file = ai.nuphos.android.model.ComposerAttachment(name = "synthetic-note.txt",
                kind = ai.nuphos.android.model.ComposerAttachment.Kind.File("fixture".toByteArray(), "text/plain"))
            app.incomingShares.loaded(id, "Shared synthetic note", app.incomingShares.prepare(listOf(file)))
            app.incomingShares.choose(id, key)
        }
        compose.waitUntil(8_000) { compose.onAllNodesWithTag("new-task-sheet").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Shared synthetic note", substring = true).assertIsDisplayed()
        compose.onNodeWithTag("home-runtimes-close").assertDoesNotExist()
        shot("new-task-shared")
        compose.onNodeWithText("TXT").assertIsDisplayed()
        compose.runOnIdle { assertEquals(listOf("synthetic-note.txt"), app.incomingShares.attachments(key).map { it.name }) }
        noWrites()
    }

    @Test fun newTaskWithoutNameUsesGenericGreeting() {
        app.incomingShares.identityReset()
        kotlinx.coroutines.runBlocking { app.incomingShares.bindAccount(NuphosUser.preview.id) }
        render(newTask = true)
        compose.runOnIdle { state(auth, "state").value = AuthSession.State.SignedIn(NuphosUser.preview.copy(name = "")) }
        compose.onNodeWithTag("new-task-open").performClick()
        compose.onNode(hasSetTextAction()).assertIsFocused()
        // Which greeting is chosen, not where it lands: with the keyboard up, a short screen
        // squeezes the centred greeting out of view, so being on screen depends on the emulator.
        compose.onNodeWithText(app.getString(R.string.new_task_welcome)).assertExists()
        val named = app.getString(R.string.new_task_welcome_name, "\u0000").substringBefore("\u0000")
        compose.onNodeWithText(named, substring = true).assertDoesNotExist()
        shot("new-task-unnamed")
        noWrites()
    }
    @Test fun newTaskSubmitDismissesSheetAndHandsOffPrompt() {
        app.incomingShares.identityReset()
        kotlinx.coroutines.runBlocking { app.incomingShares.bindAccount(NuphosUser.preview.id) }
        render(newTask = true)
        compose.onNodeWithTag("new-task-open").performClick()
        compose.onNode(hasSetTextAction()).performTextClearance()
        compose.onNode(hasSetTextAction()).performTextInput("Synthetic submitted task")
        compose.onNodeWithContentDescription(app.getString(R.string.send)).performClick()
        waitText("Synthetic task destination")
        compose.onNodeWithTag("new-task-sheet").assertDoesNotExist()
        compose.runOnIdle { assertEquals("Synthetic submitted task", agent.pendingPrompt?.text) }
        noWrites() // Stops at the conversation handoff; never sends a real agent request.
    }
    @Test fun newTaskTeamSwitchClosesSheetAndIsolatesDraft() {
        app.incomingShares.identityReset()
        kotlinx.coroutines.runBlocking { app.incomingShares.bindAccount(NuphosUser.preview.id) }
        render(newTask = true)
        compose.onNodeWithTag("new-task-open").performClick()
        compose.onNode(androidx.compose.ui.test.hasSetTextAction()).performTextInput("Team A private draft")
        compose.runOnIdle { agent.select(b) }
        compose.onNodeWithTag("new-task-sheet").assertDoesNotExist()
        compose.onNodeWithTag("new-task-open").performClick()
        compose.onNodeWithText("Team A private draft").assertDoesNotExist()
        noWrites()
    }

    @Test fun bottomTabsSwitchRestoreAndKeepUtilityDestinationsReachable() {
        val restoration = androidx.compose.ui.test.junit4.StateRestorationTester(compose)
        render(restoration = restoration)
        waitText("Synthetic active conversation")
        for (route in listOf("chats", "agent", "inbox")) {
            select(route)
            compose.onNodeWithTag("home-tab-$route").assertIsSelected()
            shot("bottom-tabs-$route")
        }
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithTag("home-tab-inbox").assertIsSelected()
        compose.waitUntil(8_000) { compose.onAllNodesWithTag("inbox-badge", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("inbox-badge", useUnmergedTree = true).assert(androidx.compose.ui.test.SemanticsMatcher.expectValue(
            androidx.compose.ui.semantics.SemanticsProperties.ContentDescription,
            listOf(app.getString(ai.nuphos.android.R.string.shell_inbox_badge, 1)),
        ))
        shot("bottom-tabs-inbox")
        compose.onNodeWithTag("home-runtimes").assertIsDisplayed()
        menu()
        compose.onNodeWithTag("home-page-connectors").assertIsDisplayed()
        compose.onNodeWithTag("home-page-agent").assertDoesNotExist()
        shot("bottom-tabs-utilities")
        Espresso.pressBack()
        select("agent")
        waitText("Synthetic active conversation")
        assertEquals(a.id, agent.selectedTeam?.id)
        noWrites()
        shot("bottom-tabs-tasks")
    }

    @Test fun toolbarNewTaskOpensAndDismissesWithoutChangingTabs() {
        render()
        select("inbox")
        compose.waitUntil(8_000) { agent.hasSelectableRuntimes == true }
        shot("home-toolbar")
        compose.onNodeWithTag("home-create").performClick()
        shot("home-create-menu")
        compose.onNodeWithText(app.getString(R.string.home_toolbar_new_task)).performClick()
        compose.onNodeWithTag("new-task-sheet").assertIsDisplayed()
        shot("home-toolbar-new-task")
        compose.onNodeWithTag("new-task-cancel").performClick()
        compose.onNodeWithTag("new-task-sheet").assertDoesNotExist()
        compose.onNodeWithTag("home-tab-inbox").assertIsSelected()
        noWrites()
    }

    @Test fun staleRuntimeChoiceOnlyDisablesNewBotInSharedMenu() {
        render()
        compose.waitUntil(8_000) { agent.hasSelectableRuntimes == true }
        compose.runOnIdle {
            val selection = auth.runtimeSelections.bind(NuphosUser.preview.id, a.id)
            selection.saveCatalog(listOf(AgentRuntime("synthetic-cloud", "codex", "Synthetic Cloud", "active", "managed")))
            assertTrue(selection.select("synthetic-cloud"))
            runtimeReplaced = true; agent.refreshRuntimes()
        }
        compose.waitUntil(8_000) { agent.creationRuntimes?.singleOrNull()?.id == "replacement" }
        compose.onNodeWithTag("home-create").assertIsEnabled().performClick()
        compose.onNodeWithText(app.getString(R.string.home_toolbar_new_bot)).assertIsNotEnabled()
        compose.onNodeWithText(app.getString(R.string.home_toolbar_new_task)).assertIsEnabled()
        noWrites()
    }

    @Test fun sharedTaskWhileToolbarSheetIsOpenHasOnlyOneSheetAndKeepsDraft() {
        app.incomingShares.identityReset()
        kotlinx.coroutines.runBlocking { app.incomingShares.bindAccount(NuphosUser.preview.id) }
        render(newTask = true)
        select("inbox")
        compose.waitUntil(8_000) { agent.hasSelectableRuntimes == true }
        compose.onNodeWithTag("home-create").performClick()
        compose.onNodeWithText(app.getString(R.string.home_toolbar_new_task)).performClick()
        compose.onNodeWithTag("new-task-sheet").assertIsDisplayed()
        val key = ComposerDrafts.Key(NuphosUser.preview.id, a.id, ComposerDrafts.Destination.NewChat)
        kotlinx.coroutines.runBlocking {
            val id = requireNotNull(app.incomingShares.begin(NuphosUser.preview.id))
            app.incomingShares.loaded(id, "Toolbar shared draft", emptyList())
            app.incomingShares.choose(id, key)
        }
        compose.waitUntil(8_000) { compose.onAllNodesWithText("Toolbar shared draft", substring = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onAllNodesWithTag("new-task-sheet").assertCountEquals(1)
        compose.onNodeWithText("Toolbar shared draft", substring = true).assertIsDisplayed()
        noWrites()
    }

    @Test fun toolbarCreationUsesCurrentRuntimeAvailability() {
        render()
        val create = compose.onNodeWithTag("home-create")
        compose.waitUntil(8_000) { agent.hasSelectableRuntimes == true }
        create.performClick()
        compose.onNodeWithText(app.getString(ai.nuphos.android.R.string.home_toolbar_new_bot)).assertIsDisplayed()
        compose.onNodeWithText(app.getString(ai.nuphos.android.R.string.home_toolbar_new_task)).assertIsDisplayed()
        pressSystemBack()
        runtimeRemoved = true
        compose.runOnIdle { agent.refreshRuntimes() }
        compose.waitUntil(8_000) { agent.hasSelectableRuntimes == false }
        create.assertIsNotEnabled()
        noWrites()
    }

    @Test fun bottomTabsRemainUsableAfterHistoryFailureAndTeamSwitch() {
        historyFailure = true
        render()
        compose.waitUntil(8_000) { agent.phaseError != null }
        select("inbox")
        compose.runOnIdle { agent.select(b) }
        compose.onNodeWithTag("home-tab-inbox").assertIsSelected()
        select("agent")
        compose.onNodeWithTag("home-tab-agent").assertIsSelected()
        compose.runOnIdle { assertEquals(b.id, agent.selectedTeam?.id) }
        noWrites()
    }

    @Test fun allFourPagesSelectedAndBackReturnFocusWithoutWrites() {
        render(keyboard = true); waitText("Synthetic active conversation"); shot("normal")
        compose.onNodeWithTag("home-page-switcher").performKeyInput { pressKey(androidx.compose.ui.input.key.Key.Tab) }
        menu(); shot("menu")
        compose.onNodeWithTag("home-page-monitoring").assertDoesNotExist()
        compose.onNodeWithTag("home-page-triggers").assertDoesNotExist()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("home-tab-agent").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("home-tab-agent").assertIsSelected()
        pressSystemBack()
        compose.onNodeWithTag("home-page-menu").assertDoesNotExist()
        compose.onNodeWithTag("home-page-switcher").assertIsFocused()
        for (route in listOf("connectors", "agent")) {
            select(route); menu()
            compose.onNodeWithTag(if (route == "agent") "home-tab-agent" else "home-page-$route").assertIsSelected()
            Espresso.pressBack()
        }
        assertEquals(a.id, agent.selectedTeam?.id); noWrites()
    }
    @Test fun repeatedDetailsWaitsForFreshCatalogAndDoesNotManageRemovedRuntime() {
        render(); waitText("Synthetic active conversation"); select("runtimes")
        waitText("Cloud")
        compose.onNodeWithTag("runtime-row-synthetic-cloud").performScrollTo().performClick()
        waitText("Refresh runtime")
        pressSystemBack()
        runtimeCatalogHold = CountDownLatch(1)
        try {
            compose.onNodeWithTag("runtime-row-synthetic-cloud").performScrollTo().performClick()
            waitText("Manage runtimes")
            compose.onNodeWithText("Refresh runtime").assertDoesNotExist()
            compose.onNodeWithText("Save name").assertDoesNotExist()
            runtimeCatalogFailure = true
            runtimeCatalogHold!!.countDown()
            waitText("We could not confirm the runtime result. Refresh saved state before continuing.")
            compose.onNodeWithText("Refresh runtime").assertDoesNotExist()
            compose.onNodeWithText("Save name").assertDoesNotExist()
            runtimeCatalogFailure = false; runtimeRemoved = true
            compose.onNodeWithText("Retry runtime list").performScrollTo().performClick()
            compose.waitUntil(8_000) { compose.onAllNodesWithText("This runtime is unavailable.").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Save name").assertDoesNotExist()
            noWrites()
        } finally { runtimeCatalogHold?.countDown() }
    }
    @Test fun runtimesDestinationAndExistingManageSheetPreserveComposerSelectionAndWorkspace() {
        render(); waitText("Synthetic active conversation"); select("runtimes")
        waitText("Cloud")
        compose.onNodeWithTag("runtime-row-synthetic-cloud").performScrollTo().performClick()
        compose.waitUntil(8_000) { compose.onAllNodesWithText("Refresh runtime").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Save name").assertIsNotEnabled()
        pressSystemBack()
        assertEquals(a.id, agent.selectedTeam?.id)
        assertNull(auth.runtimeSelections.bind(NuphosUser.preview.id, a.id).selectedId)
        pressSystemBack()
        compose.onNodeWithTag("home-tab-agent").assertIsSelected()
        waitText("Synthetic active conversation")
        noWrites()
    }
    @Test fun agentsHasSearchButNoFilter() {
        render(); waitText("Synthetic active conversation")
        compose.onNodeWithTag("home-search").assertIsDisplayed()
        compose.onNodeWithTag("home-filter").assertDoesNotExist()
        compose.onNodeWithContentDescription("Filter tasks").assertDoesNotExist()
        shot("agents-toolbar")
        assertFixedListSelectors(); noWrites()
    }

    @Test fun searchResetAndTeamSwitchKeepTheFixedListSelectors() {
        render(); waitText("Synthetic active conversation")
        compose.onNodeWithTag("home-search").performClick()
        compose.onNodeWithText(app.getString(ai.nuphos.android.R.string.search_chats)).performTextInput("needle")
        compose.waitUntil(5_000) { requests.any { it.url.encodedPath == "/agent/conversations" && it.url.queryParameter("search") == "needle" } }
        select("runtimes")
        compose.onNodeWithTag("home-runtimes-close").performClick()
        compose.runOnIdle { assertEquals("needle", agent.search) }
        compose.onNodeWithTag("home-workspace-picker").performClick()
        compose.onNodeWithText(b.name).performScrollTo().performClick()
        compose.waitUntil(8_000) { requests.any { it.url.encodedPath == "/agent/conversations" && it.url.queryParameter("teamId") == b.id } }
        assertFixedListSelectors(); noWrites()
    }

    @Test fun taskFamiliesWaitingOnAQuestionAppearFirst() {
        historyFamilies = true
        render()
        waitText("Task with a waiting thread")
        waitText("Recent standalone task")
        val waiting = compose.onNodeWithText("Task with a waiting thread").fetchSemanticsNode().boundsInRoot.top
        val recent = compose.onNodeWithText("Recent standalone task").fetchSemanticsNode().boundsInRoot.top
        assertTrue(waiting < recent)
        shot("task-family-order")
        noWrites()
    }

    @Test fun selectedPageSurvivesSavedStateAndOutsideDismisses() {
        val restoration = StateRestorationTester(compose)
        render(restoration = restoration); select("inbox")
        select("runtimes")
        pressSystemBack()
        compose.onNodeWithTag("home-tab-inbox").assertIsSelected()
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithTag("home-tab-inbox").assertIsSelected()
        menu()
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val bounds = compose.onAllNodes(isRoot()).onFirst().fetchSemanticsNode().boundsInRoot
        val now = android.os.SystemClock.uptimeMillis()
        for (action in listOf(android.view.MotionEvent.ACTION_DOWN, android.view.MotionEvent.ACTION_UP)) {
            val event = android.view.MotionEvent.obtain(now, now, action, bounds.right - 10f, bounds.bottom - 50f, 0)
            automation.injectInputEvent(event, true); event.recycle()
        }
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("home-page-menu").fetchSemanticsNodes().isEmpty() }
        noWrites()
    }
    @Test fun compactRtlLargeFontAllEntriesRemainReachable() {
        render(compact = true)
        for (route in listOf("chats", "agent", "inbox")) compose.onNodeWithTag("home-tab-$route").assertIsDisplayed()
        compose.onNodeWithTag("home-runtimes").assertIsDisplayed()
        menu(); shot("rtl-large-menu")
        compose.onNodeWithTag("home-page-connectors").performScrollTo().assertIsDisplayed()
        Espresso.pressBack(); compose.onNodeWithTag("home-filter").assertDoesNotExist()
        noWrites()
    }

    @Test fun deniedHistoryDoesNotBlockNavigationOrAlterWorkspace() {
        historyFailure = true; render()
        select("runtimes")
        pressSystemBack()
        compose.onNodeWithTag("home-tab-agent").assertIsSelected()
        compose.runOnIdle { assertNotNull(agent.phaseError); assertEquals(a.id, agent.selectedTeam?.id) }
        menu(); compose.onNodeWithTag("home-page-connectors").performClick(); noWrites()
    }
    @Test fun keyboardEnterOpensMenuAndBackRestoresAnchor() {
        render(keyboard = true); waitText("Synthetic active conversation")
        compose.onRoot().performKeyInput { pressKey(Key.Tab) }
        compose.onNodeWithTag("home-page-switcher").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.RequestFocus) { it() }
        compose.onNodeWithTag("home-page-switcher").assertIsFocused()
        compose.onNodeWithTag("home-page-switcher").performKeyInput { pressKey(Key.Enter) }
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("home-tab-agent").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("home-tab-agent").assertIsSelected()
        pressSystemBack()
        compose.onNodeWithTag("home-page-switcher").assertIsFocused()
        compose.onNodeWithTag("home-page-menu").assertDoesNotExist(); noWrites()
    }

    @Test fun archiveRequiresConfirmationAndRemovesTheRowFromTheList() {
        render(); waitText("Synthetic active conversation")
        compose.onNodeWithText("Synthetic active conversation").performTouchInput { longClick() }
        compose.onNodeWithText("Archive").performClick(); waitText("Archive task?")
        compose.onNodeWithText("Cancel").performClick(); assertFalse(archived); noWrites()
        compose.onNodeWithText("Synthetic active conversation").performTouchInput { longClick() }
        compose.onNodeWithText("Archive").performClick(); waitText("Archive task?")
        compose.onAllNodesWithText("Archive").onLast().performClick()
        compose.waitUntil(8_000) { archived && agent.conversations.isEmpty() && agent.rowActionSessionId == null }
        compose.onNodeWithText("Synthetic active conversation").assertDoesNotExist()
        assertEquals(1, requests.count { it.method == "PATCH" })
        assertTrue(requests.none { it.method !in setOf("GET", "PATCH") })
        assertFixedListSelectors()
    }

    @Test fun archiveFailureKeepsTheRowAndOffersExplicitRetry() {
        archiveFailure = true; render(); waitText("Synthetic active conversation")
        compose.onNodeWithText("Synthetic active conversation").performTouchInput { longClick() }
        compose.onNodeWithText("Archive").performClick(); waitText("Archive task?")
        compose.onAllNodesWithText("Archive").onLast().performClick()
        waitText("Action failed. Refresh the list and try again.")
        assertFalse(archived); compose.onNodeWithText("Synthetic active conversation").assertExists()
        archiveFailure = false; compose.onAllNodesWithText("Archive").onLast().performClick()
        compose.waitUntil(8_000) { archived && agent.conversations.isEmpty() && agent.rowActionSessionId == null }
        assertEquals(2, requests.count { it.method == "PATCH" })
    }

    /** Saved where CI collects it (the android-device-tests artifact), unlike [shot]. */
    private fun evidence(name: String) {
        compose.waitForIdle()
        Thread.sleep(250) // Wait for the platform popup window to draw before capturing its pixels.
        val dir = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir") ?: return
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        try { File(dir, "two-factor-resume-$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } } finally { bitmap.recycle() }
    }

    private fun signIn() = compose.runOnIdle {
        AiAccess.activate(token); AiAccess.grant(token)
        AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, token)
        state(auth, "state").value = AuthSession.State.SignedIn(NuphosUser.preview)
    }

    @Test fun signingInAgainToTurnOnTwoFactorComesBackToIt() {
        render()
        compose.onNodeWithContentDescription("Account").performClick()
        compose.onNodeWithText("Two-factor authentication").performScrollTo().performClick()
        waitText("Turn on")
        compose.onNodeWithText("Turn on").performClick()
        waitText("Sign in again to turn on two-factor authentication.")
        evidence("two-factor-sign-in-again")
        compose.onNodeWithText("Sign out and sign in again").performClick()
        compose.waitUntil(8_000) { auth.state is AuthSession.State.SignedOut }

        signedInAgain = true
        signIn()
        // Captured either way: the screen this sign-in lands on is the change under review.
        try { waitText("Turn on") } finally { evidence("two-factor-after-sign-in") }
        compose.onNodeWithText("Turn on").performClick()
        waitText("JBSW Y3DP EHPK 3PXP")

        // Only that one sign-in comes back; the next one opens home as usual.
        compose.runOnIdle { auth.signOut() }
        compose.waitUntil(8_000) { auth.state is AuthSession.State.SignedOut }
        signIn()
        compose.waitUntil(8_000) { compose.onAllNodesWithTag("home-page-switcher").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("account-sheet-title").assertDoesNotExist()
        compose.onNodeWithText("Turn on").assertDoesNotExist()
    }
}
