package ai.nuphos.android

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.tween
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.*
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.notifications.*
import ai.nuphos.android.session.*
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.profile.ConsentScreen
import ai.nuphos.android.ui.theme.NuphosTheme
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Synthetic consent requests only; no sockets, credentials or real notification posting. */
@RunWith(AndroidJUnit4::class)
class NotificationConsentRecoveryDeviceTest {
    private val compose = createComposeRule()
    private lateinit var app: NuphosApplication
    private lateinit var auth: AuthSession
    private val pending = PendingLocalNotification()
    private val target = LocalNotificationTarget("fixture", "team", "chat")
    private val navigated = mutableListOf<LocalNotificationTarget>()
    private val team = mutableStateOf("team")
    private val entered = CountDownLatch(1)
    private val release = CountDownLatch(1)
    @Volatile private var reply = "failure"
    private lateinit var oldClient: OkHttpClient
    private lateinit var oldRevoked: () -> Unit
    private var savedAccess: Any? = null
    @Suppress("UNCHECKED_CAST") private fun state(owner: Any, field: String, delegated: Boolean = true) =
        owner.javaClass.getDeclaredField(field + if (delegated) "\$delegate" else "").also { it.isAccessible = true }.get(owner) as MutableState<Any?>
    private val fixture = object : ExternalResource() {
        override fun before() {
            app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
            assumeTrue("Disposable navigation fixture only", app.packageName == "ai.nuphos.android.navigation1371")
            savedAccess = state(AiAccess, "state", false).value
            oldRevoked = AiAccess.onRevoked
            AiAccess.onRevoked = {} // A transient failure must not clear a tap, as in the application.
            AiAccess.activate("synthetic-consent"); AiAccess.grant("synthetic-consent")
            auth = AuthSession(app, app.tokenStore)
            AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, "synthetic-consent")
            state(auth, "state").value = AuthSession.State.SignedIn(NuphosUser("fixture"))
            auth.onIdentityReset = { pending.clear() }
            oldClient = Http.client
            val client = OkHttpClient.Builder().addInterceptor { chain ->
                val request = chain.request()
                if (request.method == "DELETE" && request.url.encodedPath == "/auth/sessions/current") {
                    return@addInterceptor Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(204).message("fixture").build()
                }
                check(request.method == "GET" && request.url.encodedPath == "/auth/ai-consent")
                if (reply == "failure") { entered.countDown(); check(release.await(10, TimeUnit.SECONDS)); throw IOException("Synthetic offline") }
                val body = when(reply) {
                    "rejected" -> "{\"version\":\"2026-09-28\",\"accepted\":false}"
                    "version" -> "{\"version\":\"future-version\",\"accepted\":true}"
                    else -> "{\"version\":\"2026-09-28\",\"accepted\":true}"
                }
                Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                    .body(body.toResponseBody(Http.jsonMedia)).build()
            }.build()
            Http::class.java.getDeclaredField("client").also { it.isAccessible = true }.set(null, client)
        }
        override fun after() {
            release.countDown()
            Http::class.java.getDeclaredField("client").also { it.isAccessible = true }.set(null, oldClient)
            AiAccess.onRevoked = oldRevoked
            state(AiAccess, "state", false).value = savedAccess
        }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(fixture).around(compose)
    private fun render() {
        compose.mainClock.autoAdvance = false
        compose.setContent { NuphosTheme { CompositionLocalProvider(LocalAuthSession provides auth) {
            AnimatedContent(targetState = when {
                auth.aiAllowed -> "home"
                auth.consentBusy && auth.consentVersion == null -> "restoring"
                else -> "consent"
            }, transitionSpec = {
                fadeIn(tween(1000)) togetherWith fadeOut(tween(1000))
            }, label = "consent-recovery") { stage ->
                if (stage == "home") {
                    NotificationNavigationEffect(pending, auth.user?.id, team.value, auth.aiAllowed) { navigated += it }
                    Text("Fixture home")
                } else if (stage == "restoring") Text("Fixture restoring")
                else auth.user?.let { ConsentScreen(it) } ?: Text("Fixture signed out")
            }
        } } }
        compose.mainClock.advanceTimeByFrame()
    }
    private fun failWhileHomeLeaves() {
        render()
        compose.runOnUiThread { auth.loadAIConsent() }
        assertTrue(entered.await(10, TimeUnit.SECONDS)); release.countDown()
        compose.waitUntil(10_000) { auth.consentError != null }
        compose.runOnUiThread { pending.offer(target) }
        compose.mainClock.advanceTimeByFrame()
        compose.mainClock.advanceTimeBy(100)
        assertTrue(navigated.isEmpty())
        compose.mainClock.autoAdvance = true
    }
    @Test fun networkFailureKeepsTapThroughOutgoingHomeAndRetryRoutesOnce() {
        failWhileHomeLeaves()
        assertEquals(target, pending.value.value)
        compose.mainClock.advanceTimeBy(2000)
        reply = "accepted"
        compose.onNodeWithText("Retry loading consent").performScrollTo().performClick()
        compose.waitUntil(10_000) { auth.aiAllowed }
        compose.mainClock.advanceTimeBy(2000)
        compose.waitUntil(10_000) { navigated.size == 1 }
        assertEquals(listOf(target), navigated)
        assertNull(pending.value.value)
        compose.mainClock.advanceTimeBy(2000)
        assertEquals(1, navigated.size)
    }
    private fun refusedConsentClearsTap(mode: String) {
        failWhileHomeLeaves(); compose.mainClock.advanceTimeBy(2000)
        reply = mode
        compose.onNodeWithText("Retry loading consent").performScrollTo().performClick()
        compose.waitUntil(10_000) { !auth.consentBusy }
        compose.mainClock.advanceTimeBy(2000)
        assertFalse(auth.aiAllowed); assertNull(pending.value.value); assertTrue(navigated.isEmpty())
    }
    @Test fun declinedConsentClearsTapWithoutNavigation() = refusedConsentClearsTap("rejected")
    @Test fun incompatibleConsentVersionClearsTapWithoutNavigation() = refusedConsentClearsTap("version")
    @Test fun workspaceChangeDuringFailureCannotNavigateToPreviousTarget() {
        failWhileHomeLeaves(); compose.mainClock.advanceTimeBy(2000)
        compose.runOnUiThread { team.value = "other-team" }
        reply = "accepted"
        compose.onNodeWithText("Retry loading consent").performScrollTo().performClick()
        compose.waitUntil(10_000) { auth.aiAllowed }
        compose.mainClock.advanceTimeBy(2000)
        assertTrue(navigated.isEmpty()); assertNull(pending.value.value)
    }
    @Test fun accountChangeDuringFailureCannotNavigateToPreviousTarget() {
        failWhileHomeLeaves(); compose.mainClock.advanceTimeBy(2000)
        compose.runOnUiThread { state(auth, "state").value = AuthSession.State.SignedIn(NuphosUser("other")) }
        reply = "accepted"
        compose.onNodeWithText("Retry loading consent").performScrollTo().performClick()
        compose.waitUntil(10_000) { auth.aiAllowed }
        compose.mainClock.advanceTimeBy(2000)
        assertTrue(navigated.isEmpty()); assertNull(pending.value.value)
    }
    @Test fun signOutClearsTapWithoutNavigating() {
        failWhileHomeLeaves(); compose.mainClock.advanceTimeBy(2000)
        compose.runOnUiThread { auth.signOut() }
        compose.mainClock.advanceTimeBy(2000)
        assertTrue(auth.state is AuthSession.State.SignedOut)
        assertNull(pending.value.value); assertTrue(navigated.isEmpty())
    }

}
