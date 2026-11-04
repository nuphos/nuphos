package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.TokenStore
import ai.nuphos.android.model.Team
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.chats.ChannelScreen
import ai.nuphos.android.ui.chats.hasUnreadPosts
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

/** Synthetic chat only: an open chat is read up to its newest activity, in the foreground. Never touches a live API. */
@RunWith(AndroidJUnit4::class)
class ChannelReadFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val token = "synthetic-chats-read"
    private val team = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A")
    private val marks = CopyOnWriteArrayList<Long>()
    private val requests = AtomicInteger()
    private val fullReads = AtomicInteger()
    @Volatile private var activity = 3
    @Volatile private var messages = 1
    @Volatile private var failMarks = false
    private lateinit var store: AgentStore
    private lateinit var auth: AuthSession
    private lateinit var tokens: TokenStore
    private lateinit var original: OkHttpClient
    private var savedAccess: Any? = null
    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>

    private fun detail(): String {
        val posts = (1..messages).joinToString(",") {
            """{"id":"p$it","role":"user","metadata":{"version":1,"sender":{"type":"user","id":"diana","displayName":"Diana Prince"},"sentAt":"2026-11-03T09:0$it:00Z"},"parts":[{"type":"text","text":"Post $it"}]}"""
        }
        return """{"kind":"channel","title":"chat-a","transcriptUpdatedAt":"t$messages","messageCount":$messages,"activitySeq":$activity,"readSeq":1,"messages":[$posts]}"""
    }
    /** The listing keeps answering from before any marker: a chat's dot stays gone anyway. */
    private fun listing(scope: String?) = if (scope == "mine")
        """{"conversations":[{"sessionId":"chat-a","teamId":"${team.id}","kind":"channel","title":"chat-a","lastActiveAt":"2026-11-03T09:00:00Z","activitySeq":$activity,"readSeq":1,"isOwner":true}],"hasMore":false}"""
    else """{"conversations":[],"hasMore":false}"""

    @Before fun before() {
        val target = inst.targetContext
        val context = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("chats-read-fixture", mode)
        }
        val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
        original = field.get(null) as OkHttpClient
        field.set(null, OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val path = request.url.encodedPath
            var code = 200
            val body = when {
                path.endsWith("/agent/conversations/chat-a/read") -> {
                    requests.incrementAndGet()
                    val raw = Buffer().also { request.body?.writeTo(it) }.readUtf8()
                    val seq = Regex("\"seq\":(\\d+)").find(raw)!!.groupValues[1].toLong()
                    marks += seq
                    if (failMarks) { code = 500; """{"error":{"message":"Synthetic"}}""" }
                    else """{"activitySeq":$activity,"readSeq":$seq,"unread":${activity > seq}}"""
                }
                path.endsWith("/agent/conversations/chat-a") -> {
                    requests.incrementAndGet()
                    if (request.url.queryParameter("tail") != "1") fullReads.incrementAndGet()
                    detail()
                }
                path.endsWith("/agents") -> { requests.incrementAndGet(); """{"agents":[]}""" }
                path.endsWith("/agent/conversations") -> listing(request.url.queryParameter("scope"))
                else -> "{}"
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("fixture")
                .body(body.toResponseBody(Http.jsonMedia)).build()
        }.build())
        val app = target.applicationContext as NuphosApplication
        val authContext = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("chats_read_fixture_$name", mode)
        }
        tokens = TokenStore(authContext)
        inst.runOnMainSync {
            savedAccess = access().value
            // Signed out first: signing out revokes AI access, which the chat then needs.
            auth = AuthSession(app, tokens); auth.signOut()
            AiAccess.activate(token); AiAccess.grant(token)
            store = AgentStore(token, context)
            store.acceptMemberships(listOf(team), team.id)
        }
    }

    @After fun after() {
        inst.runOnMainSync {
            if (::store.isInitialized) store.disposeForConsent()
            if (::auth.isInitialized) auth.signOut()
            access().value = savedAccess
        }
        if (::tokens.isInitialized) tokens.clear()
        Http::class.java.getDeclaredField("client").also { it.isAccessible = true }.set(null, original)
    }

    private fun render() {
        compose.setContent {
            NuphosTheme {
                CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    ChannelScreen("chat-a", onBack = { fail("The chat closed itself") })
                }
            }
        }
    }
    private fun waitForMark(seq: Long) = compose.waitUntil(12_000) { seq in marks }

    @Test fun activityThatLandsAfterThePostIsMarkedByTheProbe() {
        render()
        waitForMark(3)
        // Read between the server's two writes: the post, not yet its activity.
        messages = 2
        compose.waitUntil(12_000) { fullReads.get() >= 2 }
        val reads = fullReads.get()
        assertEquals(listOf(3L), marks.toList())
        activity = 4
        waitForMark(4)
        assertEquals("Marked from the probe, without reading the chat again", reads, fullReads.get())
    }

    @Test fun aFailedMarkerRetriesWithThePollAndStopsOnceItLands() {
        failMarks = true
        render()
        compose.waitUntil(12_000) { marks.size >= 2 }
        assertTrue(marks.all { it == 3L })
        failMarks = false
        compose.waitUntil(12_000) { store.channel("chat-a") == null || marks.size >= 3 }
        Thread.sleep(5_000); compose.waitForIdle()
        val settled = marks.size
        Thread.sleep(5_000); compose.waitForIdle()
        assertEquals("A marker that landed is not sent again", settled, marks.size)
    }

    @Test fun aChatsRowIsReadAtOnceEvenIfAListingStillSaysUnread() {
        runBlocking { store.loadChannels() }
        compose.waitUntil(5_000) { store.channel("chat-a") != null }
        assertTrue(store.channel("chat-a")!!.hasUnreadPosts())
        render()
        waitForMark(3)
        compose.waitUntil(5_000) { !store.channel("chat-a")!!.hasUnreadPosts() }
        runBlocking { store.loadChannels() }
        compose.waitForIdle()
        assertFalse("The listing is behind this device's marker", store.channel("chat-a")!!.hasUnreadPosts())
    }

    @Test fun inTheBackgroundNothingIsReadAndComingBackMarksWhatArrived() {
        render()
        waitForMark(3)
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        Thread.sleep(600)
        val stopped = requests.get()
        messages = 2; activity = 4
        Thread.sleep(6_000)
        assertEquals("No polls and no markers while stopped", stopped, requests.get())
        assertFalse(4L in marks)
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        waitForMark(4)
    }
}
