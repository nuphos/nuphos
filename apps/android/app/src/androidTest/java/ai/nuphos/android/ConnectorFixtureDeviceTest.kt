package ai.nuphos.android

import android.graphics.Bitmap
import android.view.View
import android.view.autofill.AutofillManager
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.nuphos.android.data.*
import ai.nuphos.android.model.*
import ai.nuphos.android.session.*
import ai.nuphos.android.ui.LocalConnectorsStore
import ai.nuphos.android.ui.connectors.ConnectorsPage
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList

/** Uses the Compose test Activity, synthetic stores, and a transport with no network implementation. */
@RunWith(AndroidJUnit4::class)
class ConnectorFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val requests = CopyOnWriteArrayList<String>()
    private var fail = false
    private var saved = false
    private var response = "{}"
    private val transport = ConnectorTransport { method, _, path, _, _ ->
        requests.add("$method:$path")
        if (fail) error("fixture unavailable")
        if (method == "POST") {
            saved = true
            JsonValue.obj("id" to JsonValue.Str("fixture-binding"))
        } else if (saved) JsonValue.parse("""{"notion":[{"id":"fixture-binding","label":"Fixture Notion"}]}""")!!
        else JsonValue.parse(response)!!
    }
    private lateinit var store: ConnectorsStore
    private var fixtureAutofillManager: AutofillManager? = null
    private fun render(admin: Boolean = true, pending: ConnectorPending? = null, compact: Boolean = false) {
        store = ConnectorsStore(transport, object : ConnectorPendingStorage {
            override fun read() = pending
            override fun write(pending: ConnectorPending?) {}
        }, now = { 0 })
        runBlocking { store.select(Team("fixture-team", role = if (admin) "ADMINISTRATOR" else "MEMBER")) }
        compose.setContent {
            val view = LocalView.current
            DisposableEffect(view) {
                fixtureAutofillManager = view.context.getSystemService(AutofillManager::class.java)
                fixtureAutofillManager?.cancel()
                val previous = view.importantForAutofill
                // Synthetic credentials must not enter the device password manager.
                view.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
                onDispose {
                    fixtureAutofillManager?.cancel()
                    view.importantForAutofill = previous
                }
            }
            NuphosTheme {
                CompositionLocalProvider(LocalConnectorsStore provides store) {
                    if (compact) {
                        val density = LocalDensity.current
                        CompositionLocalProvider(LocalDensity provides Density(density.density, 1.3f)) {
                            Box(Modifier.widthIn(max = 320.dp)) { ConnectorsPage() }
                        }
                    } else ConnectorsPage()
                }
            }
        }
    }
    @Test fun inventoryRetryThenEmptyUsesActualButtons() {
        fail = true
        render()
        compose.onNodeWithText("Could not load connectors. Try again.").assertIsDisplayed()
        capture("12-connector-load-error")
        fail = false
        compose.onNodeWithText("Retry").performClick()
        compose.waitUntil(5000) { store.phase == ConnectorsStore.Phase.Loaded }
        compose.onNodeWithText("No connectors are saved for this team.").assertIsDisplayed()
        capture("13-connector-retry-empty")
        assertTrue(requests.all { it == "GET:connectors" })
    }
    @Test fun allInventoryObjectSlotsAndDistinctZeaburIdentitiesRender() {
        response = """{"zeabur":[{"providerId":"p","zeaburId":"a","kind":"user","name":"Fixture user"},{"providerId":"p","zeaburId":"b","kind":"team","name":"Fixture team"}],"slack":{"installation":null,"linkedChannels":{"count":2}},"lark":{"installation":{"id":"l","tenantName":"Fixture Lark"}},"discord":{"configured":true,"installation":{"guildId":"g","guildName":"Fixture Discord"},"channels":[{"channelId":"c"}]}}"""
        render()
        compose.onNodeWithText("Fixture user").assertIsDisplayed()
        compose.onNodeWithText("Fixture team").assertIsDisplayed()
        compose.onNodeWithText("Linked Slack channels").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("connector-inventory-list").performScrollToNode(hasText("Fixture Lark"))
        compose.onNodeWithText("Fixture Lark").assertIsDisplayed()
        compose.onNodeWithTag("connector-inventory-list").performScrollToNode(hasText("Fixture Discord"))
        compose.onNodeWithText("Fixture Discord").assertIsDisplayed()
        capture("14-connector-inventory-fixture")
        assertEquals(5, store.inventory.rows.size)
        assertTrue(requests.all { it == "GET:connectors" })
    }
    @Test fun memberCanBrowseCatalogWithoutAddRequests() {
        render(admin = false)
        compose.onNodeWithTag("connector-catalog").performClick()
        compose.onNodeWithText("AWS").assertIsDisplayed()
        compose.onNodeWithTag("connector-add-aws").assertDoesNotExist()
        compose.onAllNodesWithText("Add").assertCountEquals(0)
        capture("15-member-catalog")
        assertTrue(requests.all { it == "GET:connectors" })
    }
    @Test fun adminFormMasksSecretValidatesThenVerifiesSavedBinding() {
        render()
        compose.onNodeWithTag("connector-catalog").performClick()
        compose.onNodeWithTag("connector-catalog-list").performScrollToNode(hasTestTag("connector-add-notion"))
        compose.onNodeWithTag("connector-add-notion").performClick()
        compose.onNodeWithTag("connector-form-list").performScrollToNode(hasTestTag("connector-save"))
        compose.onNodeWithTag("connector-save").performClick()
        compose.onNodeWithTag("connector-form-list").performScrollToNode(hasTestTag("connector-field-label"))
        compose.onNodeWithText("Label is required.").assertIsDisplayed()
        capture("16-form-validation")
        assertFalse(requests.any { it.startsWith("POST:") })
        compose.onNodeWithTag("connector-field-label").performTextInput("Fixture Notion")
        compose.onNodeWithTag("connector-form-list").performScrollToNode(hasTestTag("connector-field-token"))
        compose.onNodeWithTag("connector-field-token").performTextInput("synthetic-secret")
        compose.onNodeWithTag("connector-field-token").assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Password))
        androidx.test.espresso.Espresso.closeSoftKeyboard()
        capture("17-form-masked-synthetic-secret")
        compose.runOnIdle { fixtureAutofillManager?.cancel() }
        compose.onNodeWithTag("connector-form-list").performScrollToNode(hasTestTag("connector-save"))
        compose.onNodeWithTag("connector-save").performClick()
        compose.waitUntil(5000) { store.notice == "Connector saved and verified." }
        compose.onNodeWithText("Fixture Notion").assertIsDisplayed()
        assertEquals(1, requests.count { it == "POST:notion-integrations" })
        assertTrue(store.inventory.contains("notion", "fixture-binding"))
        capture("18-saved-binding-fixture")
    }
    @Test fun cancelFormClosesSheetAndKeepsInventoryWithoutPost() {
        render()
        compose.onNodeWithTag("connector-catalog").performClick()
        compose.onNodeWithTag("connector-add-aws").performScrollTo().performClick()
        compose.onNodeWithTag("connector-field-roleArn").performTextInput("arn:aws:iam::123456789012:role/Fixture")
        compose.onNodeWithText("Cancel").performScrollTo().performClick()
        compose.onNodeWithText("Add AWS").assertDoesNotExist()
        compose.onNodeWithText("No connectors are saved for this team.").assertIsDisplayed()
        assertFalse(requests.any { it.startsWith("POST:") })
    }
    @Test fun nativeBackCancelsPendingAuthorizationWithoutBinding() {
        render(pending = ConnectorPending("fixture-team", "linear", "abc", 1000))
        compose.onNodeWithText("Waiting for Linear authorization.").assertIsDisplayed()
        capture("19-pending-authorization-fixture")
        androidx.test.espresso.Espresso.pressBack()
        compose.waitUntil(5000) { store.pending == null }
        assertTrue(requests.contains("DELETE:linear-workspaces/start-oauth/abc"))
        assertFalse(requests.any { it.startsWith("POST:") })
        compose.onNodeWithText("Authorization canceled. Refreshed connectors show the current saved state.").assertIsDisplayed()
        capture("20-canceled-authorization-fixture")
    }

    @Test fun longInventoryAndCompactFormKeepActionsReachable() {
        val label = "Synthetic long connector label with several words for narrow layout review"
        response = """{"notion":[{"id":"fixture-long","label":"$label"}]}"""
        render(compact = true)
        compose.onNodeWithText(label).assertIsDisplayed()
        capture("21-compact-long-inventory-fixture")
        compose.onNodeWithTag("connector-catalog").performClick()
        compose.onNodeWithTag("connector-catalog-list").performScrollToNode(hasTestTag("connector-add-azure"))
        compose.onNodeWithTag("connector-add-azure").performClick()
        // Expand the partially opened sheet before checking a field on a compact screen.
        compose.onNodeWithTag("connector-form-list").performTouchInput { swipeUp() }
        compose.onNodeWithTag("connector-form-list").performScrollToNode(hasTestTag("connector-field-subscriptionId"))
        compose.onNodeWithTag("connector-field-subscriptionId").assertIsDisplayed()
        capture("22-azure-form-large-text-fixture")
        compose.onNodeWithTag("connector-form-list").performScrollToNode(hasTestTag("connector-save"))
        capture("23-azure-form-actions-large-text-fixture")
        compose.onNodeWithText("Cancel").assertIsDisplayed().performClick()
        compose.onNodeWithText(label).assertIsDisplayed()
        assertTrue(requests.all { it == "GET:connectors" })
    }

    private fun capture(name: String) {
        if (InstrumentationRegistry.getArguments().getString("captureScreenshots") != "true") return
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "connector-visual-20261003").apply { mkdirs() }
        val bitmap = instrumentation.uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
    }

}
