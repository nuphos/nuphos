package ai.nuphos.android

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import androidx.browser.customtabs.CustomTabsIntent
import android.net.Uri
import androidx.compose.runtime.MutableState
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.TokenStore
import ai.nuphos.android.data.NativeLogin
import kotlinx.serialization.json.*
import okio.Buffer
import java.util.concurrent.Executors
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.session.AuthSession
import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class AuthCallbackFixtureDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val app get() = instrumentation.targetContext.applicationContext as NuphosApplication

    private fun withSession(test: (AuthSession, TokenStore) -> Unit) {
        val installedToken = app.tokenStore.read()
        val context = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("auth_callback_fixture_$name", mode)
        }
        val store = TokenStore(context)
        val auth = AuthSession(app, store)
        try { test(auth, store) } finally {
            (AuthSession::class.java.getDeclaredField("scope").also { it.isAccessible = true }.get(auth) as CoroutineScope).cancel()
            store.clear()
            assertTrue("Installed session changed (values withheld)", installedToken == app.tokenStore.read())
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun setState(auth: AuthSession, state: AuthSession.State) {
        val field = AuthSession::class.java.getDeclaredField("state\$delegate").also { it.isAccessible = true }
        (field.get(auth) as MutableState<AuthSession.State>).value = state
    }

    @Test fun externalTokenAndErrorIntentsCannotChangeAnyIdentityState() = withSession { auth, store ->
        val user = Http.json.decodeFromString<NuphosUser>("""{"id":"fixture-user","email":"fixture@example.com","name":"Fixture"}""")
        instrumentation.runOnMainSync {
            for (state in listOf(AuthSession.State.Restoring, AuthSession.State.SignedOut(null), AuthSession.State.SigningIn, AuthSession.State.SignedIn(user))) {
                setState(auth, state)
                val generation = auth.generation
                for (target in listOf("nuphos://google-callback?token=attacker-token", "nuphos://google-callback?error=denied", "nuphos://google-callback?token=%ZZ", "nuphos://google-callback?token=first&token=second")) {
                    assertTrue(auth.handleCallback(Uri.parse(target)))
                    assertSame(state, auth.state)
                    assertEquals(generation, auth.generation)
                    assertNull(auth.token)
                    assertNull(store.read())
                }
            }
            val generation = auth.generation
            setState(auth, AuthSession.State.SigningIn)
            auth.restore()
            assertEquals(generation, auth.generation)
        }
    }

    @Test fun signOutDuringRegistrationRejectsLateResultWithoutOpeningBrowserOrPersistingToken() = withSession { auth, store ->
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
        val original = field.get(null) as OkHttpClient
        val requests = java.util.concurrent.CopyOnWriteArrayList<String>()
        field.set(null, OkHttpClient.Builder().addInterceptor { chain ->
            requests += chain.request().url.encodedPath
            started.countDown()
            check(release.await(5, TimeUnit.SECONDS))
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                .code(201).message("fixture").body("""{"handle":"${"h".repeat(43)}","expiresInSec":600}""".toResponseBody(Http.jsonMedia)).build()
        }.build())
        try {
            instrumentation.runOnMainSync {
                setState(auth, AuthSession.State.SignedOut(null))
                auth.signIn(Activity())
            }
            assertTrue(started.await(3, TimeUnit.SECONDS))
            val job = AuthSession::class.java.getDeclaredField("loginJob").also { it.isAccessible = true }.get(auth) as Job
            instrumentation.runOnMainSync { auth.signOut() }
            release.countDown()
            runBlocking { withTimeout(3_000) { job.join() } }
            instrumentation.runOnMainSync {
                assertEquals(AuthSession.State.SignedOut(null), auth.state)
                assertNull(auth.token)
                assertNull(store.read())
                assertTrue(auth.handleCallback(Uri.parse("nuphos://google-callback?token=late-token")))
                assertEquals(AuthSession.State.SignedOut(null), auth.state)
            }
            assertEquals(listOf("/auth/native/session"), requests)
        } finally { release.countDown(); field.set(null, original) }
    }
    @Test fun chromeDeliversBoundLoopbackCodeWithoutSessionTokenInBrowser() {
        var registration: JsonObject? = null
        val paths = java.util.concurrent.CopyOnWriteArrayList<String>()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            paths += request.url.encodedPath
            val body = Http.json.parseToJsonElement(Buffer().also { request.body!!.writeTo(it) }.readUtf8()).jsonObject
            val reply = if (request.url.encodedPath.endsWith("/redeem")) {
                assertEquals("c".repeat(43), body["code"]!!.jsonPrimitive.content)
                """{"token":"synthetic-native-session"}"""
            } else {
                registration = body
                """{"handle":"${"h".repeat(43)}","expiresInSec":600}"""
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
                .code(200).message("fixture").body(reply.toResponseBody(Http.jsonMedia)).build()
        }.build()
        NativeLogin(client).use { login ->
            login.register()
            val executor = Executors.newSingleThreadExecutor()
            try {
                val result = executor.submit<String> { login.awaitToken() }
                val registered = requireNotNull(registration)
                val callback = registered["redirectUri"]!!.jsonPrimitive.content +
                    "?state=${registered["clientState"]!!.jsonPrimitive.content}&code=${"c".repeat(43)}"
                instrumentation.runOnMainSync {
                    val tabs = CustomTabsIntent.Builder().build()
                    tabs.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    tabs.launchUrl(app, Uri.parse(callback))
                }
                assertEquals("synthetic-native-session", result.get(10, TimeUnit.SECONDS))
                assertTrue(login.receivedCallback)
                assertEquals(listOf("/auth/native/session", "/auth/native/session/redeem"), paths)
            } finally { executor.shutdownNow() }
        }
    }

}
