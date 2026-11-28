package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import androidx.compose.runtime.MutableState
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.CredentialSelection
import ai.nuphos.android.model.Team
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.AiAccess
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Before
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** No Activity, real login, integration mutation, or production preference file. */
@RunWith(AndroidJUnit4::class)
class CredentialDefaultsFixtureDeviceTest {
    private val token = "synthetic-credential-defaults"
    private val a = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A")
    private val b = Team("bbbbbbbbbbbbbbbbbbbbbbbb", "Fixture B")
    private val requests = CopyOnWriteArrayList<Request>()
    private lateinit var context: Context
    private lateinit var store: AgentStore
    private lateinit var original: OkHttpClient
    private var savedAccess: Any? = null
    private var savedOnRevoked: () -> Unit = {}
    @Volatile private var status = 200
    @Volatile private var options = """{"options":{"awsRoles":[{"roleId":"cloud"}],"devices":[{"deviceId":"online","available":true},{"deviceId":"offline","available":false}],"resendIntegrations":[{"integrationId":"mail"}],"githubInstallations":[{"installationId":"github"}]}}"""
    private var entered: CountDownLatch? = null
    private var release: CountDownLatch? = null
    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>

    @Before fun before() {
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        context = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("credential-defaults-fixture", mode)
        }
        context.getSharedPreferences("ignored", 0).edit().clear()
            .putString("nuphos.credentialSelection.${a.id}", """{"ids":{"resendIntegrationIds":["mail"],"awsRoleIds":["old"]}}""").commit()
        val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
        original = field.get(null) as OkHttpClient
        field.set(null, OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request(); requests += request
            val catalog = request.url.encodedPath == "/agent/credential-options"
            val text = if (catalog) options else """{"conversations":[],"hasMore":false}"""
            val code = if (catalog) status else 200
            if (catalog) {
                entered?.countDown()
                check(release?.await(10, TimeUnit.SECONDS) != false)
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("fixture")
                .body(text.toResponseBody(Http.jsonMedia)).build()
        }.build())
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            savedAccess = access().value
            savedOnRevoked = AiAccess.onRevoked
            AiAccess.onRevoked = {}
            AiAccess.activate(token); AiAccess.grant(token)
            store = AgentStore(token, context)
            store.acceptMemberships(listOf(a, b), a.id)
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

    @Test fun defaultsIgnoreOldPreferencesAndOnlyAffectNewSessions() = runBlocking {
        withContext(Dispatchers.Main) {
            assertFalse(store.credentialsReady)
            assertNull(store.newSession())
            val existing = store.session("stored-chat", "Stored")
            val server = CredentialSelection(JsonValue.parse("""{"awsRoleIds":["stored"],"resendIntegrationIds":["mail"],"deviceIds":["offline"]}""")!!)
            existing.credentialAccess = server
            val oldPreference = context.getSharedPreferences("ignored", 0).getString("nuphos.credentialSelection.${a.id}", null)
            store.loadCredentialOptions()
            assertTrue(store.credentialsReady)
            assertEquals(setOf("cloud"), store.credentialSelection.ids["awsRoleIds"])
            assertEquals(setOf("online"), store.credentialSelection.ids["deviceIds"])
            assertEquals(setOf("mail"), store.credentialSelection.ids["resendIntegrationIds"])
            assertEquals(setOf("github"), store.credentialSelection.ids["githubInstallationIds"])
            assertEquals(JsonValue.Bool(true), store.credentialSelection.json["allCredentials"])
            assertEquals(JsonValue.Bool(true), store.credentialSelection.json["allDevices"])
            assertEquals(store.credentialSelection, store.newSession()!!.credentialAccess)
            store.updateCredentialSelection(CredentialSelection())
            store.loadCredentialOptions(force = true)
            assertTrue(store.credentialSelection.isEmpty)
            assertEquals(server, existing.credentialAccess)
            assertEquals(oldPreference, context.getSharedPreferences("ignored", 0).getString("nuphos.credentialSelection.${a.id}", null))
            val catalogs = requests.filter { it.url.encodedPath == "/agent/credential-options" }
            assertEquals(2, catalogs.size)
            assertTrue(catalogs.all { it.method == "GET" && it.url.queryParameter("teamId") == a.id && it.body == null })
            assertTrue(requests.all { it.method == "GET" })
        }
    }

    @Test fun delayedCatalogCannotRestoreSelectionsAfterTeamSwitchAwayAndBack() = runBlocking {
        entered = CountDownLatch(1); release = CountDownLatch(1)
        val request = launch(Dispatchers.Main) { store.loadCredentialOptions() }
        assertTrue(withContext(Dispatchers.IO) { entered!!.await(5, TimeUnit.SECONDS) })
        withContext(Dispatchers.Main) { store.select(b); store.select(a) }
        release!!.countDown(); request.join()
        withContext(Dispatchers.Main) {
            assertNull(store.credentialCatalog)
            assertTrue(store.credentialSelection.isEmpty)
            assertFalse(store.credentialsReady)
            store.loadCredentialOptions()
            assertEquals(setOf("cloud"), store.credentialSelection.ids["awsRoleIds"])
        }
    }

    @Test fun accountReplacementRejectsLateCatalogAndNewSession() = invalidatedCatalog(replaceAccount = true)

    @Test fun consentRevocationRejectsLateCatalogAndNewSession() = invalidatedCatalog(replaceAccount = false)

    private fun invalidatedCatalog(replaceAccount: Boolean) = runBlocking {
        entered = CountDownLatch(1); release = CountDownLatch(1)
        val request = launch(Dispatchers.Main) { store.loadCredentialOptions() }
        assertTrue(withContext(Dispatchers.IO) { entered!!.await(5, TimeUnit.SECONDS) })
        withContext(Dispatchers.Main) {
            if (replaceAccount) { AiAccess.activate("different-account"); AiAccess.grant("different-account") }
            else AiAccess.revoke()
        }
        release!!.countDown(); request.join()
        withContext(Dispatchers.Main) {
            assertFalse(store.credentialsReady)
            assertNull(store.newSession())
            assertNull(store.credentialCatalog)
            store.updateCredentialSelection(CredentialSelection(mapOf("awsRoleIds" to setOf("invalid"))))
            assertTrue(store.credentialSelection.isEmpty)
            AiAccess.revoke()
            store.loadCredentialOptions(force = true)
            assertNull(store.credentialCatalog)
        }
    }

    @Test fun failedThenEmptyCatalogSettlesWithoutRetryAddingNewDefaults() = runBlocking {
        withContext(Dispatchers.Main) {
            status = 500
            store.loadCredentialOptions()
            assertTrue(store.credentialsReady)
            assertNotNull(store.credentialCatalogError)
            assertNull(store.credentialCatalog)
            status = 200; options = """{"options":{}}"""
            store.loadCredentialOptions()
            assertTrue(store.credentialsReady)
            assertNull(store.credentialCatalogError)
            assertTrue(store.credentialCatalog!!.isEmpty)
            options = """{"options":{"awsRoles":[{"roleId":"later"}]}}"""
            store.loadCredentialOptions(force = true)
            assertTrue(store.credentialSelection.isEmpty)
        }
    }
}
