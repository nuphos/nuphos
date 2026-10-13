package ai.nuphos.android

import android.content.Context
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.ChatMessage
import ai.nuphos.android.model.ChatPart
import ai.nuphos.android.session.AuthSession
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Full installed app navigation. Every shared HTTP call terminates in this interceptor. */
@RunWith(AndroidJUnit4::class)
class TriggerLifecycleFixtureDeviceTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val team = "cccccccccccccccccccccccc"
    private val trigger = "0123456789abcdef01234567"
    private val run = "lifecycle-fixture-run"
    private val answer = "Saved lifecycle fixture answer"
    private data class Read(val method: String, val path: String)
    private val requests = CopyOnWriteArrayList<Read>()
    private val unexpected = CopyOnWriteArrayList<Read>()
    private val originals = mutableMapOf<String, OkHttpClient>()
    @Volatile private var recreating = false
    @Volatile private var outcome = "valid"
    private val teamsEntered = CountDownLatch(1)
    private val releaseTeams = CountDownLatch(1)
    private val teamsReturned = CountDownLatch(1)
    private lateinit var app: NuphosApplication
    private lateinit var originalState: AuthSession.State
    private var originalMemoryToken: String? = null
    private var savedToken: String? = null
    private var preferences: Map<String, *> = emptyMap<String, Any>()

    private val network = object : ExternalResource() {
        override fun before() {
            app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
            savedToken = app.tokenStore.read()
            preferences = app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).all.toMap()
            originalState = app.authSession.state
            originalMemoryToken = app.authSession.token
            val client = OkHttpClient.Builder().addInterceptor { chain ->
                val request = chain.request()
                val path = request.url.encodedPath
                val recorded = Read(request.method, path + (request.url.encodedQuery?.let { "?$it" } ?: ""))
                requests += recorded
                var code = 200
                val body = when {
                    request.method != "GET" -> { unexpected += recorded; code = 599; "{}" }
                    path == "/auth/ai-consent" -> """{"version":"2026-09-28","accepted":true}"""
                    path == "/auth/me" -> """{"id":"lifecycle-fixture-user","name":"Fixture user","avatarURL":""}"""
                    path == "/teams" -> {
                        if (recreating) {
                            teamsEntered.countDown()
                            check(releaseTeams.await(15, TimeUnit.SECONDS)) { "Fixture team response was not released" }
                        }
                        if (recreating && outcome == "denied") { code = 403; "{}" }
                        else {
                            val selected = if (recreating && outcome == "mismatch") "dddddddddddddddddddddddd" else team
                            """{"teams":[{"id":"$selected","name":"Fixture team"}]}"""
                        }
                    }
                    path == "/teams/$team/agent-triggers" -> """[{"id":"$trigger","name":"Lifecycle fixture trigger","triggerType":"cron","enabled":true}]"""
                    path == "/teams/dddddddddddddddddddddddd/agent-triggers" -> "[]"
                    path == "/teams/dddddddddddddddddddddddd/agent-triggers/scheduler-status" -> """{"cronEnabled":true}"""
                    path == "/teams/$team/agent-triggers/scheduler-status" -> """{"cronEnabled":true}"""
                    path == "/agent/conversations" -> if (request.url.queryParameter("triggerId") == trigger)
                        """{"conversations":[{"sessionId":"$run","teamId":"$team","title":"Lifecycle fixture run","messageCount":1}]}""" else """{"conversations":[]}"""
                    path == "/agent/conversations/$run" -> {
                        if (request.url.queryParameter("teamId") != team) unexpected += recorded
                        Http.json.encodeToString(AgentConversationDetail.serializer(), detail())
                    }
                    path == "/agent/plans" -> """{"plans":[]}"""
                    path.endsWith("/members") -> """{"members":[]}"""
                    path == "/agent/plan-approval-policy" -> """{"minimumOtherApprovals":0}"""
                    path == "/agent/credential-options" -> """{"options":[]}"""
                    path.endsWith("/favorites") -> """{"revision":0,"favorites":[]}"""
                    path.endsWith("/connectors") -> """{"connectors":[]}"""
                    else -> { unexpected += recorded; code = 599; "{}" }
                }
                if (recreating && path == "/teams") teamsReturned.countDown()
                Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code)
                    .message("local fixture").body(body.toResponseBody(Http.jsonMedia)).build()
            }.build()
            for (name in listOf("client", "chatClient")) {
                val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
                originals[name] = field.get(null) as OkHttpClient
                field.set(null, client)
            }
            app.tokenStore.write("lifecycle-fixture-token")
            InstrumentationRegistry.getInstrumentation().runOnMainSync { setAuthState(AuthSession.State.Restoring) }
        }

        override fun after() {
            releaseTeams.countDown()
            // The inner Activity rule has already closed the Activity.
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                setAuthState(originalState)
                AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }
                    .set(app.authSession, originalMemoryToken)
            }
            if (savedToken == null) app.tokenStore.clear() else app.tokenStore.write(requireNotNull(savedToken))
            originals.forEach { (name, client) ->
                Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client)
            }
            assertTrue("Installed token changed (values withheld)", savedToken == app.tokenStore.read())
            assertTrue("Installed preferences changed (values withheld)", preferences ==
                app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).all)
            assertTrue("Unexpected local requests: $unexpected", unexpected.isEmpty())
            assertTrue("Browsing made a mutation: $requests", requests.all { it.method == "GET" })
        }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(network).around(compose)

    @Suppress("UNCHECKED_CAST")
    private fun setAuthState(value: AuthSession.State) {
        val field = AuthSession::class.java.getDeclaredField("state\$delegate").also { it.isAccessible = true }
        (field.get(app.authSession) as MutableState<AuthSession.State>).value = value
    }

    private fun detail() = AgentConversationDetail(
        title = "Lifecycle fixture run", readOnly = false, isOwner = true,
        canCancelRun = true, canRespondToRun = true,
        activeRun = AgentConversationDetail.ActiveRun("fixture-active-run"),
        runtimeState = JsonValue.parse("""{"schemaVersion":2,"epoch":"fixture","revision":1,"state":"awaiting-input","actions":{"send":true,"cancel":true,"reply":true,"steer":true}}"""),
        messages = listOf(ChatMessage(id = "fixture-answer", parts = listOf(ChatPart.Text(text = answer)))),
    )

    private fun awaitText(text: String) {
        compose.waitUntil(8_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
    }

    private fun awaitNavigation() {
        compose.waitUntil(8_000) {
            compose.onAllNodesWithContentDescription("Triggers").fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun openRun() {
        awaitNavigation()
        compose.onNodeWithContentDescription("Triggers").performClick()
        awaitText("Lifecycle fixture trigger")
        compose.onNodeWithText("Lifecycle fixture trigger").performScrollTo().performClick()
        compose.onNodeWithText("Existing runs").performScrollTo().performClick()
        awaitText("Lifecycle fixture run")
        compose.onNodeWithText("Lifecycle fixture run").performScrollTo().performClick()
        awaitText(answer)
        assertReadOnly()
    }

    private fun assertReadOnly() {
        compose.onNodeWithText(answer).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Read-only run").assertIsDisplayed()
        compose.onAllNodes(hasSetTextAction()).assertCountEquals(0)
        listOf("Send", "Stop", "Attach", "Ask Nuphos anything", "Queue message", "Chat actions").forEach {
            compose.onNodeWithContentDescription(it).assertDoesNotExist()
        }
        listOf("Approve once", "For session", "Always allow…", "Deny", "Cancel run", "Approve plan", "Reject plan").forEach {
            compose.onNodeWithText(it).assertDoesNotExist()
        }
    }

    private fun detailReads() = requests.count { it.path.startsWith("/agent/conversations/$run?") }

    private fun recreateWithTeams(result: String): Int {
        val reads = detailReads()
        outcome = result
        recreating = true
        compose.activityRule.scenario.recreate()
        compose.waitUntil(8_000) { teamsEntered.count == 0L }
        compose.onNodeWithText(answer).assertDoesNotExist()
        assertEquals("Transcript was requested before team loading completed", reads, detailReads())
        return reads
    }

    @Test fun restoredRunWaitsForTeamsAndBackReturnsToItsHistory() {
        openRun()
        val reads = recreateWithTeams("valid")
        releaseTeams.countDown()
        awaitText(answer)
        assertReadOnly()
        assertTrue("Restored route did not read its transcript", detailReads() > reads)
        compose.onNodeWithContentDescription("Back").performClick()
        awaitText("Existing runs")
        compose.onNodeWithText("Lifecycle fixture trigger").assertIsDisplayed()
        compose.onNodeWithText("Lifecycle fixture run").assertIsDisplayed()
        compose.onNodeWithText("Back to trigger").assertIsDisplayed()
    }

    @Test fun deniedRestoredTeamDoesNotReadTranscript() = deniedRecreation("denied")
    @Test fun mismatchedRestoredTeamDoesNotReadTranscript() = deniedRecreation("mismatch")

    private fun deniedRecreation(result: String) {
        openRun()
        val reads = recreateWithTeams(result)
        releaseTeams.countDown()
        compose.waitUntil(8_000) { teamsReturned.count == 0L }
        awaitNavigation()
        compose.waitForIdle()
        compose.onNodeWithText(answer).assertDoesNotExist()
        assertEquals("Denied or mismatched team read the saved transcript", reads, detailReads())
    }
}
