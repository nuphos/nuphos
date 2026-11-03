package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.TokenStore
import ai.nuphos.android.session.AuthSession
import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class EmailSessionFixtureDeviceTest {
    private val inst = InstrumentationRegistry.getInstrumentation()
    private fun scenario(cancel: Boolean) {
        check(inst.targetContext.packageName == "ai.nuphos.android.emailfixture1335")
        val app = inst.targetContext.applicationContext as NuphosApplication
        check(app.tokenStore.read() == null)
        val context = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("email_fixture_$name", mode)
        }
        val store = TokenStore(context)
        val auth = AuthSession(app, store)
        val paths = CopyOnWriteArrayList<String>()
        val started = CountDownLatch(1)
        val release = CountDownLatch(if (cancel) 1 else 0)
        val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
        val previous = field.get(null)
        field.set(null, OkHttpClient.Builder().addInterceptor { chain ->
            val path = chain.request().url.encodedPath
            paths += path
            val body = when (path) {
                "/auth/email/verify-code" -> {
                    assertNull(chain.request().header("Authorization"))
                    started.countDown(); check(release.await(5, TimeUnit.SECONDS))
                    """{"token":"synthetic-session"}"""
                }
                "/auth/me" -> """{"id":"fixture","name":"Fixture","email":"fixture@example.com"}"""
                "/auth/ai-consent" -> """{"version":"2026-09-28","accepted":false}"""
                else -> error("Unexpected synthetic request path")
            }
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                .code(200).message("fixture").body(body.toResponseBody(Http.jsonMedia)).build()
        }.build())
        val scope = AuthSession::class.java.getDeclaredField("scope").also { it.isAccessible = true }.get(auth) as CoroutineScope
        try {
            inst.runOnMainSync {
                auth.signOut()
                auth.emailSignIn("fixture@example.com", "123456")
                auth.emailSignIn("fixture@example.com", "123456")
            }
            assertTrue(started.await(3, TimeUnit.SECONDS))
            val job = AuthSession::class.java.getDeclaredField("loginJob").also { it.isAccessible = true }.get(auth) as Job
            if (cancel) inst.runOnMainSync { auth.cancelCredentialSignIn() }
            release.countDown()
            runBlocking { withTimeout(5_000) { job.join(); scope.coroutineContext[Job]!!.children.toList().forEach { it.join() } } }
            inst.runOnMainSync {
                if (cancel) {
                    assertTrue(auth.state is AuthSession.State.SignedOut)
                    assertNull(store.read()); assertNull(auth.token)
                } else {
                    assertTrue(auth.state is AuthSession.State.SignedIn)
                    assertTrue("Synthetic token persisted", store.read() != null)
                    assertEquals("2026-09-28", auth.consentVersion)
                    assertFalse(auth.aiAllowed)
                }
            }
            assertEquals(if (cancel) listOf("/auth/email/verify-code") else listOf("/auth/email/verify-code", "/auth/me", "/auth/ai-consent"), paths.toList())
        } finally {
            release.countDown()
            runBlocking { scope.coroutineContext[Job]!!.cancelAndJoin() }
            field.set(null, previous)
            inst.runOnMainSync { auth.signOut() }
            store.clear()
            assertNull(app.tokenStore.read())
        }
    }
    @Test fun emailCodeCompletesSessionWithoutAcceptingConsentAndSuppressesDoubleTap() = scenario(false)
    @Test fun cancellationRejectsLateSessionAndNeverPersistsToken() = scenario(true)
}
