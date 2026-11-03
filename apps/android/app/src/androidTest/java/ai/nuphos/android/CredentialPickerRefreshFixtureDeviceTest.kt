package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
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
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Synthetic transport only; no account, connector mutation or production preference file. */
@RunWith(AndroidJUnit4::class)
class CredentialPickerRefreshFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val token = "synthetic-credential-refresh"
    private val team = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A")
    private val requests = CopyOnWriteArrayList<Request>()
    private lateinit var context: Context
    private lateinit var store: AgentStore
    private lateinit var original: OkHttpClient
    private var savedAccess: Any? = null
    private var savedOnRevoked: () -> Unit = {}
    @Volatile private var status = 200
    @Volatile private var installation = "install-a"
    @Volatile private var entered: CountDownLatch? = null
    @Volatile private var release: CountDownLatch? = null
    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>
    private fun catalogReads() = requests.count { it.url.encodedPath == "/agent/credential-options" }
    private fun githubIds() = store.credentialCatalog!!.allItems.filter { it.provider.optionsKey == "githubInstallations" }.map { it.id }

    @Before fun before() {
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        org.junit.Assume.assumeTrue("Requires a separate fixture installation", target.packageName == "ai.nuphos.android.credentialfixture")
        context = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("credential-refresh-fixture", mode)
        }
        val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
        original = field.get(null) as OkHttpClient
        field.set(null, OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request(); requests += request
            val catalog = request.url.encodedPath == "/agent/credential-options"
            if (catalog) { entered?.countDown(); check(release?.await(10, TimeUnit.SECONDS) != false) }
            val text = if (catalog) """{"options":{"githubInstallations":[{"installationId":"$installation","accountLogin":"Northstar"}],"devices":[{"deviceId":"online","label":"Studio Mac","available":true}]}}"""
                else """{"conversations":[],"hasMore":false}"""
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(if (catalog) status else 200).message("fixture")
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
        release?.countDown()
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            store.disposeForConsent()
            access().value = savedAccess
            AiAccess.onRevoked = savedOnRevoked
        }
        Http::class.java.getDeclaredField("client").also { it.isAccessible = true }.set(null, original)
        context.getSharedPreferences("ignored", 0).edit().clear().commit()
    }

    @Test fun reopeningThePickerRefetchesKeepsTheCachedListAndRecoversFromFailure() {
        runBlocking(Dispatchers.Main) { store.loadCredentialOptions() }
        assertEquals(listOf("install-a"), githubIds())
        assertEquals(setOf("install-a"), store.credentialSelection.ids["githubInstallationIds"])
        val open = mutableStateOf(false)
        compose.setContent {
            NuphosTheme { CompositionLocalProvider(LocalAgentStore provides store) {
                if (open.value) CredentialPickerSheet(store.credentialSelection, store::updateCredentialSelection, { open.value = false })
            } }
        }
        // The connector is unbound and rebound elsewhere; hold the refetch to inspect the in-flight state.
        installation = "install-b"
        entered = CountDownLatch(1); release = CountDownLatch(1)
        val before = catalogReads()
        compose.runOnIdle { open.value = true }
        // Advance composition so the sheet opens and starts its refetch.
        compose.waitUntil(5_000) { entered!!.count == 0L }
        compose.onNodeWithTag("credential-label-install-a", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Northstar").assertIsDisplayed()
        compose.onNodeWithText("Loading IAM…").assertDoesNotExist()
        compose.runOnIdle { assertEquals(listOf("install-a"), githubIds()) }
        release!!.countDown()
        compose.waitUntil(5_000) { githubIds() == listOf("install-b") }
        assertEquals(before + 1, catalogReads())
        compose.runOnIdle { assertTrue(store.credentialSelection.ids["githubInstallationIds"]!!.isEmpty()) }
        compose.onNodeWithTag("credential-label-install-b", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("credential-label-install-a", useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithText("Northstar").performClick()
        compose.runOnIdle { assertEquals(setOf("install-b"), store.credentialSelection.ids["githubInstallationIds"]) }

        // A failed refetch keeps the cached list and selection; reopening tries again.
        compose.runOnIdle { open.value = false }
        entered = null; release = null; status = 503
        compose.runOnIdle { open.value = true }
        compose.waitUntil(5_000) { catalogReads() == before + 2 }
        compose.waitUntil(5_000) { store.credentialCatalogError != null }
        compose.onNodeWithTag("credential-label-install-b", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Loading IAM…").assertDoesNotExist()
        compose.runOnIdle {
            assertEquals(listOf("install-b"), githubIds())
            assertEquals(setOf("install-b"), store.credentialSelection.ids["githubInstallationIds"])
        }
        compose.runOnIdle { open.value = false }
        status = 200
        compose.runOnIdle { open.value = true }
        compose.waitUntil(5_000) { catalogReads() == before + 3 && store.credentialCatalogError == null }
        compose.onNodeWithTag("credential-label-install-b", useUnmergedTree = true).assertExists()
        compose.runOnIdle { assertEquals(setOf("install-b"), store.credentialSelection.ids["githubInstallationIds"]) }
        assertTrue(requests.all { it.method == "GET" })
        assertTrue(requests.filter { it.url.encodedPath == "/agent/credential-options" }.all { it.url.queryParameter("teamId") == team.id })
    }
}
