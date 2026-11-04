package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.*
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
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

/** Synthetic chat only: rows arrive with motion, and nobody's place in the transcript ever jumps. Never touches a live API. */
@RunWith(AndroidJUnit4::class)
class ChannelMotionFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val token = "synthetic-chats-motion"
    private val team = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A")
    private lateinit var store: AgentStore
    private lateinit var auth: AuthSession
    private lateinit var tokens: TokenStore
    private lateinit var original: OkHttpClient
    private var savedAccess: Any? = null
    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>
    private val reads = AtomicInteger()
    private val posted = CopyOnWriteArrayList<String>()
    @Volatile private var count = 40
    @Volatile private var echoSends = true
    @Volatile private var turn = false

    private fun post(id: String, who: String, name: String, minute: Int, text: String) =
        """{"id":"$id","role":"user","metadata":{"version":1,"sender":{"type":"user","id":"$who","displayName":"$name"},"sentAt":"2026-11-03T${"%02d".format(9 + minute / 60)}:${"%02d".format(minute % 60)}:00Z"},"parts":[{"type":"text","text":"$text"}]}"""
    private fun detail(): String {
        val rows = (1..count).map { post("p$it", if (it % 2 == 0) "diana" else "clark", if (it % 2 == 0) "Diana Prince" else "Clark Kent", it, "Post $it") } +
            (if (echoSends) posted.mapIndexed { index, text -> post(ids[index], "me", "Bruce Wayne", count + index + 1, text) } else emptyList())
        val total = rows.size
        return """{"kind":"channel","title":"chat-a","transcriptUpdatedAt":"t$total","messageCount":$total,"activitySeq":$total,"messages":[${rows.joinToString(",")}]}"""
    }
    private val ids = CopyOnWriteArrayList<String>()

    @Before fun before() {
        val target = inst.targetContext
        val context = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("chats-motion-fixture", mode)
        }
        val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
        original = field.get(null) as OkHttpClient
        field.set(null, OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val path = request.url.encodedPath
            val body = when {
                path.endsWith("/channel-messages") -> {
                    val raw = okio.Buffer().also { request.body?.writeTo(it) }.readUtf8()
                    ids += Regex("\"id\":\"([^\"]+)\"").find(raw)!!.groupValues[1]
                    posted += Regex("\"text\":\"([^\"]*)\"").find(raw)!!.groupValues[1]
                    """{"ok":true}"""
                }
                path.endsWith("/agent/conversations/chat-a") -> { reads.incrementAndGet(); detail() }
                path.endsWith("/agents") -> """{"agents":[{"sessionId":"agent-ops","title":"Release ops"}]}"""
                path.endsWith("/agent/conversations/agent-ops") -> """{"sessionId":"agent-ops","title":"Release ops","isOwner":true,"messages":[]${if (turn) ""","activeRun":{"streamId":"r"}""" else ""}}"""
                path.endsWith("/agent/conversations") -> """{"conversations":[],"hasMore":false}"""
                path.endsWith("/read") -> """{"activitySeq":1,"readSeq":1,"unread":false}"""
                else -> "{}"
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .body(body.toResponseBody(Http.jsonMedia)).build()
        }.build())
        val app = target.applicationContext as NuphosApplication
        val authContext = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("chats_motion_fixture_$name", mode)
        }
        tokens = TokenStore(authContext)
        inst.runOnMainSync {
            savedAccess = access().value
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
        waitFor("Post $count")
    }
    private fun waitFor(text: String) = compose.waitUntil(12_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
    private fun top(text: String) = compose.onNodeWithText(text).fetchSemanticsNode().boundsInRoot.top
    private fun bottom(text: String) = compose.onNodeWithText(text).fetchSemanticsNode().boundsInRoot.bottom
    private val composerTop get() = compose.onNodeWithContentDescription("Message #chat-a").fetchSemanticsNode().boundsInRoot.top
    private val jump get() = compose.onNodeWithContentDescription("Scroll to latest")
    private fun settle() { Thread.sleep(800); compose.waitForIdle() }
    private fun readOlder() {
        compose.onNodeWithTag("channel-transcript").performScrollToNode(hasText("Post ${count - 20}"))
        settle()
        jump.assertIsDisplayed()
    }
    private fun assertAtTheEnd(newest: String) {
        compose.onNodeWithText(newest).assertIsDisplayed()
        jump.assertDoesNotExist()
        assertTrue("$newest ends above the composer", bottom(newest) <= composerTop)
    }

    @Test fun opensAtTheEndWithNothingMoving() {
        render()
        assertAtTheEnd("Post 40")
        val first = top("Post 40")
        settle()
        assertEquals(first, top("Post 40"), 1f)
    }

    @Test fun aNewPostAtTheEndSlidesTheOthersUpAndSettlesAtTheEnd() {
        render()
        settle()
        val before = top("Post 40")
        count = 41
        waitFor("Post 41")
        settle()
        assertAtTheEnd("Post 41")
        assertTrue("The older post moved up", top("Post 40") < before)
    }

    @Test fun whileReadingOlderPostsANewPostMovesNothing() {
        render()
        readOlder()
        val place = top("Post 20")
        val reads = detailReads()
        count = 41
        compose.waitUntil(12_000) { detailReads() > reads }
        settle()
        assertEquals("The reader's place stays", place, top("Post 20"), 1f)
        jump.assertIsDisplayed()
        compose.onNodeWithText("Post 41").assertDoesNotExist()
    }

    /** iOS stops short here, with the new post under the composer; one press has to reach the end. */
    @Test fun scrollToLatestReachesTheEndInOnePressAfterANewPost() {
        render()
        readOlder()
        val reads = detailReads()
        count = 42
        compose.waitUntil(12_000) { detailReads() > reads }
        settle()
        jump.performClick()
        compose.waitUntil(8_000) { compose.onAllNodesWithText("Post 42").fetchSemanticsNodes().isNotEmpty() }
        settle()
        assertAtTheEnd("Post 42")
    }

    @Test fun scrollToLatestStillReachesTheEndIfAPostArrivesOnTheWay() {
        render()
        readOlder()
        jump.performClick()
        count = 41
        waitFor("Post 41")
        settle()
        assertAtTheEnd("Post 41")
    }

    @Test fun aSentPostAppearsOnceAndStaysPutWhenTheChatReturnsIt() {
        render()
        settle()
        echoSends = false
        val session = store.channelSession("chat-a")!!
        compose.runOnIdle { session.send(ai.nuphos.android.model.ComposerSubmission("Sent while at the end", emptyList()), "me", "Bruce Wayne", null, kotlinx.coroutines.MainScope()) }
        waitFor("Sent while at the end")
        compose.waitUntil(5_000) { posted.size == 1 }
        settle()
        assertAtTheEnd("Sent while at the end")
        val place = top("Sent while at the end")
        echoSends = true
        val reads = detailReads()
        compose.waitUntil(12_000) { detailReads() > reads + 1 }
        settle()
        compose.onAllNodesWithText("Sent while at the end").assertCountEquals(1)
        assertEquals("The chat returning it moves nothing", place, top("Sent while at the end"), 1f)
    }

    @Test fun sendingWhileReadingOlderPostsOrWithDotsShowingReturnsToTheEnd() {
        turn = true
        render()
        compose.waitUntil(10_000) { compose.onAllNodes(hasContentDescription("Release ops is typing")).fetchSemanticsNodes().isNotEmpty() }
        settle()
        val session = store.channelSession("chat-a")!!
        compose.runOnIdle { session.send(ai.nuphos.android.model.ComposerSubmission("With the dots showing", emptyList()), "me", "Bruce Wayne", null, kotlinx.coroutines.MainScope()) }
        waitFor("With the dots showing")
        settle()
        assertAtTheEnd("With the dots showing")
        compose.onAllNodesWithText("With the dots showing").assertCountEquals(1)
        readOlder()
        compose.runOnIdle { session.send(ai.nuphos.android.model.ComposerSubmission("From older posts", emptyList()), "me", "Bruce Wayne", null, kotlinx.coroutines.MainScope()) }
        waitFor("From older posts")
        settle()
        assertAtTheEnd("From older posts")
    }

    @Test fun comingBackAfterPostsArrivedStaysAtTheEnd() {
        render()
        settle()
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        Thread.sleep(600)
        count = 43
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        waitFor("Post 43")
        settle()
        assertAtTheEnd("Post 43")
    }

    private fun frames(until: () -> Boolean) {
        var left = 600
        while (!until() && left-- > 0) { compose.mainClock.advanceTimeByFrame(); Thread.sleep(10) }
        assertTrue("Timed out stepping frames", until())
    }

    /** Posts from while the app was away are simply there: stepping the clock shows no row on its way. */
    @Test fun postsFromWhileAwayAreInPlaceOnReturnWithNoMotion() {
        render()
        settle()
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        Thread.sleep(600)
        val reads = detailReads()
        count = 43
        compose.mainClock.autoAdvance = false
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        frames { detailReads() > reads && compose.onAllNodesWithText("Post 43").fetchSemanticsNodes().isNotEmpty() }
        // A snap settles on the next frame; from then on, nothing is on its way anywhere.
        compose.mainClock.advanceTimeByFrame()
        val arrived = top("Post 43")
        val older = top("Post 40")
        compose.mainClock.advanceTimeBy(48)
        assertEquals("No rise", arrived, top("Post 43"), 1f)
        assertEquals("No glide", older, top("Post 40"), 1f)
        compose.mainClock.advanceTimeBy(1_500)
        compose.mainClock.autoAdvance = true
        compose.waitForIdle()
        assertEquals(arrived, top("Post 43"), 1f)
        assertEquals(older, top("Post 40"), 1f)
        assertAtTheEnd("Post 43")
    }

    @Test fun readingOlderPostsOnReturnNothingMoves() {
        render()
        readOlder()
        val place = top("Post 20")
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        Thread.sleep(600)
        val reads = detailReads()
        count = 42
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        compose.waitUntil(12_000) { detailReads() > reads }
        settle()
        assertEquals("The reader's place stays", place, top("Post 20"), 1f)
        jump.assertIsDisplayed()
        compose.onNodeWithText("Post 42").assertDoesNotExist()
        jump.performClick()
        waitFor("Post 42")
        settle()
        assertAtTheEnd("Post 42")
    }

    /** After the first read on return, posts arrive with motion again. */
    @Test fun aPostAfterComingBackStillGlides() {
        render()
        settle()
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        Thread.sleep(600)
        count = 41
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        waitFor("Post 41")
        settle()
        val before = top("Post 41")
        val session = store.channelSession("chat-a")!!
        count = 42
        compose.mainClock.autoAdvance = false
        kotlinx.coroutines.runBlocking { session.refresh(force = true) }
        compose.mainClock.advanceTimeByFrame()
        compose.mainClock.advanceTimeBy(48)
        val during = top("Post 41")
        compose.mainClock.advanceTimeBy(1_500)
        compose.mainClock.autoAdvance = true
        compose.waitForIdle()
        val after = top("Post 41")
        assertTrue("before=$before during=$during after=$after", after < during && during <= before)
    }

    /** With the clock held, the older row is seen part of the way, so it glides, it doesn't jump. */
    @Test fun rowsGlideRatherThanJump() {
        render()
        settle()
        val before = top("Post 40")
        val session = store.channelSession("chat-a")!!
        count = 41
        compose.mainClock.autoAdvance = false
        kotlinx.coroutines.runBlocking { session.refresh(force = true) }
        compose.mainClock.advanceTimeByFrame()
        compose.mainClock.advanceTimeBy(48)
        val during = top("Post 40")
        compose.mainClock.advanceTimeBy(1_500)
        compose.mainClock.autoAdvance = true
        compose.waitForIdle()
        val after = top("Post 40")
        assertTrue("before=$before during=$during after=$after", after < during && during <= before)
    }

    private fun detailReads() = reads.get()
}
