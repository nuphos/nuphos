package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.CredentialCatalog
import ai.nuphos.android.model.CredentialSelection
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.chat.CredentialPickerSheet
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Synthetic catalog on a real device. No workspace, account or permission writes. */
@RunWith(AndroidJUnit4::class)
class ComputerAvailabilityDeviceTest {
    @get:Rule val compose = createComposeRule()
    @Test fun light() = verify(false)
    @Test fun dark() = verify(true)

    private fun verify(dark: Boolean) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val store = AgentStore("synthetic-no-credentials", context)
        val catalog = CredentialCatalog(JsonValue.parse("""{"devices":[
            {"deviceId":"online","label":"Fixture available computer","platform":"darwin","available":true},
            {"deviceId":"selected","label":"Fixture selected unavailable","platform":"win32","available":false},
            {"deviceId":"hidden","label":"Fixture hidden unavailable","platform":"linux","available":false}],
            "awsRoles":[{"roleId":"cloud","accountAlias":"Fixture existing cloud"}]}""")!!)
        var selection by mutableStateOf(CredentialSelection(JsonValue.parse("""{"deviceIds":["selected"],"awsRoleIds":["cloud"]}""")!!))
        @Suppress("UNCHECKED_CAST")
        val cache = AgentStore::class.java.getDeclaredField("credentialCatalog\$delegate").also { it.isAccessible = true }.get(store) as MutableState<CredentialCatalog?>
        fun shot(step: String) {
            compose.waitForIdle()
            instrumentation.uiAutomation.takeScreenshot().useBitmap {
                File(context.filesDir, "nups1127-${if (dark) "dark" else "light"}-$step.png").outputStream().use { out -> compress(Bitmap.CompressFormat.PNG, 100, out) }
            }
        }
        try {
            compose.runOnIdle { cache.value = catalog }
            compose.setContent {
                NuphosTheme(darkTheme = dark) {
                    CompositionLocalProvider(LocalAgentStore provides store) {
                        CredentialPickerSheet(selection, { selection = it }, {})
                    }
                }
            }
            compose.onNodeWithText("Fixture selected unavailable").assertIsOn()
            compose.onNodeWithText("Windows · Unavailable").assertIsDisplayed()
            compose.onNodeWithText("Fixture hidden unavailable").assertDoesNotExist()
            compose.onNodeWithText("Fixture available computer").assertIsOff()
            shot("before")
            compose.onNodeWithText("Select all").performClick()
            compose.onNodeWithText("Fixture selected unavailable").assertIsOn()
            compose.onNodeWithText("Fixture available computer").assertIsOn()
            compose.onNodeWithText("Fixture hidden unavailable").assertDoesNotExist()
            compose.runOnIdle {
                assertEquals(setOf("online", "selected"), selection.ids["deviceIds"])
                assertEquals(setOf("cloud"), selection.ids["awsRoleIds"])
            }
            shot("select-all")
            compose.onNodeWithText("Fixture selected unavailable").performClick()
            compose.onNodeWithText("Fixture selected unavailable").assertDoesNotExist()
            compose.onNodeWithText("Clear all").performClick()
            compose.onNodeWithText("Fixture available computer").assertIsOff()
            compose.runOnIdle {
                assertTrue(selection.ids["deviceIds"]!!.isEmpty())
                assertEquals(setOf("cloud"), selection.ids["awsRoleIds"])
            }
            shot("clear-all")
            compose.onNodeWithText("Select all").performClick()
            compose.runOnIdle { assertEquals(setOf("online"), selection.ids["deviceIds"]) }
        } finally {
            compose.runOnIdle { store.disposeForConsent() }
        }
    }

    private inline fun Bitmap.useBitmap(block: Bitmap.() -> Unit) {
        try { block() } finally { recycle() }
    }
}
