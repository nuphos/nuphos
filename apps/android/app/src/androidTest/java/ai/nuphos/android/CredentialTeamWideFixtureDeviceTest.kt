package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.CredentialSelection
import ai.nuphos.android.model.Team
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.chat.CredentialPickerSheet
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * What `nuphos_ask` stores leaves GitHub unset, which the server reads as every installation (#4034):
 * the picker as the stored selection reads, and as it reaches. Synthetic transport and accounts only.
 */
@RunWith(AndroidJUnit4::class)
class CredentialTeamWideFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val token = "synthetic-credential-team-wide"
    private val team = Team("bbbbbbbbbbbbbbbbbbbbbbbb", "Fixture B")
    private lateinit var store: AgentStore
    private lateinit var original: OkHttpClient
    private var savedAccess: Any? = null
    private var savedOnRevoked: () -> Unit = {}
    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>

    @Before fun before() {
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        val context: Context = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("credential-team-wide-fixture", mode)
        }
        val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
        original = field.get(null) as OkHttpClient
        field.set(null, OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val text = if (request.url.encodedPath == "/agent/credential-options")
                """{"options":{"awsRoles":[{"roleId":"aws-a","accountAlias":"preview-aws-account"}],"githubInstallations":[{"installationId":"install-a","accountLogin":"preview-org"}]}}"""
                else """{"conversations":[],"hasMore":false}"""
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .body(text.toResponseBody(Http.jsonMedia)).build()
        }.build())
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            savedAccess = access().value
            savedOnRevoked = AiAccess.onRevoked
            AiAccess.onRevoked = {}
            AiAccess.activate(token); AiAccess.grant(token)
            store = AgentStore(token, context)
            store.acceptMemberships(listOf(team), team.id)
        }
    }

    @After fun after() {
        if (!::store.isInitialized) return
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            store.disposeForConsent()
            access().value = savedAccess
            AiAccess.onRevoked = savedOnRevoked
        }
        Http::class.java.getDeclaredField("client").also { it.isAccessible = true }.set(null, original)
    }

    @Test fun anUnsetGitHubKeyShowsEveryInstallationSelected() {
        runBlocking(Dispatchers.Main) { store.loadCredentialOptions() }
        val asked = CredentialSelection(JsonValue.parse("""{"awsRoleIds":["aws-a"]}""")!!)
        val github = store.credentialCatalog!!.allItems.first { it.id == "install-a" }
        val shown = mutableStateOf(asked)
        compose.setContent {
            NuphosTheme { CompositionLocalProvider(LocalAgentStore provides store) {
                CredentialPickerSheet(shown.value, {}, {})
            } }
        }
        compose.onNodeWithText("preview-org").assertIsDisplayed()
        // As the stored selection reads: GitHub unticked, though the agent can use it.
        assertFalse(shown.value.contains(github))
        artifact("credential-team-wide-stored")
        compose.runOnIdle { shown.value = asked.reaching(store.credentialCatalog) }
        compose.onNodeWithText("preview-org").assertIsDisplayed()
        compose.runOnIdle { assertTrue(shown.value.contains(github)) }
        artifact("credential-team-wide-reached")
    }

    /** Saved to the additional test output, which CI uploads with the device test report. */
    private fun artifact(name: String) {
        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.externalMediaDirs.first(), "additional_test_output").apply { mkdirs() }
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(directory, "review-4034-$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
    }
}
