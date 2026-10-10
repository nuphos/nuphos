package ai.nuphos.android

import android.content.Context
import androidx.activity.compose.setContent
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.AccountApi
import ai.nuphos.android.data.Http
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.session.AuthSession
import kotlinx.serialization.json.*
import kotlinx.coroutines.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList

/** The outer rule replaces both HTTP clients before the real root Activity exists. */
@RunWith(AndroidJUnit4::class)
class AccountParityFixtureDeviceTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private data class Read(val method: String, val path: String)
    private val requests = CopyOnWriteArrayList<Read>()
    private val unexpected = CopyOnWriteArrayList<Read>()
    private val originals = mutableMapOf<String, OkHttpClient>()
    private val authSnapshot = mutableMapOf<String, Any?>()
    private lateinit var app: NuphosApplication
    private var accessSnapshot: Any? = null
    private var savedToken: String? = null
    private var preferences: Map<String, *> = emptyMap<String, Any>()
    @Volatile private var consentReadMode = "valid"
    @Volatile private var rejectConsentWrite = false
    @Volatile private var draftTeam = false
    @Volatile private var draftNavigation = false
    @Volatile private var accepted = false
    @Volatile private var failStatus = false
    @Volatile private var ambiguousSubmission = false
    @Volatile private var receipt: String? = null
    @Volatile private var validDeletionBody = false
    @Volatile private var validEmailBody = false
    @Volatile private var heldPath: String? = null
    private val heldEntered = CountDownLatch(1)
    private val releaseHeld = CountDownLatch(1)
    @Volatile private var profileName = "Account fixture user"
    private val user = """{"id":"account-fixture-user","name":"Account fixture user","username":"account_fixture","email":"account-fixture@example.invalid","avatarURL":""}"""

    @Suppress("UNCHECKED_CAST")
    private fun accessState() = AiAccess::class.java.getDeclaredField("state").also { it.isAccessible = true }
        .get(AiAccess) as MutableState<Any?>

    private val network = object : ExternalResource() {
        override fun before() {
            app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
            savedToken = app.tokenStore.read()
            preferences = app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).all.toMap()
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                for (name in listOf("state", "generation", "consentVersion", "consentBusy", "consentError", "profileError")) {
                    authSnapshot["$name\$delegate"] = authState(name).value
                }
                for (name in listOf("token", "consentRequest", "customTabsOpen")) {
                    val field = AuthSession::class.java.getDeclaredField(name).also { it.isAccessible = true }
                    authSnapshot[name] = field.get(app.authSession)
                }
                accessSnapshot = accessState().value
                authState("state").value = AuthSession.State.Restoring
                AiAccess.revoke()
            }
            val client = OkHttpClient.Builder().addInterceptor { chain ->
                val request = chain.request()
                val path = request.url.encodedPath
                val read = Read(request.method, path)
                requests += read
                if (path == heldPath) {
                    heldEntered.countDown()
                    check(releaseHeld.await(8, TimeUnit.SECONDS)) { "Held fixture response not released" }
                }
                var status = 200
                fun body(): JsonObject = request.body?.let {
                    val buffer = Buffer(); it.writeTo(buffer)
                    Http.json.parseToJsonElement(buffer.readUtf8()).jsonObject
                } ?: JsonObject(emptyMap())
                val response = when {
                    path == "/auth/me" && request.method == "GET" -> currentUser()
                    path == "/auth/me" && request.method == "PATCH" -> {
                        val fields = body()
                        if (fields.keys != setOf("name", "username", "avatarURL")) unexpected += read
                        if (fields["username"]?.jsonPrimitive?.content == "occupied_fixture") {
                            status = 409
                            """{"error":{"message":"Username conflict"}}"""
                        } else {
                            profileName = fields["name"]?.jsonPrimitive?.content ?: "Account fixture user"
                            currentUser()
                        }
                    }
                    path == "/auth/ai-consent" && request.method == "GET" -> when (consentReadMode) {
                        "error" -> { status = 503; "{}" }
                        "unsupported" -> """{"version":"2099-01-01","accepted":true}"""
                        else -> consent()
                    }
                    path == "/auth/ai-consent" && request.method == "PUT" -> {
                        val fields = body()
                        if (fields.keys != setOf("version", "accepted") || fields["version"]?.jsonPrimitive?.content != AccountApi.AI_CONSENT_VERSION) unexpected += read
                        if (rejectConsentWrite) { status = 503; """{"error":{"message":"Synthetic consent rejection"}}""" }
                        else {
                            accepted = fields["accepted"]?.jsonPrimitive?.booleanOrNull == true
                            consent()
                        }
                    }
                    path == "/auth/account-deletion" && request.method == "GET" -> {
                        if (failStatus) { status = 503; "{}" } else envelope()
                    }
                    path == "/auth/account-deletion" && request.method == "POST" -> {
                        val fields = body()
                        val password = fields["password"]?.jsonPrimitive?.content
                        val code = fields["code"]?.jsonPrimitive?.content
                        validDeletionBody = fields["confirmation"]?.jsonPrimitive?.content == "DELETE" &&
                            ((password != null && password.length >= 12 && code == null && fields.keys == setOf("confirmation", "password")) ||
                                (code != null && code.length == 6 && password == null && fields.keys == setOf("confirmation", "code")))
                        if (!validDeletionBody) unexpected += read
                        receipt = if (ambiguousSubmission) "future_state" else "requested"
                        status = if (ambiguousSubmission) 503 else 202
                        if (ambiguousSubmission) "{}" else envelope()
                    }
                    path == "/auth/email/request-code" && request.method == "POST" -> {
                        val fields = body()
                        validEmailBody = fields.keys == setOf("email") && fields["email"]?.jsonPrimitive?.content == "account-fixture@example.invalid" && request.header("Authorization") == null
                        if (!validEmailBody) unexpected += read
                        """{"ok":true}"""
                    }
                    request.method == "GET" && path == "/teams" -> if (draftNavigation) """{"teams":[{"id":"aaaaaaaaaaaaaaaaaaaaaaaa","name":"Draft fixture"},{"id":"bbbbbbbbbbbbbbbbbbbbbbbb","name":"Other draft fixture"}]}""" else if (draftTeam) """{"teams":[{"id":"aaaaaaaaaaaaaaaaaaaaaaaa","name":"Draft fixture"}]}""" else """{"teams":[]}"""
                    draftTeam && request.method == "GET" && path == "/teams/aaaaaaaaaaaaaaaaaaaaaaaa/connectors" -> """{"aws":[],"gcp":[],"cloudflare":[],"linode":[],"hetzner":[],"tencent":[],"aliyun":[],"volcengine":[],"azure":[],"huawei":[],"vanta":[],"secureframe":[],"sonarqube":[],"notion":[],"onprem":[],"upstash":[],"resend":[],"posthog":[],"betterstack":[],"uptimeKuma":[],"tailscale":[],"zeabur":[],"github":[],"gitlab":[],"grafana":[],"linear":[],"jira":[],"asana":[],"sentry":[]}"""
                    draftTeam && request.method == "GET" && path == "/teams/aaaaaaaaaaaaaaaaaaaaaaaa/members" -> """{"members":[]}"""
                    draftTeam && request.method == "GET" && path == "/agent/plan-approval-policy" && request.url.queryParameter("teamId") == "aaaaaaaaaaaaaaaaaaaaaaaa" -> """{"requesterApprovalRequired":true,"minimumOtherApprovals":0}"""
                    request.method == "GET" && path == "/teams/aaaaaaaaaaaaaaaaaaaaaaaa/favorites" -> """{"entries":[],"revision":0}"""
                    draftNavigation && request.method == "GET" && path == "/agent/conversations" && request.url.queryParameter("teamId") == "aaaaaaaaaaaaaaaaaaaaaaaa" -> """{"conversations":[{"sessionId":"draft-one","teamId":"aaaaaaaaaaaaaaaaaaaaaaaa","title":"Draft chat one","isOwner":true},{"sessionId":"draft-two","teamId":"aaaaaaaaaaaaaaaaaaaaaaaa","title":"Draft chat two","isOwner":true}]}"""
                    draftNavigation && request.method == "GET" && path in setOf("/agent/conversations/draft-one", "/agent/conversations/draft-two") && request.url.queryParameter("teamId") == "aaaaaaaaaaaaaaaaaaaaaaaa" -> """{"messages":[],"isOwner":true,"readOnly":false,"title":"${if (path.endsWith("draft-one")) "Draft chat one" else "Draft chat two"}"}"""
                    draftNavigation && request.method == "GET" && path == "/agent/auto-mode/bypass" && request.url.queryParameter("sessionId") in setOf("draft-one", "draft-two") -> """{"bypass":false}"""
                    draftNavigation && request.method == "GET" && path == "/teams/bbbbbbbbbbbbbbbbbbbbbbbb/favorites" -> """{"entries":[],"revision":0}"""
                    draftNavigation && request.method == "GET" && path == "/teams/bbbbbbbbbbbbbbbbbbbbbbbb/connectors" -> """{}"""
                    draftNavigation && request.method == "GET" && path == "/teams/bbbbbbbbbbbbbbbbbbbbbbbb/members" -> """{"members":[]}"""
                    draftNavigation && request.method == "GET" && path == "/agent/plan-approval-policy" && request.url.queryParameter("teamId") == "bbbbbbbbbbbbbbbbbbbbbbbb" -> """{"requesterApprovalRequired":true,"minimumOtherApprovals":0}"""
                    request.method == "GET" && path == "/agent/conversations" -> """{"conversations":[]}"""
                    request.method == "GET" && path == "/agent/plans" -> """{"plans":[]}"""
                    else -> { unexpected += read; status = 599; "{}" }
                }
                Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(status)
                    .message("local account fixture").body(response.toResponseBody(Http.jsonMedia)).build()
            }.build()
            for (name in listOf("client", "chatClient")) {
                val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
                originals[name] = field.get(null) as OkHttpClient
                field.set(null, client)
            }
            app.tokenStore.write("account-fixture-token")
        }

        override fun after() {
            releaseHeld.countDown()
            // The inner rule has closed Activity. Restore exact in-memory identity and access.
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                authSnapshot.forEach { (name, value) ->
                    if (name.endsWith("\$delegate")) authState(name.removeSuffix("\$delegate")).value = value
                    else AuthSession::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(app.authSession, value)
                }
                accessState().value = accessSnapshot
            }
            if (savedToken == null) app.tokenStore.clear() else app.tokenStore.write(requireNotNull(savedToken))
            originals.forEach { (name, client) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client) }
            assertTrue("Installed token changed (values withheld)", savedToken == app.tokenStore.read())
            assertTrue("Installed preferences changed (values withheld)", preferences == app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).all)
            assertTrue("Unexpected endpoint or body (values withheld): $unexpected", unexpected.isEmpty())
        }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(network).around(compose)

    @Suppress("UNCHECKED_CAST")
    private fun authState(name: String) = AuthSession::class.java.getDeclaredField("$name\$delegate").also { it.isAccessible = true }
        .get(app.authSession) as MutableState<Any?>
    private fun currentUser() = Http.json.parseToJsonElement(user).jsonObject.toMutableMap().also { it["name"] = JsonPrimitive(profileName) }.let { JsonObject(it).toString() }
    private fun consent() = """{"version":"${AccountApi.AI_CONSENT_VERSION}","accepted":$accepted}"""
    private fun envelope() = receipt?.let { """{"request":{"status":"$it","requestedAt":"2026-10-05T00:00:00Z","dueAt":"2026-11-04T00:00:00Z"}}""" } ?: """{"request":null}"""
    private fun screenshot(name: String) {
        compose.mainClock.advanceTimeBy(500)
        compose.waitForIdle()
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        // Native dialog/IME WindowManager fades use real time, outside the Compose clock.
        android.os.SystemClock.sleep(350)
        val file = java.io.File(app.cacheDir, "account-fixture-$name.png")
        java.io.FileOutputStream(file).use { output ->
            InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
                .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output)
        }
    }
    private fun count(method: String, path: String) = requests.count { it.method == method && it.path == path }
    private fun awaitText(text: String) {
        try {
            compose.waitUntil(8_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
        } catch (e: Throwable) {
            val file = java.io.File(app.cacheDir, "account-fixture-failure.png")
            java.io.FileOutputStream(file).use { output ->
                InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
                    .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output)
            }
            throw AssertionError("Missing $text; requests=$requests; receipt=$receipt; consent=$accepted; generation=${app.authSession.generation}; failure image in app cache", e)
        }
    }
    private fun tap(text: String) = compose.onNodeWithText(text).performScrollTo().performClick()
    private fun account() {
        awaitText("Before you use AI agents")
        screenshot("consent")
        assertEquals("Home loaded teams before explicit agreement", 0, count("GET", "/teams"))
        tap("Not now — manage my account")
        awaitText("Edit profile")
    }
    private fun deletion() { account(); tap("Account deletion request"); awaitText("Request permanent deletion") }
    private fun enter(label: String, value: String) = compose.onNodeWithText(label).performScrollTo().performTextReplacement(value)
    private fun submits() = count("POST", "/auth/account-deletion")

    @Test fun rootActivityRecreationRetainsTextAndConfirmedWithdrawalFencesOldComposer() {
        draftTeam = true
        awaitText("Before you use AI agents")
        tap("Agree and continue")
        compose.waitUntil(8_000) { compose.onAllNodesWithContentDescription("Ask Nuphos anything").fetchSemanticsNodes().isNotEmpty() }
        val text = "  activity draft\n  "
        compose.onNodeWithContentDescription("Ask Nuphos anything").performTextReplacement(text)
        val auth = app.authSession
        val generation = auth.generation
        val destination = ai.nuphos.android.session.ComposerDrafts.Destination.NewChat
        val lease = auth.composerDrafts.bind(requireNotNull(auth.user).id, "aaaaaaaaaaaaaaaaaaaaaaaa", destination)!!
        compose.activityRule.scenario.recreate()
        compose.waitUntil(8_000) { compose.onAllNodesWithContentDescription("Ask Nuphos anything").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("Ask Nuphos anything").assertTextEquals(text)
        assertSame(auth, (compose.activity.application as NuphosApplication).authSession)
        assertEquals(generation, auth.generation)
        compose.onNodeWithContentDescription("Profile").performClick()
        tap("Withdraw AI sharing consent")
        compose.onNodeWithText("Withdraw").performClick()
        awaitText("Before you use AI agents")
        assertEquals("", lease.text)
        assertFalse(lease.write("late private text"))
        assertEquals("", auth.composerDrafts.bind(requireNotNull(auth.user).id, "aaaaaaaaaaaaaaaaaaaaaaaa", destination)!!.text)
    }

    @Test fun actualChatNavigationKeepsTwoChatsAndNewChatIsolatedAcrossTeams() {
        draftTeam = true
        draftNavigation = true
        awaitText("Before you use AI agents")
        tap("Agree and continue")
        awaitText("Draft chat one")
        val token = requireNotNull(app.authSession.token)
        lateinit var agent: ai.nuphos.android.session.AgentStore
        compose.runOnIdle {
            compose.activity.setContent {
                androidx.compose.runtime.CompositionLocalProvider(ai.nuphos.android.ui.LocalAuthSession provides app.authSession) {
                    ai.nuphos.android.ui.SignedInHost(requireNotNull(app.authSession.user), token) { _, context ->
                        ai.nuphos.android.session.AgentStore(token, context).also { agent = it }
                    }
                }
            }
        }
        awaitText("Draft chat one")
        fun input() = compose.onNodeWithContentDescription("Ask Nuphos anything")
        fun backToHistory() {
            compose.onNodeWithContentDescription("Back").performClick()
            compose.waitUntil(8_000) { compose.onAllNodesWithText("Draft chat one", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
        }
        fun openChat(title: String) {
            // On the small API 33 screen, expanded text and the IME can cover a row.
            val collapse = compose.onAllNodesWithContentDescription("Collapse composer")
            if (collapse.fetchSemanticsNodes().isNotEmpty()) collapse.onFirst().performClick()
            compose.runOnIdle { compose.activity.window.insetsController?.hide(android.view.WindowInsets.Type.ime()) }
            compose.waitUntil(8_000) { compose.onAllNodesWithText(title, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText(title, useUnmergedTree = true).performScrollTo().performClick()
            compose.waitUntil(8_000) { compose.onAllNodesWithContentDescription("Back").fetchSemanticsNodes().isNotEmpty() }
        }
        try {
            input().performTextReplacement(" new first team ")
            openChat("Draft chat one")
            compose.waitUntil(8_000) { count("GET", "/agent/conversations/draft-one") > 0 }
            input().performTextReplacement("  A\n ")
            backToHistory()
            input().assertTextEquals(" new first team ")
            openChat("Draft chat two")
            compose.waitUntil(8_000) { count("GET", "/agent/conversations/draft-two") > 0 }
            input().assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.EditableText, androidx.compose.ui.text.AnnotatedString("")))
            input().performTextReplacement(" B ")
            backToHistory()
            openChat("Draft chat one")
            input().assertTextEquals("  A\n ")
            backToHistory()
            openChat("Draft chat two")
            input().assertTextEquals(" B ")
            backToHistory()
            // No native workspace picker exists in this baseline. Drive its existing store
            // selection hook with an authorized fixture team, then verify real composer UI.
            compose.runOnIdle { agent.select(agent.teams.single { it.id == "bbbbbbbbbbbbbbbbbbbbbbbb" }) }
            compose.waitUntil(8_000) { agent.selectedTeam?.id == "bbbbbbbbbbbbbbbbbbbbbbbb" && agent.phase == ai.nuphos.android.session.AgentStore.Phase.Loaded }
            input().assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.EditableText, androidx.compose.ui.text.AnnotatedString("")))
            input().performTextReplacement(" other team ")
            compose.runOnIdle { agent.select(agent.teams.single { it.id == "aaaaaaaaaaaaaaaaaaaaaaaa" }) }
            awaitText("Draft chat one")
            input().assertTextEquals(" new first team ")
            compose.runOnIdle { agent.select(agent.teams.single { it.id == "bbbbbbbbbbbbbbbbbbbbbbbb" }) }
            compose.waitUntil(8_000) { agent.selectedTeam?.id == "bbbbbbbbbbbbbbbbbbbbbbbb" && agent.phase == ai.nuphos.android.session.AgentStore.Phase.Loaded }
            input().assertTextEquals(" other team ")
        } finally {
            // Restore only the preference this fixture's explicit selection wrote.
            val prefs = app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE)
            val key = "nuphos.workspace.lastTeamId"
            val previous = preferences[key] as String?
            prefs.edit().apply { if (previous == null) remove(key) else putString(key, previous) }.commit()
        }
    }

    @Test fun composerDisabledFalseRejectedAndAcceptedSubmitKeepCorrectTextOwnership() {
        awaitText("Before you use AI agents")
        compose.waitUntil(8_000) { !app.authSession.consentBusy }
        val token = requireNotNull(app.authSession.token)
        val account = requireNotNull(app.authSession.user).id
        val destination = ai.nuphos.android.session.ComposerDrafts.Destination.NewChat
        val draft = app.authSession.composerDrafts.bind(account, "aaaaaaaaaaaaaaaaaaaaaaaa", destination)!!
        val other = app.authSession.composerDrafts.bind(account, "aaaaaaaaaaaaaaaaaaaaaaaa", ai.nuphos.android.session.ComposerDrafts.Destination.Chat("other"))!!
        val enabled = androidx.compose.runtime.mutableStateOf(false)
        val accepts = androidx.compose.runtime.mutableStateOf(false)
        val rejected = androidx.compose.runtime.mutableStateOf<ai.nuphos.android.model.ComposerSubmission?>(null)
        val visible = androidx.compose.runtime.mutableStateOf(true)
        var attempts = 0
        var restored = 0
        compose.runOnIdle {
            AiAccess.grant(token)
            other.write("unrelated")
            val agent = ai.nuphos.android.session.AgentStore(token, app)
            compose.activity.setContent {
                ai.nuphos.android.ui.theme.NuphosTheme {
                    androidx.compose.runtime.CompositionLocalProvider(ai.nuphos.android.ui.LocalAgentStore provides agent) {
                        if (visible.value) ai.nuphos.android.ui.chat.ChatComposer(
                            isStreaming = false, draft = draft, canSubmit = enabled.value,
                            onSend = { attempts++; accepts.value }, rejectedSubmission = rejected.value,
                            onRejectedRestored = { restored++; rejected.value = null },
                        )
                    }
                }
            }
        }
        fun input() = compose.onNodeWithContentDescription("Ask Nuphos anything")
        input().performTextReplacement("  unsent\n ")
        compose.onNodeWithContentDescription("Send").performClick()
        input().assertTextEquals("  unsent\n ")
        assertEquals(0, attempts)
        compose.runOnIdle { enabled.value = true }
        compose.onNodeWithContentDescription("Send").performClick()
        input().assertTextEquals("  unsent\n ")
        assertEquals(1, attempts)
        compose.runOnIdle { accepts.value = true }
        compose.onNodeWithContentDescription("Send").performClick()
        input().assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.EditableText, androidx.compose.ui.text.AnnotatedString("")))
        assertEquals(2, attempts)
        assertEquals("unrelated", other.text)
        compose.runOnIdle { visible.value = false }
        compose.waitForIdle()
        compose.runOnIdle { visible.value = true }
        input().assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.EditableText, androidx.compose.ui.text.AnnotatedString("")))
        compose.runOnIdle { rejected.value = ai.nuphos.android.model.ComposerSubmission(" rejected text ") }
        compose.waitUntil(8_000) { restored == 1 }
        input().assertTextEquals(" rejected text ")
        assertEquals(" rejected text ", draft.text)
        assertEquals("unrelated", other.text)
    }

    @Test fun declinedAccountAllowsProfileCancelAndConflictThenExplicitAgreeAndWithdraw() {
        account()
        tap("Edit profile")
        screenshot("edit-profile")
        enter("Name", "Cancelled fixture name")
        tap("Cancel")
        assertEquals("Cancel sent a profile mutation", 0, count("PATCH", "/auth/me"))
        tap("Edit profile")
        enter("Username", "occupied_fixture")
        tap("Save")
        awaitText("That username is already in use. Choose another one.")
        compose.onNodeWithText("occupied_fixture").assertExists()
        assertEquals("Conflict changed authenticated user", "account_fixture", app.authSession.user?.username)
        tap("Cancel")
        tap("Edit profile")
        enter("Name", "Updated fixture name")
        tap("Save")
        compose.waitUntil(8_000) { app.authSession.user?.name == "Updated fixture name" }
        compose.waitUntil(8_000) { compose.onAllNodesWithText("Save").fetchSemanticsNodes().isEmpty() }
        compose.onAllNodesWithText("Updated fixture name").onFirst().assertIsDisplayed()
        assertEquals("Profile save initialized teams before agreement", 0, count("GET", "/teams"))
        assertEquals("Expected one conflict and one successful profile save", 2, count("PATCH", "/auth/me"))
        assertTrue(InstrumentationRegistry.getInstrumentation().uiAutomation.performGlobalAction(
            android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK))
        compose.waitUntil(8_000) { compose.onAllNodesWithText("Edit profile").fetchSemanticsNodes().isEmpty() }
        awaitText("Agree and continue")
        tap("Agree and continue")
        compose.waitUntil(8_000) { count("GET", "/teams") > 0 }
        compose.waitUntil(8_000) { compose.onAllNodesWithContentDescription("Profile").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("Profile").performClick()
        tap("Withdraw AI sharing consent")
        compose.onNodeWithText("Withdraw").performClick()
        awaitText("Before you use AI agents")
        compose.onNodeWithContentDescription("Profile").assertDoesNotExist()
        screenshot("withdrawn")
        assertFalse("Withdrawal left local AI access enabled", app.authSession.aiAllowed)
        assertEquals("Consent did not require explicit agree and withdraw", 2, count("PUT", "/auth/ai-consent"))
        assertFalse("Withdrawal cancelled a server run", requests.any { it.path.contains("cancel") || it.path.contains("abort") })
    }

    @Test fun failedStatusBlocksSubmitThenPasswordReceiptSurvivesRecreationWithoutResubmit() {
        failStatus = true
        deletion()
        awaitText("We could not check your deletion request. Retry the status check before submitting.")
        compose.onNodeWithText("Request permanent deletion").assertIsNotEnabled()
        assertEquals("Opening deletion submitted a request", 0, submits())
        failStatus = false
        val statusReads = count("GET", "/auth/account-deletion")
        tap("Refresh request status")
        compose.waitUntil(8_000) { count("GET", "/auth/account-deletion") > statusReads }
        compose.waitForIdle()
        compose.onNodeWithText("Type DELETE").performScrollTo().assertIsEnabled()
        tap("Confirm with my password")
        enter("Account password", "synthetic-password-only")
        enter("Type DELETE", "DELETE")
        compose.onNodeWithText("Request permanent deletion").assertIsEnabled()
        compose.activityRule.scenario.recreate()
        awaitText("Before you use AI agents")
        assertEquals("Recreation submitted a password draft", 0, submits())
        tap("Not now — manage my account")
        tap("Account deletion request")
        awaitText("Request permanent deletion")
        compose.waitUntil(8_000) { compose.onAllNodes(hasText("Send verification code") and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
        tap("Confirm with my password")
        // Appending one character must remain too short: the old password cannot survive.
        compose.onNodeWithText("Account password").performScrollTo().performTextInput("x")
        enter("Type DELETE", "DELETE")
        compose.onNodeWithText("Request permanent deletion").assertIsNotEnabled()
        enter("Account password", "synthetic-password-only")
        compose.onNodeWithText("Request permanent deletion").assertIsEnabled()
        tap("Request permanent deletion")
        awaitText("Request received")
        compose.onNodeWithText("Complete by: 2026-11-04T00:00:00Z").performScrollTo().assertIsDisplayed()
        screenshot("deletion-receipt")
        assertTrue("Deletion body did not contain exactly one verification credential", validDeletionBody)
        assertEquals(1, submits())
        compose.activityRule.scenario.recreate()
        awaitText("Before you use AI agents")
        tap("Not now — manage my account")
        tap("Account deletion request")
        awaitText("Request received")
        assertEquals("Recreation resubmitted deletion", 1, submits())
        assertNotNull("A saved request signed the user out", app.authSession.user)
    }

    @Test fun emailCodeAmbiguousSubmitReconcilesUnknownStatusBeforeAnyManualRetry() {
        ambiguousSubmission = true
        deletion()
        compose.waitUntil(8_000) { compose.onAllNodes(hasText("Send verification code") and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
        tap("Send verification code")
        awaitText("Code sent — check your inbox")
        assertTrue("Code email body or authentication was incorrect", validEmailBody)
        enter("Verification code", "123456")
        enter("Type DELETE", "DELETE")
        val reads = count("GET", "/auth/account-deletion")
        tap("Request permanent deletion")
        awaitText("Request received")
        compose.onNodeWithText("Status: Unknown status (future_state)").performScrollTo().assertIsDisplayed()
        assertTrue("Ambiguous POST did not reconcile with status GET", count("GET", "/auth/account-deletion") > reads)
        assertTrue("Code submit did not contain exactly one verification credential", validDeletionBody)
        compose.activityRule.scenario.recreate()
        awaitText("Before you use AI agents")
        assertEquals("Ambiguous submission was automatically retried", 1, submits())
        assertEquals("Code was automatically resent", 1, count("POST", "/auth/email/request-code"))
    }
    private fun replaceMemoryIdentity() {
        val replacement = requireNotNull(app.authSession.user).copy(id = "replacement-fixture", name = "Replacement user")
        authState("generation").value = app.authSession.generation + 1
        authState("state").value = AuthSession.State.SignedIn(replacement)
        authState("consentVersion").value = null
        authState("consentBusy").value = false
        AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(app.authSession, "replacement-fixture-token")
        AiAccess.activate("replacement-fixture-token")
    }

    @Test fun oldConsentResponseCannotGrantAnotherIdentity() {
        awaitText("Before you use AI agents")
        compose.waitUntil(8_000) { !app.authSession.consentBusy }
        heldPath = "/auth/ai-consent"
        accepted = true
        lateinit var pending: Job
        compose.runOnIdle {
            app.authSession.loadAIConsent()
            val scope = AuthSession::class.java.getDeclaredField("scope").also { it.isAccessible = true }.get(app.authSession) as CoroutineScope
            pending = scope.coroutineContext[Job]!!.children.first { it.isActive }
        }
        assertTrue(heldEntered.await(3, TimeUnit.SECONDS))
        compose.runOnIdle { replaceMemoryIdentity() }
        releaseHeld.countDown()
        compose.waitUntil(8_000) { pending.isCompleted }
        assertEquals("replacement-fixture", app.authSession.user?.id)
        assertNull(app.authSession.consentVersion)
        assertFalse(app.authSession.aiAllowed)
        assertEquals(0, count("GET", "/teams"))
    }

    @Test fun oldProfileSaveCannotOverwriteAnotherIdentity() {
        awaitText("Before you use AI agents")
        compose.waitUntil(8_000) { !app.authSession.consentBusy }
        heldPath = "/auth/me"
        var saved: Boolean? = null
        lateinit var pending: Job
        compose.runOnIdle {
            pending = CoroutineScope(Dispatchers.Main.immediate).launch {
                saved = app.authSession.updateProfile("Old saved name", "valid_fixture", "")
            }
        }
        assertTrue(heldEntered.await(3, TimeUnit.SECONDS))
        compose.runOnIdle { replaceMemoryIdentity() }
        releaseHeld.countDown()
        compose.waitUntil(8_000) { pending.isCompleted }
        assertEquals(false, saved)
        assertEquals("Replacement user", app.authSession.user?.name)
        assertEquals("replacement-fixture", app.authSession.user?.id)
        assertFalse(app.authSession.aiAllowed)
    }

    @Test fun consentErrorAndUnsupportedVersionKeepAccountAccessAndRejectedPutKeepsHomeBlocked() {
        awaitText("Before you use AI agents")
        compose.waitUntil(8_000) { !app.authSession.consentBusy && app.authSession.consentVersion == AccountApi.AI_CONSENT_VERSION }
        consentReadMode = "error"
        compose.runOnUiThread { app.authSession.loadAIConsent() }
        awaitText("We could not load your AI sharing choice. Retry or manage your account.")
        compose.onNodeWithText("Agree and continue").performScrollTo().assertIsNotEnabled()
        assertEquals("Failed consent read initialized teams", 0, count("GET", "/teams"))
        tap("Not now — manage my account")
        awaitText("Edit profile")
        assertNotNull("Consent error removed authenticated account access", app.authSession.user)
        assertTrue(InstrumentationRegistry.getInstrumentation().uiAutomation.performGlobalAction(
            android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK))
        compose.waitUntil(8_000) { compose.onAllNodesWithText("Edit profile").fetchSemanticsNodes().isEmpty() }
        consentReadMode = "unsupported"
        tap("Retry loading consent")
        awaitText("This privacy notice has changed. Please update Nuphos before using AI.")
        compose.onNodeWithText("Agree and continue").performScrollTo().assertIsNotEnabled()
        assertFalse("Unsupported version granted AI access", app.authSession.aiAllowed)
        consentReadMode = "valid"
        tap("Retry loading consent")
        compose.waitUntil(8_000) { !app.authSession.consentBusy && app.authSession.consentVersion == AccountApi.AI_CONSENT_VERSION }
        compose.onNodeWithText("Agree and continue").performScrollTo().assertIsEnabled()
        rejectConsentWrite = true
        tap("Agree and continue")
        awaitText("Synthetic consent rejection")
        assertFalse("Rejected consent write granted AI access", app.authSession.aiAllowed)
        assertEquals("Rejected consent write initialized teams", 0, count("GET", "/teams"))
        assertEquals("Rejected consent write was retried automatically", 1, count("PUT", "/auth/ai-consent"))
        compose.onNodeWithContentDescription("Profile").assertDoesNotExist()
    }

    @Test fun oldSameAccountConsentReadCannotUndoNewerRevocation() {
        awaitText("Before you use AI agents")
        compose.waitUntil(8_000) { !app.authSession.consentBusy }
        heldPath = "/auth/ai-consent"
        accepted = true
        lateinit var pending: Job
        compose.runOnIdle {
            app.authSession.loadAIConsent()
            val scope = AuthSession::class.java.getDeclaredField("scope").also { it.isAccessible = true }.get(app.authSession) as CoroutineScope
            pending = scope.coroutineContext[Job]!!.children.first { it.isActive }
        }
        assertTrue(heldEntered.await(3, TimeUnit.SECONDS))
        compose.runOnIdle { AiAccess.revokeIfCurrent(requireNotNull(app.authSession.token), AiAccess.revision) }
        releaseHeld.countDown()
        compose.waitUntil(8_000) { pending.isCompleted }
        assertFalse("A stale read reopened access after a newer server revocation", app.authSession.aiAllowed)
        assertEquals(0, count("GET", "/teams"))
        val token = requireNotNull(app.authSession.token)
        var transported = false
        val deniedClient = OkHttpClient.Builder().addInterceptor(ai.nuphos.android.data.ConsentInterceptor()).addInterceptor {
            transported = true
            error("AI transport must remain blocked")
        }.build()
        assertTrue(runCatching { deniedClient.newCall(okhttp3.Request.Builder().url("https://api.nuphos.ai/teams").header("Authorization", "Bearer $token").build()).execute() }.exceptionOrNull() is java.io.IOException)
        assertFalse(transported)
        heldPath = null
        compose.runOnIdle { app.authSession.loadAIConsent() }
        compose.waitUntil(8_000) { !app.authSession.consentBusy && app.authSession.aiAllowed }
    }

    @Test fun activityRecreationKeepsHeldUploadButRevocationReleasesIt() {
        awaitText("Before you use AI agents")
        compose.waitUntil(8_000) { !app.authSession.consentBusy }
        val token = requireNotNull(app.authSession.token)
        accepted = true
        val original = java.io.File(app.cacheDir, "account-lifecycle-original.txt").apply { writeText("synthetic held upload") }
        val owned = original.inputStream().use { ai.nuphos.android.data.OwnedAttachmentFile.copy(app.cacheDir, it, 1024) {} }
        val putEntered = CompletableDeferred<Unit>()
        val releasePut = CompletableDeferred<Unit>()
        val compositionDisposed = CompletableDeferred<Unit>()
        val compositionEntered = CompletableDeferred<Unit>()
        var finalized = 0
        val transport = object : ai.nuphos.android.data.AttachmentTransfers.Transport {
            override suspend fun api(method: String, path: String, token: String, body: ai.nuphos.android.data.JsonValue?): String {
                if (path.endsWith("file-transfers")) return """{"groupId":"0123456789abcdef01234567","direction":"upload","status":"pending","expiresAt":"2099-01-01T00:00:00Z","files":[{"id":"file1","fileName":"held.txt","relPath":"1-held.txt","uploadUrl":"https://storage.example.invalid/signed","expiresAt":"2099-01-01T00:00:00Z"}]}"""
                finalized++
                error("A revoked upload must not finalize")
            }
            override suspend fun put(url: String, mime: String, bytes: ByteArray, pending: ai.nuphos.android.data.AttachmentTransfers.Pending, progress: (Long) -> Unit) { error("Expected retained source") }
            override suspend fun put(url: String, mime: String, source: ai.nuphos.android.data.OwnedAttachmentFile, pending: ai.nuphos.android.data.AttachmentTransfers.Pending, progress: (Long) -> Unit) {
                putEntered.complete(Unit)
                releasePut.await()
            }
        }
        lateinit var agent: ai.nuphos.android.session.AgentStore
        lateinit var session: ai.nuphos.android.session.ChatSession
        try {
            compose.runOnIdle {
                AiAccess.activate(token); AiAccess.grant(token)
                agent = ai.nuphos.android.session.AgentStore(token, app)
                session = ai.nuphos.android.session.ChatSession(token, "fixture-team", transfers = ai.nuphos.android.data.AttachmentTransfers(transport))
                @Suppress("UNCHECKED_CAST")
                val sessions = ai.nuphos.android.session.AgentStore::class.java.getDeclaredField("sessions").also { it.isAccessible = true }.get(agent) as MutableMap<String, ai.nuphos.android.session.ChatSession>
                sessions[session.sessionId] = session
                @Suppress("UNCHECKED_CAST")
                val loaded = ai.nuphos.android.session.ChatSession::class.java.getDeclaredField("loaded\$delegate").also { it.isAccessible = true }.get(session) as MutableState<Boolean>
                loaded.value = true
                assertTrue(session.send(ai.nuphos.android.model.ComposerSubmission("held", listOf(ai.nuphos.android.model.ComposerAttachment(name = "held.txt", kind = ai.nuphos.android.model.ComposerAttachment.Kind.RetainedFile(owned, "text/plain"))))))
                compose.activity.setContent {
                    androidx.compose.runtime.SideEffect { compositionEntered.complete(Unit) }
                    androidx.compose.runtime.DisposableEffect(Unit) { onDispose { compositionDisposed.complete(Unit) } }
                    androidx.compose.runtime.CompositionLocalProvider(ai.nuphos.android.ui.LocalAuthSession provides app.authSession) {
                        ai.nuphos.android.ui.SignedInHost(requireNotNull(app.authSession.user), token) { _, _ -> agent }
                    }
                }
            }
            compose.waitUntil(8_000) { compositionEntered.isCompleted && putEntered.isCompleted }
            compose.activityRule.scenario.recreate()
            compose.waitUntil(8_000) { compositionDisposed.isCompleted }
            assertTrue("Activity recreation removed the authorized upload retry copy", owned.exists)
            assertTrue("Activity recreation cancelled the authorized upload", session.uploadBusy)
            compose.runOnIdle { AiAccess.revoke() }
            compose.waitUntil(8_000) { !session.uploadBusy && !owned.exists }
            releasePut.complete(Unit)
            assertEquals(0, finalized)
            assertEquals("synthetic held upload", original.readText())
        } finally {
            releasePut.complete(Unit)
            if (putEntered.isCompleted) compose.runOnIdle { agent.disposeForConsent() }
            owned.release(); original.delete()
        }
    }

}
