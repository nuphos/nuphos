package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import androidx.navigation.compose.rememberNavController
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.model.Team
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.chats.ChatsPage
import ai.nuphos.android.ui.theme.NuphosTheme
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicInteger

/** Synthetic listing only; counts chat listing reads while the page is resumed, stopped and resumed again. */
@RunWith(AndroidJUnit4::class)
class ChatsPollFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val token = "synthetic-chats-poll"
    private val team = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A")
    private val listings = AtomicInteger()
    private lateinit var store: AgentStore
    private lateinit var original: OkHttpClient
    private var savedAccess: Any? = null
    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>

    @Before fun before() {
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        val context = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("chats-poll-fixture", mode)
        }
        val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
        original = field.get(null) as OkHttpClient
        field.set(null, OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            if (ChatsFixture.isListing(request)) listings.incrementAndGet()
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .body("""{"conversations":[],"hasMore":false}""".toResponseBody(Http.jsonMedia)).build()
        }.build())
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            savedAccess = access().value
            AiAccess.activate(token); AiAccess.grant(token)
            store = AgentStore(token, context)
            store.acceptMemberships(listOf(team), team.id)
        }
    }

    @After fun after() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            if (::store.isInitialized) store.disposeForConsent()
            access().value = savedAccess
        }
        Http::class.java.getDeclaredField("client").also { it.isAccessible = true }.set(null, original)
    }

    private fun settle() { Thread.sleep(600); compose.waitForIdle() }

    @Test fun pollingStopsWhileStoppedAndResumesAsOneLoop() {
        compose.setContent {
            NuphosTheme { CompositionLocalProvider(LocalAgentStore provides store) { ChatsPage(rememberNavController()) } }
        }
        // One read per scope (mine and shared) for each tick.
        compose.waitUntil(5_000) { listings.get() >= 2 }
        settle()
        assertEquals(2, listings.get())

        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        val stopped = listings.get()
        compose.mainClock.advanceTimeBy(9_300)
        Thread.sleep(7_000)
        compose.waitForIdle()
        assertEquals("A stopped page must not keep reading", stopped, listings.get())

        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        compose.waitUntil(5_000) { listings.get() >= stopped + 2 }
        settle()
        assertEquals("Resuming restarts exactly one loop", stopped + 2, listings.get())
    }

    @Test fun leavingTheChatsPageStopsPolling() {
        val shown = mutableStateOf(true)
        compose.setContent {
            NuphosTheme { CompositionLocalProvider(LocalAgentStore provides store) {
                // Switching pages or navigating away removes the page from composition.
                if (shown.value) ChatsPage(rememberNavController())
            } }
        }
        compose.waitUntil(5_000) { listings.get() >= 2 }
        settle()
        compose.runOnIdle { shown.value = false }
        compose.waitForIdle()
        val left = listings.get()
        compose.mainClock.advanceTimeBy(9_300)
        Thread.sleep(7_000)
        compose.waitForIdle()
        assertEquals("A page that was left must not keep reading", left, listings.get())
        compose.runOnIdle { shown.value = true }
        compose.waitUntil(5_000) { listings.get() >= left + 2 }
        settle()
        assertEquals("Coming back starts exactly one loop", left + 2, listings.get())
    }

    @Test fun aListHiddenBehindAnOpenChatStopsPolling() {
        val visible = mutableStateOf(true)
        compose.setContent {
            NuphosTheme { CompositionLocalProvider(LocalAgentStore provides store) {
                // A phone keeps the list composed behind the chat it opened.
                ChatsPage(rememberNavController(), active = visible.value)
            } }
        }
        compose.waitUntil(5_000) { listings.get() >= 2 }
        settle()
        compose.runOnIdle { visible.value = false }
        compose.waitForIdle()
        val hidden = listings.get()
        compose.mainClock.advanceTimeBy(9_300)
        Thread.sleep(7_000)
        compose.waitForIdle()
        assertEquals("A hidden list must not keep reading", hidden, listings.get())
        compose.runOnIdle { visible.value = true }
        compose.waitUntil(5_000) { listings.get() >= hidden + 2 }
        settle()
        assertEquals(hidden + 2, listings.get())
    }
}