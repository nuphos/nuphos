package ai.nuphos.android

import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.navigation.compose.rememberNavController
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.nuphos.android.data.*
import ai.nuphos.android.model.*
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.ChatSession
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.chat.ConversationScreen
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.cancel
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.*
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList

/** A Trigger row opens its details, Edit starts a message in the composer, and the switch stays its own control. Blocked HTTP. */
@RunWith(AndroidJUnit4::class)
class ConversationTriggersFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val originals = mutableMapOf<String, OkHttpClient>()
    private val requests = CopyOnWriteArrayList<String>()
    private lateinit var session: ChatSession
    private var savedAccess: Any? = null
    private val fixtureToken = "synthetic-no-credentials"
    @Volatile private var weeklyEnabled = false
    @Suppress("UNCHECKED_CAST") private fun accessState() = AiAccess::class.java.getDeclaredField("state").also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>

    private fun triggers() = """[
        {"id": "digest", "name": "Morning PR digest", "enabled": true, "triggerType": "cron", "cronExpression": "0 9 * * 1-5", "scheduleDescription": "Weekdays at 09:00 UTC", "nextRunAt": "2027-01-04T09:00:00.000Z", "canManage": true, "messageTemplate": "Summarize the pull requests merged since yesterday and post the list here."},
        {"id": "watch", "name": "Production alerts", "enabled": true, "triggerType": "webhook", "scheduleDescription": "When a webhook arrives", "canManage": true},
        {"id": "weekly", "name": "Weekly dependency review", "enabled": $weeklyEnabled, "triggerType": "cron", "cronExpression": "0 10 * * 1", "scheduleDescription": "Mondays at 10:00 UTC", "canManage": true}
    ]"""

    @Before fun blockNetwork() {
        compose.runOnIdle {
            savedAccess = accessState().value
            AiAccess.activate(fixtureToken)
            AiAccess.grant(fixtureToken)
        }
        val mock = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val path = request.url.encodedPath
            requests += request.method + " " + path
            val toggle = request.method == "PATCH" && path == "/agent/triggers/weekly"
            if (toggle) weeklyEnabled = !weeklyEnabled
            val listing = request.method == "GET" && path == "/agent/triggers"
            val body = when {
                listing -> triggers()
                toggle -> "{}"
                else -> "{\"error\":{\"message\":\"Fixture polling unavailable\"}}"
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(if (listing || toggle) 200 else 503)
                .message("fixture").body(body.toResponseBody(Http.jsonMedia)).build()
        }.build()
        for (name in listOf("client", "chatClient")) {
            val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
            originals[name] = field.get(null) as OkHttpClient
            field.set(null, mock)
        }
    }
    @After fun restoreNetwork() {
        compose.runOnIdle {
            compose.activity.setContent { }
            accessState().value = savedAccess
            if (::session.isInitialized) {
                (ChatSession::class.java.getDeclaredField("scope").also { it.isAccessible = true }.get(session) as CoroutineScope).cancel()
            }
        }
        originals.forEach { (name, client) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client) }
    }
    @Suppress("UNCHECKED_CAST")
    private fun state(target: Any, name: String, value: Any?) {
        val field = target.javaClass.getDeclaredField(name + "\$delegate").also { it.isAccessible = true }
        (field.get(target) as MutableState<Any?>).value = value
    }
    private fun render() {
        // Drafts are saved per conversation, so one test's text would otherwise reach the next.
        val shares = (compose.activity.application as NuphosApplication).incomingShares
        kotlinx.coroutines.runBlocking {
            shares.identityReset()
            shares.awaitIdle()
            shares.bindAccount("triggers-fixture")
        }
        val store = AgentStore(fixtureToken, compose.activity)
        session = ChatSession(fixtureToken, "ui-team", "fixture")
        compose.runOnIdle {
            state(store, "selectedTeam", Team("ui-team", "UI fixture"))
            state(session, "loaded", true)
            state(session, "messages", listOf(ChatMessage(id = "ui-assistant", role = ChatMessage.Role.Assistant,
                parts = listOf(ChatPart.Text(text = "Synthetic trigger conversation")))))
            @Suppress("UNCHECKED_CAST")
            val sessions = AgentStore::class.java.getDeclaredField("sessions").also { it.isAccessible = true }.get(store) as MutableMap<Any, ChatSession>
            val keyType = Class.forName("ai.nuphos.android.session.AgentStore\$SessionKey")
            val key = keyType.getDeclaredConstructor(String::class.java, String::class.java).also { it.isAccessible = true }.newInstance("ui-team", "fixture")
            sessions[key] = session
            val app = compose.activity.application as NuphosApplication
            val auth = AuthSession(app, app.tokenStore)
            AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, fixtureToken)
            state(auth, "state", AuthSession.State.SignedIn(NuphosUser("triggers-fixture", "triggers@example.invalid", "Triggers fixture")))
            auth.composerDrafts.onIdentity("triggers-fixture")
            auth.composerDrafts.clear()
            compose.activity.setContent {
                NuphosTheme {
                    CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                        ConversationScreen("fixture", false, {}, rememberNavController())
                    }
                }
            }
        }
        compose.waitUntil(10_000) { shares.isBound("triggers-fixture") }
        compose.onNodeWithContentDescription("Ask Nuphos anything").assertIsEnabled()
    }
    private fun openTriggers() {
        compose.onNodeWithContentDescription("Show task triggers").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("trigger-row-digest").fetchSemanticsNodes().isNotEmpty() }
        compose.waitForIdle() // The rows exist while the sheet is still animating in.
    }
    private fun composerText() = compose.onNodeWithContentDescription("Ask Nuphos anything").fetchSemanticsNode().config
        .getOrNull(SemanticsProperties.EditableText)?.text

    @Test fun switchTogglesWithoutOpeningTheRow() {
        render()
        openTriggers()
        compose.onNodeWithContentDescription("Enable Weekly dependency review").assertIsOff().performClick()
        compose.waitUntil(10_000) { "PATCH /agent/triggers/weekly" in requests }
        compose.waitUntil(10_000) {
            runCatching { compose.onNodeWithContentDescription("Enable Weekly dependency review").assertIsOn() }.isSuccess
        }
        compose.onNodeWithTag("trigger-instruction").assertDoesNotExist()
        compose.onNodeWithTag("trigger-row-digest").assertIsDisplayed()
    }

    @Test fun rowOpensDetailsAndEditStartsAMessage() {
        render()
        openTriggers()
        compose.onNodeWithTag("trigger-row-digest").performClick()
        compose.onNodeWithTag("trigger-instruction").assertIsDisplayed()
            .assertTextEquals("Summarize the pull requests merged since yesterday and post the list here.")
        compose.onNodeWithText("Weekdays at 09:00 UTC").assertIsDisplayed()
        // The switches stay on the list; the details show one Trigger.
        compose.onNodeWithContentDescription("Enable Morning PR digest").assertDoesNotExist()

        compose.onNodeWithTag("trigger-edit").assertIsDisplayed().performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("trigger-edit").fetchSemanticsNodes().isEmpty() }
        compose.waitUntil(10_000) { composerText() == "Edit your trigger “Morning PR digest”: " }
        Assert.assertTrue("Edit sent the message", requests.none { it.startsWith("POST /agent/chat") })
    }

    @Test fun backReturnsFromDetailsToTheList() {
        render()
        openTriggers()
        compose.onNodeWithTag("trigger-row-digest").performClick()
        compose.onNodeWithTag("trigger-instruction").assertIsDisplayed()
        // System back leaves the details, not the sheet.
        androidx.test.espresso.Espresso.pressBack()
        compose.onNodeWithTag("trigger-row-digest").assertIsDisplayed()
        compose.onNodeWithTag("trigger-instruction").assertDoesNotExist()
    }
}
