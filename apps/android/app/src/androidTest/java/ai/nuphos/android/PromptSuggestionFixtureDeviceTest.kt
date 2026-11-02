package ai.nuphos.android

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.model.*
import ai.nuphos.android.session.*
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.chat.ChatComposer
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.junit.*
import org.junit.Assert.*

/** Actual composer, scoped synthetic identity and drafts. No network Send or real account. */
class PromptSuggestionFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var auth: AuthSession
    private lateinit var store: AgentStore
    private lateinit var app: NuphosApplication
    private lateinit var lease: ComposerDrafts.Lease
    private val drafts = ComposerDrafts()
    private val visibleDraft = mutableStateOf<ComposerDrafts.Lease?>(null)
    private lateinit var savedAccess: Any
    private val token = "synthetic-prompt-only"
    private val team = Team("prompt-team", "Synthetic workspace")
    private val suggestion = "Review the callback coverage / 檢查登入回呼"
    private val admission = mutableStateOf(true)
    private val streaming = mutableStateOf(false)
    private val rejected = mutableStateOf<ComposerSubmission?>(null)
    private val files = mutableStateOf<List<ComposerAttachment>>(emptyList())
    private var sends = 0
    @Suppress("UNCHECKED_CAST") private fun accessState() = AiAccess::class.java.getDeclaredField("state").also { it.isAccessible = true }.get(AiAccess) as MutableState<Any>
    @Suppress("UNCHECKED_CAST") private fun state(target: Any, name: String, value: Any) {
        (target.javaClass.getDeclaredField(name + "\$delegate").also { it.isAccessible = true }.get(target) as MutableState<Any>).value = value
    }
    @Before fun setup() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        check(context.packageName.endsWith(".prompt1327"))
        app = context.applicationContext as NuphosApplication
        savedAccess = accessState().value
        auth = AuthSession(app, app.tokenStore)
        AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, token)
        state(auth, "state", AuthSession.State.SignedIn(NuphosUser.preview))
        AiAccess.activate(token); AiAccess.grant(token)
        store = AgentStore(token, context)
        state(store, "selectedTeam", team)
        store.acceptMemberships(listOf(team))
        runBlocking { app.incomingShares.bindAccount(NuphosUser.preview.id) }
        lease = drafts.bind(NuphosUser.preview.id, team.id, ComposerDrafts.Destination.Chat("prompt"),
            allowed = { AiAccess.allows(token) && auth.user?.id == NuphosUser.preview.id && store.selectedTeam?.id == team.id })!!
        visibleDraft.value = lease
    }
    @After fun cleanup() {
        store.disposeForConsent()
        (AuthSession::class.java.getDeclaredField("scope").also { it.isAccessible = true }.get(auth) as CoroutineScope).cancel()
        accessState().value = savedAccess
    }
    private fun render() {
        compose.setContent {
            CompositionLocalProvider(LocalAuthSession provides auth, LocalAgentStore provides store) {
                NuphosTheme(darkTheme = InstrumentationRegistry.getArguments().getString("fixtureDark") == "true") {
                    Surface(Modifier.fillMaxSize()) {
                        Column(Modifier.systemBarsPadding()) {
                            Spacer(Modifier.weight(1f))
                            ChatComposer(isStreaming = streaming.value, canSubmit = admission.value, draft = visibleDraft.value,
                                promptSuggestion = { suggestion }, recalledFiles = files.value,
                                rejectedSubmission = rejected.value,
                                onSend = { sends++; true })
                        }
                    }
                }
            }
        }
    }
    @Test fun tappingSuggestionOnlyFillsTheScopedDraft() {
        render()
        compose.onNodeWithContentDescription("Suggested next message").assertIsDisplayed().performClick()
        compose.onNodeWithContentDescription("Suggested next message").assertDoesNotExist()
        compose.onNodeWithContentDescription("Ask Nuphos anything").assertTextContains(suggestion)
        assertEquals(suggestion, lease.text)
        assertEquals(0, sends)
    }
    @Test fun existingTextBusyAndRejectedDraftNeverGetOverwritten() {
        lease.write("Keep my draft")
        render()
        compose.onNodeWithContentDescription("Suggested next message").assertDoesNotExist()
        compose.onNodeWithContentDescription("Ask Nuphos anything").performTextClearance()
        compose.onNodeWithContentDescription("Suggested next message").assertIsDisplayed()
        compose.runOnIdle { admission.value = false }
        compose.onNodeWithContentDescription("Suggested next message").assertDoesNotExist()
        compose.runOnIdle { admission.value = true; streaming.value = true }
        compose.onNodeWithContentDescription("Suggested next message").assertDoesNotExist()
        compose.runOnIdle { streaming.value = false; rejected.value = ComposerSubmission("Retained failed message") }
        compose.onNodeWithContentDescription("Suggested next message").assertDoesNotExist()
        compose.onNodeWithContentDescription("Ask Nuphos anything").assertTextContains("Retained failed message")
        assertEquals(0, sends)
    }
    @Test fun pendingFilesAndScopeChangesBlockPromptApplication() {
        files.value = listOf(ComposerAttachment(name = "keep.txt", kind = ComposerAttachment.Kind.File("brief".toByteArray(), "text/plain")))
        render()
        compose.onNodeWithContentDescription("Suggested next message").assertDoesNotExist()
        compose.onNodeWithText("TXT").assertIsDisplayed()
        compose.runOnIdle { state(store, "selectedTeam", Team("other-team", "Other workspace")) }
        compose.onNodeWithContentDescription("Suggested next message").assertDoesNotExist()
        assertEquals("", lease.text)
        assertEquals(0, sends)
    }
    @Test fun emptySuggestionCannotCrossWorkspaceConsentOrAccount() {
        render()
        compose.onNodeWithContentDescription("Suggested next message").assertIsDisplayed()
        compose.runOnIdle { state(store, "selectedTeam", Team("other-team", "Other workspace")) }
        compose.onNodeWithContentDescription("Suggested next message").assertDoesNotExist()
        compose.runOnIdle { state(store, "selectedTeam", team) }
        compose.onNodeWithContentDescription("Suggested next message").assertIsDisplayed()
        compose.runOnIdle { AiAccess.revoke() }
        compose.onNodeWithContentDescription("Suggested next message").assertDoesNotExist()
        compose.runOnIdle { AiAccess.activate(token); AiAccess.grant(token) }
        runBlocking { app.incomingShares.bindAccount(NuphosUser.preview.id) }
        compose.onNodeWithContentDescription("Suggested next message").assertIsDisplayed()
        compose.runOnIdle { state(auth, "state", AuthSession.State.SignedIn(NuphosUser("other-account", name = "Other person"))) }
        compose.onNodeWithContentDescription("Suggested next message").assertDoesNotExist()
        assertEquals(0, sends)
    }
    @Test fun changingConversationOnlyAppliesToTheVisibleDraft() {
        render()
        val other = drafts.bind(NuphosUser.preview.id, team.id, ComposerDrafts.Destination.Chat("other-prompt"))!!
        compose.runOnIdle { visibleDraft.value = other }
        compose.onNodeWithContentDescription("Suggested next message").assertIsDisplayed().performClick()
        assertEquals("", lease.text)
        assertEquals(suggestion, other.text)
        assertEquals(0, sends)
    }
}
