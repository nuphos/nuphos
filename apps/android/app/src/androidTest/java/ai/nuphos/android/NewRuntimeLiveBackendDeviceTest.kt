package ai.nuphos.android

import android.app.Application
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.activity.ComponentActivity
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.*
import ai.nuphos.android.model.Team
import ai.nuphos.android.session.*
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.agent.RuntimesPage
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Opt-in local stack scenario. The config file contains only a synthetic local account. */
@RunWith(AndroidJUnit4::class)
class NewRuntimeLiveBackendDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    @Test fun createOnConnectedComputerThenCancel() {
        assumeTrue(BuildConfig.API_BASE_URL.startsWith("http://127.0.0.1:"))
        val inst = InstrumentationRegistry.getInstrumentation()
        val context = inst.targetContext
        val file = File(context.getExternalFilesDir(null), "new-runtime-live.json")
        assumeTrue(file.exists())
        val config = JsonValue.parse(file.readText())!!
        val token = config["token"]!!.stringValue!!
        val device = config["deviceId"]!!.stringValue!!
        val team = Team(config["teamId"]!!.stringValue!!, "E2E")
        val label = "Android integration runtime"
        val ack = File(context.getExternalFilesDir(null), "new-runtime-desktop-ack")
        ack.delete()
        val tokens = TokenStore(context)
        tokens.write(token)
        val auth = AuthSession(context.applicationContext as Application, tokens)
        lateinit var agents: AgentStore
        inst.runOnMainSync {
            auth.restore()
            agents = AgentStore(token, context)
            agents.acceptMemberships(listOf(team), team.id)
        }
        try {
            compose.waitUntil(20_000) { auth.user != null && auth.aiAllowed }
            compose.setContent { NuphosTheme { CompositionLocalProvider(LocalAgentStore provides agents, LocalAuthSession provides auth) { RuntimesPage() } } }
            compose.waitUntil(30_000) { compose.onAllNodesWithTag("runtime-inventory").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("runtime-inventory").performScrollToNode(hasTestTag("new-runtime-$device"))
            compose.onNodeWithTag("new-runtime-$device").performClick()
            compose.onNodeWithTag("new-runtime-provider-codex").performClick()
            compose.onNodeWithTag("new-runtime-name").performTextReplacement(label)
            compose.onNodeWithTag("new-runtime-continue").performClick()
            compose.waitUntil(30_000) { compose.onAllNodesWithText(label).fetchSemanticsNodes().isNotEmpty() }
            println("LIVE_ANDROID_RUNTIME_CREATED")
            compose.waitUntil(120_000) { ack.exists() }
            compose.onNodeWithText(context.getString(R.string.agent_close)).performClick()
            compose.waitUntil(30_000) { compose.onAllNodesWithTag("new-runtime-$device").fetchSemanticsNodes().isNotEmpty() }
            println("LIVE_ANDROID_RUNTIME_CANCELLED")
        } finally {
            inst.runOnMainSync { agents.disposeForConsent(); auth.signOut(); tokens.clear() }
        }
    }
}
