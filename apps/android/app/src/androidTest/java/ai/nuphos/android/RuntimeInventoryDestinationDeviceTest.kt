package ai.nuphos.android
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.nuphos.android.data.*
import ai.nuphos.android.session.*
import ai.nuphos.android.ui.agent.*
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.CompletableDeferred
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
@RunWith(AndroidJUnit4::class)
class RuntimeInventoryDestinationDeviceTest {
    @get:Rule val compose=createComposeRule()
    private val cloud=AgentRuntime("cloud","codex","Synthetic current","active","managed")
    private val box=AgentRuntime("box","opencode","Synthetic Box runtime","active","local",local=RuntimeHost("host","Synthetic Box",true))
    private var creates=0;private var starts=0;private var answers=0;private var cancels=0;private var closes=0
    private var createdProvider=""
    private var lastStart="";private var lastAnswerRuntime="";private var lastAnswer="";private var lastAttempt=""
    private var step=RuntimeLoginStep("choose",message="Choose a method",options=listOf(RuntimeLoginOption("fixture","Synthetic method")))
    private lateinit var store:RuntimeSetupStore
    private lateinit var selection:RuntimeSelections.Selection
    private val api=object:RuntimeTransport {
        override suspend fun catalog()=listOf(cloud,box,cloud.copy(id="created",provider=createdProvider.ifBlank{"opencode"}))
        override suspend fun create(provider:String,label:String?):AgentRuntime {creates++;createdProvider=provider;return cloud.copy(id="created",provider=provider)}
        override suspend fun start(runtimeId:String):RuntimeLogin {starts++;lastStart=runtimeId;return login()}
        override suspend fun login(runtimeId:String)=login()
        private fun login()=RuntimeLogin("00000000-0000-4000-8000-000000000001","awaiting_authorization",4102444800000L,step=step)
        override suspend fun code(runtimeId:String,attemptId:String,code:String):RuntimeLogin {answers++;lastAnswerRuntime=runtimeId;lastAttempt=attemptId;lastAnswer=code;return login().copy(codeSubmitted=true)}
        override suspend fun cancel(runtimeId:String,attemptId:String){cancels++}
    }
    private fun render(boxSignIn:Boolean=false,pickerMode:Boolean=false) {
        check(InstrumentationRegistry.getInstrumentation().targetContext.packageName.endsWith(".agentsaudit1382"))
        compose.setContent {
            val scope=rememberCoroutineScope()
            selection=remember {RuntimeSelections().bind("fixture-account","fixture-team").apply {saveCatalog(listOf(cloud,box));select(cloud.id)}}
            store=remember {RuntimeSetupStore(api,scope,{true},{!boxSignIn},selection,{},now={0},loginAllowed={if(boxSignIn)it.id==box.id else it.kind=="managed"},selectCreatedRuntime=pickerMode)}
            RuntimeFixtureTheme {
                RuntimeSetupSheet(store,{closes++},initialManaging=!pickerMode,initialSignInRuntimeId=if(boxSignIn)box.id else null,newRuntimeOnly=!boxSignIn && !pickerMode,inventoryMode=!pickerMode)
            }
        }
        compose.waitUntil(5000) {store.state.catalogLoaded}
        compose.runOnIdle { blockRuntimeFixtureAutofillWindows() }
    }
    @Test fun addOffersFiveProvidersAndCreatesOnceWithoutChangingCurrentSelection() {
        render()
        compose.onNodeWithText("Change runtime").assertDoesNotExist()
        listOf("Claude Code","Codex","Grok Build","Antigravity","OpenCode").forEach {compose.onAllNodesWithText(it).onFirst().performScrollTo().assertIsDisplayed()}
        compose.onAllNodesWithText("OpenCode").onFirst().performScrollTo().performClick()
        compose.onNodeWithText("Create runtime").performScrollTo().performClick()
        compose.waitUntil(5000) {creates==1 && store.signInRuntime?.id=="created"}
        assertEquals("opencode",createdProvider);assertEquals(cloud.id,selection.selectedId);assertEquals(0,starts)
        compose.onNodeWithText("Start provider sign-in").performScrollTo().performClick()
        compose.onNodeWithText("Synthetic method").performScrollTo().performClick()
        compose.waitUntil(5000) {answers==1}
        assertEquals(1,starts);assertEquals("created",lastStart);assertEquals("created",lastAnswerRuntime);assertEquals("fixture",lastAnswer);assertEquals(cloud.id,selection.selectedId)
        compose.onNodeWithContentDescription("Close runtime picker").performClick();assertEquals(1,closes);assertEquals(0,cancels)
    }
    @Test fun boxManagerGetsSignInWithoutCreationAndCanCancelOnce() {
        render(true)
        compose.waitUntil(5000) {store.signInRuntime?.id==box.id}
        compose.onNodeWithText("Create runtime").assertDoesNotExist()
        compose.onNodeWithText("Start provider sign-in").performScrollTo().performClick()
        compose.onNodeWithText("Synthetic method").assertExists()
        compose.onNodeWithText("Cancel sign-in").performScrollTo().performClick()
        compose.waitUntil(5000) {cancels==1}
        assertEquals(box.id,lastStart);assertEquals(0,creates);assertEquals(cloud.id,selection.selectedId)
    }
    @Test fun secretInputIsStepBoundAndClearedAfterSubmit() {
        step=RuntimeLoginStep("input",message="Synthetic secret",secret=true)
        render(true);compose.waitUntil(5000){store.signInRuntime?.id==box.id}
        compose.onNodeWithText("Start provider sign-in").performScrollTo().performClick()
        compose.runOnIdle { blockRuntimeFixtureAutofillWindows() }
        // Exercise the field's real accessibility edit action without offering a fake secret to the device password manager.
        compose.onNodeWithText("Synthetic secret").performScrollTo().performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.SetText) {
            assertTrue(it(androidx.compose.ui.text.AnnotatedString("synthetic-value")))
        }
        compose.onNodeWithText("Continue").performScrollTo().performClick()
        compose.waitUntil(5000){answers==1}
        compose.onNodeWithText("synthetic-value").assertDoesNotExist()
        assertEquals(box.id,lastStart);assertEquals(box.id,lastAnswerRuntime);assertEquals("synthetic-value",lastAnswer);assertEquals("00000000-0000-4000-8000-000000000001",lastAttempt)
        assertEquals(cloud.id,selection.selectedId)
    }
    @Test fun sharedPickerManagementAndBackPreserveSelectionWithoutWrites() {
        render(pickerMode=true)
        compose.onNodeWithText("Manage computers and runtimes").performScrollTo().performClick()
        compose.onNodeWithText("Create runtime").assertExists()
        assertEquals(cloud.id,selection.selectedId)
        compose.onNodeWithText("Back to runtimes").performScrollTo().performClick()
        compose.onNodeWithText("Choose runtime").assertIsDisplayed()
        compose.onNodeWithText("Create runtime").assertDoesNotExist()
        assertEquals(cloud.id,selection.selectedId);assertEquals(0,creates);assertEquals(0,starts)
        compose.onNodeWithContentDescription("Close runtime picker").performClick()
        assertEquals(1,closes)
    }
    @Test fun localInstructionsAreReadableAtLargeFontAndOnlyClose() {
        compose.setContent {
            val density=LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density,2f)) {
                RuntimeFixtureTheme {Surface {
                    RuntimeInventoryInstructions(box,InventoryDestination.HostInstructions,{closes++})
                }}
            }
        }
        compose.onNodeWithText("Sign in on Synthetic Box").assertExists()
        compose.onNodeWithText("Done").performScrollTo().performClick()
        assertEquals(1,closes);assertEquals(0,creates);assertEquals(0,starts)
    }
}

/** Fixtures never offer to save synthetic provider answers into a real password manager. */
@Composable
internal fun RuntimeFixtureTheme(content:@Composable ()->Unit) {
    val context=androidx.compose.ui.platform.LocalContext.current
    check(context.packageName.endsWith(".agentsaudit1382") || context.packageName.endsWith(".runtimes1373"))
    val view=androidx.compose.ui.platform.LocalView.current
    DisposableEffect(view) {
        val root=view.rootView;val previous=root.importantForAutofill
        val manager=context.getSystemService(android.view.autofill.AutofillManager::class.java)
        manager?.cancel();root.importantForAutofill=android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        onDispose {manager?.cancel();root.importantForAutofill=previous}
    }
    CompositionLocalProvider(androidx.compose.ui.platform.LocalAutofillManager provides null) {
        NuphosTheme(darkTheme=InstrumentationRegistry.getArguments().getString("fixtureDark")=="true",content=content)
    }
}

/** Modal sheets own another Android window; excluding only the Activity root is insufficient. */
internal fun blockRuntimeFixtureAutofillWindows() {
    check(InstrumentationRegistry.getInstrumentation().targetContext.packageName.endsWith(".agentsaudit1382"))
    fun exclude(view:android.view.View) {
        view.importantForAutofill=android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        if(view is android.view.ViewGroup) for(i in 0 until view.childCount) exclude(view.getChildAt(i))
    }
    android.view.inspector.WindowInspector.getGlobalWindowViews().forEach { root ->
        exclude(root)
        root.context.getSystemService(android.view.autofill.AutofillManager::class.java)?.cancel()
    }
}
