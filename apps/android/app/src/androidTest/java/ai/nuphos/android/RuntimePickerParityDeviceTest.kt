package ai.nuphos.android

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.nuphos.android.data.*
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.session.*
import ai.nuphos.android.ui.chat.ConversationAgentSheet
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.*
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicInteger

@org.junit.FixMethodOrder(org.junit.runners.MethodSorters.NAME_ASCENDING)
@RunWith(AndroidJUnit4::class)
class RuntimePickerParityDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private lateinit var original: OkHttpClient
    private lateinit var fixtureClient: OkHttpClient
    private var oldAccess: Any? = null
    private lateinit var originalConfiguration: android.content.res.Configuration
    private lateinit var session: ChatSession
    private val catalogGate = java.util.concurrent.CountDownLatch(1)
    private val events = java.util.concurrent.CopyOnWriteArrayList<String>()
    private val moves = AtomicInteger()
    private val dismisses = AtomicInteger()
    private val managementOpens = AtomicInteger()
    private var failMove = false
    private var status = 200
    private var body = """{"runtimes":[{"id":"cloud","provider":"codex","label":"Cloud Codex","status":"active","kind":"managed"},{"id":"local","provider":"claude-code","label":"Local Claude","status":"active","kind":"local","local":{"deviceId":"laptop","deviceLabel":"Synthetic Laptop","online":true}},{"id":"boxruntime","provider":"codex","label":"Build helper in Shared Box","status":"active","kind":"local","local":{"deviceId":"box","deviceLabel":"Synthetic Shared Box","agentLabel":"Build helper","online":true}},{"id":"external","provider":"opencode","label":"Synthetic external runtime with a deliberately long descriptive name","status":"active","kind":"external"},{"id":"offline","provider":"codex","label":"Offline","status":"active","kind":"local","local":{"online":false}},{"id":"signin","provider":"codex","label":"Unsigned","status":"active","kind":"managed","local":{"signedIn":false}}]}"""
    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state").also { it.isAccessible=true }.get(AiAccess) as MutableState<Any?>
    @Suppress("UNCHECKED_CAST") private fun set(name: String, value: Any?) {
        (ChatSession::class.java.getDeclaredField(name + "\$delegate").also { it.isAccessible=true }.get(session) as MutableState<Any?>).value=value
    }
    @Before fun setup() {
        originalConfiguration = android.content.res.Configuration(compose.activity.resources.configuration)
        require(compose.activity.packageName == "ai.nuphos.android.agentsaudit1382")
        compose.runOnIdle { oldAccess=access().value; AiAccess.activate("synthetic-picker"); AiAccess.grant("synthetic-picker") }
        val field=Http::class.java.getDeclaredField("client").also { it.isAccessible=true }
        original=field.get(null) as OkHttpClient
        fixtureClient=OkHttpClient.Builder().addInterceptor { chain ->
            val q=chain.request(); events += "intercept:${q.url.encodedPath}"; val catalog=q.url.encodedPath.endsWith("/agent-runtimes"); if(catalog) check(catalogGate.await(20,java.util.concurrent.TimeUnit.SECONDS))
            Response.Builder().request(q).protocol(Protocol.HTTP_1_1).code(if(catalog) status else if(q.url.encodedPath.endsWith("/agent/devices")) 200 else 503).message("fixture")
                .body((if(catalog) body else if(q.url.encodedPath.endsWith("/agent/devices")) """{"devices":[{"deviceId":"laptop","label":"Synthetic Laptop","online":true,"metricsStatus":"live","metrics":{"cpuPercent":24,"memory":{"used":8589934592,"total":17179869184},"disk":{"used":86973087744,"total":107374182400}}},{"deviceId":"box","label":"Synthetic Shared Box","online":true,"box":{"state":"running"},"metricsStatus":"live","metrics":{"cpuPercent":7,"memory":{"used":6442450944,"total":8589934592},"disk":{"used":103079215104,"total":107374182400}}}]}""" else "{}").toResponseBody(Http.jsonMedia)).build()
        }.build()
        field.set(null,fixtureClient)
    }
    @After fun teardown() {
        catalogGate.countDown()
        compose.runOnIdle { compose.activity.setContent {}; compose.activity.resources.updateConfiguration(originalConfiguration, compose.activity.resources.displayMetrics); if(::session.isInitialized) session.disposeForConsent(); access().value=oldAccess }
        Http::class.java.getDeclaredField("client").also { it.isAccessible=true }.set(null,original)
    }
    private fun render(dark: Boolean=false, owner: Boolean=true, current: Boolean=true, immediate: Boolean=false, fontScale: Float=1f) {
        if (immediate) catalogGate.countDown()
        session=ChatSession("synthetic-picker","507f1f77bcf86cd799439011","picker",moveRuntime={ _,_,_,target,_ ->
            moves.incrementAndGet(); delay(200)
            if(failMove) throw java.io.IOException("Synthetic switch failed")
            RuntimeBinding(target.id,target.provider,target.label)
        })
        compose.runOnIdle {
            val configuration = android.content.res.Configuration(originalConfiguration).apply { this.fontScale = fontScale }
            compose.activity.resources.updateConfiguration(configuration, compose.activity.resources.displayMetrics)
            set("loaded",true)
            ChatSession::class.java.getDeclaredMethod("refreshMetadata",AgentConversationDetail::class.java,Double::class.javaPrimitiveType,Long::class.javaPrimitiveType)
                .also { it.isAccessible=true }.invoke(session,AgentConversationDetail(isOwner=owner,canManage=true,readOnly=false,runtimeId="cloud",runtimeLabel="Cloud Codex",agentRuntime="codex"),RuntimeObservation.now(),0L)
            compose.activity.setContent { CompositionLocalProvider(androidx.compose.ui.platform.LocalDensity provides androidx.compose.ui.unit.Density(compose.activity.resources.displayMetrics.density, fontScale)) { NuphosTheme(darkTheme=dark) { ConversationAgentSheet(session,"synthetic-picker",mapOf("cloud" to RuntimeQuota("cloud",true,windows=listOf(RuntimeQuota.Window("5h",14.0))), "local" to RuntimeQuota("local",true,windows=listOf(RuntimeQuota.Window("5h",50.0))), "boxruntime" to RuntimeQuota("boxruntime",true,windows=listOf(RuntimeQuota.Window("5h",25.0)))),{ events += "guard:$current"; current },{dismisses.incrementAndGet()}, loadCatalog={ events += "catalog:start"; AgentRuntimeApi("synthetic-picker","507f1f77bcf86cd799439011",fixtureClient).catalog().also { events += "catalog:done:${it.size}" } }, onManage={managementOpens.incrementAndGet()}) } } }
        }
        if (!immediate) {
            compose.onNodeWithText("Loading runtimes…").assertExists()
            compose.waitForIdle()
            catalogGate.countDown()
        }
        try { compose.waitUntil(10000) { compose.onAllNodesWithText("Cloud Codex").fetchSemanticsNodes().isNotEmpty() || compose.onAllNodesWithText("No available runtimes.").fetchSemanticsNodes().isNotEmpty() || compose.onAllNodesWithText("Runtime request was rejected (503).").fetchSemanticsNodes().isNotEmpty() } }
        catch (e: Throwable) { throw AssertionError("Events: $events Threads: " + Thread.getAllStackTraces().filter { it.key.name.contains("DefaultDispatcher") }.map { it.key.name to it.value.take(12).toString() } + " Picker initial state: " + compose.onNodeWithTag("conversation-runtime-sheet").printToString(), e) }
        val layouts = mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
        compose.onNodeWithText("Choose runtime").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult) { it(layouts) }
        Assert.assertEquals("Actual dialog font scale", fontScale, layouts.single().layoutInput.density.fontScale, 0.01f)
        val image=compose.onNodeWithTag("conversation-runtime-sheet").captureToImage().asAndroidBitmap()
        java.io.File(compose.activity.getExternalFilesDir(null),"runtime-picker-status$status-${if(owner) "owner" else "member"}-${if(dark) "dark" else "light"}.png").outputStream().use { image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) }
    }
    private fun local() {
        compose.onNodeWithText("Synthetic Laptop").performScrollTo().performClick()
        compose.onNodeWithContentDescription("Use Local Claude").performScrollTo().performClick()
    }
    @Test fun aImmediatelyReturnedCatalogLeavesLoading() {
        render(immediate=true)
        compose.onNodeWithText("Loading runtimes…").assertDoesNotExist()
        compose.onNodeWithContentDescription("Selected Cloud Codex").assertExists()
    }
    private fun capture(name: String) {
        compose.mainClock.advanceTimeBy(600)
        compose.waitForIdle()
        val bitmap=compose.onNodeWithTag("conversation-runtime-sheet").captureToImage().asAndroidBitmap()
        java.io.File(compose.activity.getExternalFilesDir(null),name).outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) }
    }
    @Test fun lightGroupsMetricsAndManagementRemainReachable() {
        render()
        compose.onNodeWithText("Synthetic Shared Box").performScrollTo().assertExists()
        compose.onNodeWithText("Synthetic Laptop").performScrollTo().performClick()
        compose.onNodeWithText("Claude Code").assertExists()
        capture("runtime-matrix-light.png")
        compose.onNodeWithText("Manage computers and runtimes").performScrollTo().assertIsDisplayed()
        compose.runOnIdle { Assert.assertEquals(0,moves.get()) }
    }
    @Test fun darkGroupsMetricsAndLargeTextKeepCloseAndFooterReachable() {
        render(dark=true,fontScale=2f)
        compose.onNodeWithText("Synthetic Shared Box").performScrollTo().performClick()
        compose.onNodeWithText("Build helper").performScrollTo().assertExists()
        compose.onNodeWithContentDescription("Close runtime picker").assertIsDisplayed()
        capture("runtime-matrix-dark-large.png")
        compose.onNodeWithText("Manage computers and runtimes").performScrollTo().assertIsDisplayed()
        compose.runOnIdle { Assert.assertEquals(0,moves.get()) }
    }
    @Test fun lightLargeTextShowsContinuousBarsAndReachableFooter() {
        render(fontScale=2f)
        compose.onNodeWithText("Synthetic Laptop").performScrollTo().performClick()
        compose.onNodeWithText("Claude Code").performScrollTo().assertExists()
        capture("runtime-matrix-light-large.png")
        compose.onNodeWithText("Manage computers and runtimes").performScrollTo().assertIsDisplayed()
        compose.onNodeWithContentDescription("Close runtime picker").assertIsDisplayed()
    }
    @Test fun managementEntryDoesNotMoveOrSelect() {
        render()
        compose.onNodeWithText("Manage computers and runtimes").performScrollTo().performClick()
        compose.runOnIdle { Assert.assertEquals(1,managementOpens.get()); Assert.assertEquals(0,moves.get()); Assert.assertEquals(0,dismisses.get()) }
    }
    @Test fun ownerDarkUsesTheSameCatalogAsLight() {
        render(dark=true)
        compose.onNodeWithText("Synthetic Laptop").assertExists()
        compose.onNodeWithContentDescription("Selected Cloud Codex").assertExists()
    }
    @Test fun currentAndCloseNeverMove() {
        render()
        compose.onNodeWithContentDescription("Selected Cloud Codex").performClick()
        compose.runOnIdle { Assert.assertEquals(1,dismisses.get()); Assert.assertEquals(0,moves.get()) }
    }
    @Test fun localCancelThenConfirmMovesExactlyOnceAndUpdatesMetadata() {
        render(); local()
        compose.onNodeWithText("Cancel").performClick()
        compose.runOnIdle { Assert.assertEquals(0,moves.get()) }
        compose.onNodeWithContentDescription("Use Local Claude").performClick()
        compose.onNodeWithText("Move",useUnmergedTree=true).performClick()
        compose.waitUntil(10000) { moves.get()==1 && !session.movingAgent }
        compose.runOnIdle { Assert.assertEquals(1,moves.get()); Assert.assertEquals("local",session.runtimeId); Assert.assertEquals("Local Claude",session.runtimeDeviceLabel); Assert.assertEquals("claude-code",session.agentRuntime) }
    }
    @Test fun failedMoveKeepsCurrentAndShowsError() {
        failMove=true; render(); local(); compose.onNodeWithText("Move",useUnmergedTree=true).performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithText("Synthetic switch failed").fetchSemanticsNodes().isNotEmpty() }
        compose.runOnIdle { Assert.assertEquals(1,moves.get()); Assert.assertEquals("cloud",session.runtimeId); Assert.assertEquals(0,dismisses.get()) }
    }
    @Test fun nonOwnerCannotChooseLocalAndDarkPickerClosesWithoutMove() {
        render(dark=true,owner=false)
        compose.onNodeWithText("Synthetic Laptop").assertDoesNotExist()
        compose.onNodeWithText("Offline").assertDoesNotExist()
        compose.onNodeWithText("Unsigned").assertDoesNotExist()
        compose.onNodeWithContentDescription("Close runtime picker").performClick()
        compose.runOnIdle { Assert.assertEquals(0,moves.get()); Assert.assertEquals(1,dismisses.get()) }
    }
    @Test fun errorAndRetryToEmptyDoNotMove() {
        status=503;render()
        status=200;body="""{"runtimes":[]}"""
        compose.onNodeWithText("Refresh runtimes").performScrollTo().performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithText("No available runtimes.").fetchSemanticsNodes().isNotEmpty() }
        compose.runOnIdle { Assert.assertEquals(0,moves.get()) }
    }
}
