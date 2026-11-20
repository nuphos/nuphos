package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.InputRequest
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.BotQuestion
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.chats.BotQuestionCard
import ai.nuphos.android.ui.theme.NuphosTheme
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList

/**
 * A secret the agent asked for is typed into a masked field on its own question card, in the Inbox
 * and in a Bot's chat, never behind "Answer in the task". Only the saved file's path reaches the
 * conversation. Synthetic conversation, intercepted network.
 */
@RunWith(AndroidJUnit4::class)
class SecretQuestionFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()

    private val token = "fixture-secret"
    private val requests = CopyOnWriteArrayList<Pair<Request, String>>()
    private val originals = mutableMapOf<String, OkHttpClient>()
    private var savedAccess: Any? = null

    @Suppress("UNCHECKED_CAST") private fun access() =
        AiAccess.javaClass.getDeclaredField("state").also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>

    @Before fun intercept() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            savedAccess = access().value
            AiAccess.activate(token); AiAccess.grant(token)
        }
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val req = chain.request()
            val buffer = okio.Buffer(); req.body?.writeTo(buffer)
            val body = buffer.readUtf8()
            requests += req to body
            var media = Http.jsonMedia
            val path = req.url.encodedPath
            val text = when {
                path == "/agent/conversations/agent-ops" -> Http.json.encodeToString(AgentConversationDetail.serializer(),
                    AgentConversationDetail(title = "Release ops", readOnly = false, isOwner = true))
                path.endsWith("/secrets") -> """{"path":"/home/agent/.secrets/${JsonValue.parse(body)?.get("name")?.stringValue}"}"""
                path == "/agent/chat" -> {
                    media = "text/event-stream".toMediaType()
                    listOf("{\"type\":\"start\",\"messageId\":\"reply\"}", "{\"type\":\"atlas-turn-complete\"}", "{\"type\":\"atlas-stream-done\"}")
                        .joinToString("") { "data: $it\n\n" }
                }
                else -> "{}"
            }
            Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .header("Content-Type", media.toString()).body(text.toResponseBody(media)).build()
        }.build()
        for (name in listOf("client", "chatClient")) {
            val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
            originals[name] = field.get(null) as OkHttpClient; field.set(null, client)
        }
    }

    @After fun restore() {
        originals.forEach { (name, value) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, value) }
        InstrumentationRegistry.getInstrumentation().runOnMainSync { access().value = savedAccess }
    }

    @Test fun aSecretIsTypedIntoItsCardAndOnlyItsPathIsSent() {
        val secret = BotQuestion("agent-ops", "Release ops", InputRequest("q-key", "credential",
            "Paste the Play Console API key", null, secretName = "API_KEY"))
        val value = "sk-fixture-value"
        val inbox = ai.nuphos.android.session.OpenQuestions(object : ai.nuphos.android.session.OpenQuestions.Source {
            override suspend fun pending() = listOf(ai.nuphos.android.model.AgentConversation(
                secret.sessionId, title = secret.title, isOwner = true, inputRequests = listOf(secret.request),
            ))
        })
        kotlinx.coroutines.runBlocking { inbox.refresh() }
        compose.setContent {
            val context = androidx.compose.ui.platform.LocalContext.current
            val store = androidx.compose.runtime.remember { AgentStore(token, context) }
            NuphosTheme { Surface(Modifier.fillMaxSize()) {
                CompositionLocalProvider(LocalAgentStore provides store) {
                    ai.nuphos.android.ui.inbox.InboxPage(inbox, androidx.navigation.compose.rememberNavController(), allowed = { true })
                }
            } }
        }
        compose.onNodeWithText(secret.request.question).performClick()
        fun shows(tag: String) = compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty()
        // Whatever the card settles on is captured first, so a regression is seen as well as reported.
        compose.waitUntil(10_000) { shows("secret-value:q-key") || compose.onAllNodesWithText("Answer in the task").fetchSemanticsNodes().isNotEmpty() }
        capture("secret-card-first")
        compose.onNodeWithText("Answer in the task").assertDoesNotExist()
        compose.onNodeWithTag("secret-value:q-key").assertIsDisplayed()
        compose.onNodeWithTag("secret-value:q-key").performTextInput(value)
        capture("secret-card")
        compose.onNodeWithText("Send securely").performClick()
        compose.waitUntil(10_000) { requests.any { it.first.url.encodedPath == "/agent/chat" } }
        compose.waitUntil(10_000) { compose.onAllNodesWithText("API_KEY saved on the task's runtime.").fetchSemanticsNodes().isNotEmpty() }
        capture("secret-card-saved")

        // The value is in exactly one request, the one that writes it to the runtime's file.
        val saved = requests.single { it.second.contains(value) || it.first.url.toString().contains(value) }
        assertEquals("/agent/conversations/agent-ops/secrets", saved.first.url.encodedPath)
        assertEquals(value, JsonValue.parse(saved.second)?.get("value")?.stringValue)
        assert(requests.any { it.first.url.encodedPath.endsWith("/decisions/q-key/resolve") })
        // The conversation hears its path.
        assert(requests.single { it.first.url.encodedPath == "/agent/chat" }.second.contains("API_KEY saved to /home/agent/.secrets/API_KEY"))
    }

    @Test fun aFormsDetailsAreTypedIntoTheInboxCardOneFilePerField() {
        val form = BotQuestion("agent-ops", "Release ops", Http.json.decodeFromString<InputRequest>(
            """{"id":"q-form","category":"credential","question":"The lookup form needs these details.",
               "secretName":"CLINIC_LOOKUP","site":"www.clinic.example",
               "fields":[{"name":"NATIONAL_ID","label":"ID number"},{"name":"BIRTH_DATE","label":"Date of birth"}]}"""))
        compose.setContent {
            val context = androidx.compose.ui.platform.LocalContext.current
            val store = androidx.compose.runtime.remember { AgentStore(token, context) }
            NuphosTheme { Surface(Modifier.fillMaxSize()) {
                CompositionLocalProvider(LocalAgentStore provides store) {
                    Column(Modifier.fillMaxSize().padding(16.dp)) {
                        BotQuestionCard(form, onOpenConversation = {}, onOpen = {}, onConnect = {}, onAnswer = {}, answersInPlace = true)
                    }
                }
            } }
        }
        compose.waitUntil(10_000) {
            compose.onAllNodesWithTag("secret-value:q-form:NATIONAL_ID").fetchSemanticsNodes().isNotEmpty()
        }
        capture("form-card")
        compose.onNodeWithText("Details needed for www.clinic.example").assertIsDisplayed()
        compose.onNodeWithTag("secret-value:q-form:NATIONAL_ID").performTextInput("E2E-ID-48213")
        compose.onNodeWithTag("secret-value:q-form:BIRTH_DATE").performTextInput("1990-04-12")
        compose.onNodeWithText("Send securely").performClick()
        compose.waitUntil(10_000) { requests.any { it.first.url.encodedPath == "/agent/chat" } }
        capture("form-card-saved")

        // Each value is written to its own file, and only the paths reach the conversation.
        val saved = requests.filter { it.first.url.encodedPath.endsWith("/secrets") }
        assertEquals(listOf("E2E-ID-48213", "1990-04-12"), saved.map { JsonValue.parse(it.second)?.get("value")?.stringValue })
        val reply = requests.single { it.first.url.encodedPath == "/agent/chat" }.second
        assert(reply.contains("NATIONAL_ID: /home/agent/.secrets/NATIONAL_ID") && reply.contains("BIRTH_DATE: /home/agent/.secrets/BIRTH_DATE"))
        assert(!reply.contains("E2E-ID-48213") && !reply.contains("1990-04-12"))
    }

    /** Saved under the app's files, `review-3059/`, for the PR's screenshots. */
    private fun capture(name: String) {
        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.getExternalFilesDir(null), "review-3059").apply { mkdirs() }
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
    }
}
