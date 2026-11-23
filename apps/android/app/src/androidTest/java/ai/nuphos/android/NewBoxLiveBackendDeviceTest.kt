package ai.nuphos.android

import android.app.Application
import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.*
import ai.nuphos.android.model.Team
import ai.nuphos.android.session.*
import ai.nuphos.android.ui.*
import ai.nuphos.android.ui.agent.RuntimesPage
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.runBlocking
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Opt-in: real local backend/MongoDB, instabox stubbed only at its HTTP edge. */
@RunWith(AndroidJUnit4::class)
class NewBoxLiveBackendDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    @Test fun createStartingReadyAndResume() {
        assumeTrue(BuildConfig.API_BASE_URL.startsWith("http://127.0.0.1:"))
        val inst = InstrumentationRegistry.getInstrumentation()
        val context = inst.targetContext
        val file = File(context.getExternalFilesDir(null), "new-box-live.json")
        assumeTrue(file.exists())
        val config = JsonValue.parse(file.readText())!!
        val token = config["token"]!!.stringValue!!
        val team = Team(config["teamId"]!!.stringValue!!, "E2E Box", role = "ADMINISTRATOR")
        val stub = config["stubUrl"]!!.stringValue!!
        require(stub.startsWith("http://127.0.0.1:"))
        fun post(url: String, authorized: Boolean = false) {
            val request = Request.Builder().url(url).post("{}".toRequestBody(Http.jsonMedia))
            if (authorized) request.header("Authorization", "Bearer $token")
            Http.client.newCall(request.build()).execute().use { check(it.isSuccessful) { "Local control returned ${it.code}" } }
        }
        fun shot(name: String) {
            compose.waitForIdle()
            File(context.getExternalFilesDir(null), "box-live-$name.png").outputStream().use {
                inst.uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
            }
        }
        val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
        val original = field.get(null) as okhttp3.OkHttpClient
        field.set(null, original.newBuilder().addInterceptor { chain ->
            chain.proceed(chain.request()).also { println("BOX_ANDROID_HTTP ${chain.request().method} ${it.code} ${chain.request().url.encodedPath}") }
        }.build())
        val tokens = TokenStore(context); tokens.write(token)
        val auth = AuthSession(context.applicationContext as Application, tokens)
        lateinit var agents: AgentStore
        inst.runOnMainSync { auth.restore() }
        try {
            compose.waitUntil(20_000) { auth.user != null && auth.aiAllowed }
            inst.runOnMainSync { agents = AgentStore(token, context); check(agents.acceptMemberships(listOf(team), team.id)) }
            compose.setContent { NuphosTheme { CompositionLocalProvider(LocalAgentStore provides agents, LocalAuthSession provides auth) { RuntimesPage() } } }
            compose.waitUntil(30_000) { compose.onAllNodesWithTag("connect-computer").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("connect-computer").performClick()
            compose.waitUntil(30_000) { compose.onAllNodesWithTag("new-box").fetchSemanticsNodes().isNotEmpty() }
            shot("guide")
            compose.onNodeWithTag("new-box").performClick(); shot("name")
            compose.onNodeWithTag("box-name").performTextReplacement("Android local Box")
            androidx.test.espresso.Espresso.closeSoftKeyboard()
            compose.onNodeWithTag("box-create").performScrollTo().assertIsEnabled().performClick()
            compose.waitUntil(30_000) { compose.onAllNodesWithText(context.getString(R.string.box_starting)).fetchSemanticsNodes().isNotEmpty() }
            println("BOX_ANDROID_STARTING"); shot("starting")
            post("$stub/test/ready")
            compose.waitUntil(45_000) { compose.onAllNodesWithText(context.getString(R.string.box_ready)).fetchSemanticsNodes().isNotEmpty() }
            println("BOX_ANDROID_READY"); shot("ready")
            compose.onNodeWithContentDescription(context.getString(R.string.agent_close_runtime_picker)).performClick()
            val device = runBlocking { BoxApi(token, team.id).inventory().devices.single { it.label == "Android local Box" } }
            post("${BuildConfig.API_BASE_URL}/agent/devices/${device.id}/box/pause?teamId=${team.id}", true)
            compose.waitUntil(40_000) { compose.onAllNodesWithText(context.getString(R.string.box_resume)).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText(context.getString(R.string.box_resume)).performScrollTo(); shot("paused")
            println("BOX_ANDROID_PAUSED")
            compose.onNodeWithText(context.getString(R.string.box_resume)).performClick()
            compose.waitUntil(30_000) { compose.onAllNodesWithText(context.getString(R.string.box_resume)).fetchSemanticsNodes().isEmpty() }
            val resumed = runBlocking { BoxApi(token, team.id).inventory().devices.single { it.id == device.id } }
            assertTrue(resumed.online); assertEquals("running", resumed.box?.state)
            println("BOX_ANDROID_RESUMED")
        } finally {
            inst.runOnMainSync { runCatching { agents.disposeForConsent() }; tokens.clear() }
            field.set(null, original)
        }
    }
}
