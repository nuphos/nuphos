package ai.nuphos.android

import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.CredentialCatalog
import ai.nuphos.android.model.CredentialSelection
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.ChatSession
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.chat.CredentialPickerSheet
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Cached synthetic catalog; no account, socket, permission grant or preference write. */
@RunWith(AndroidJUnit4::class)
class ComputerCredentialFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()

    @Test fun computerCheckboxesKeepIndependentSelectionsAndCloudAccess() {
        val catalog = CredentialCatalog(JsonValue.parse("""{
            "devices":[{"deviceId":"mac","label":"Office Mac","platform":"darwin"},
                       {"deviceId":"pc","label":"Home PC","platform":"win32"}],
            "awsRoles":[{"roleId":"aws","accountAlias":"Existing AWS"}]
        }""")!!)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val store = AgentStore("synthetic-no-credentials", context)
        val session = ChatSession("synthetic-no-credentials", "synthetic-team", "synthetic-chat", aiAllowed = { false })
        session.credentialAccess = CredentialSelection(JsonValue.parse("""{"deviceIds":["mac"],"awsRoleIds":["aws"]}""")!!)
        // No workspace is selected, so the sheet cannot load a live catalog.
        @Suppress("UNCHECKED_CAST")
        val cached = AgentStore::class.java.getDeclaredField("credentialCatalog\$delegate").also { it.isAccessible = true }.get(store) as MutableState<CredentialCatalog?>
        try {
            compose.runOnIdle { cached.value = catalog }
            compose.setContent {
                NuphosTheme {
                    CompositionLocalProvider(LocalAgentStore provides store) {
                        CredentialPickerSheet(session.credentialAccess!!, { session.credentialAccess = it }, {})
                    }
                }
            }
            compose.onNodeWithText("My computers").assertIsDisplayed()
            compose.onNodeWithText("macOS").assertIsDisplayed()
            compose.onNodeWithText("Windows").assertIsDisplayed()
            compose.onNodeWithText("Office Mac").assertIsOn()
            compose.onNodeWithText("Home PC").assertIsOff().performClick().assertIsOn()
            compose.runOnIdle {
                assertEquals(setOf("mac", "pc"), session.credentialAccess!!.ids["deviceIds"])
                assertEquals(setOf("aws"), session.credentialAccess!!.ids["awsRoleIds"])
            }
            compose.onNodeWithText("Office Mac").performClick().assertIsOff()
            compose.onNodeWithText("Home PC").assertIsOn()
            compose.runOnIdle {
                assertEquals(listOf("pc"), session.credentialAccess!!.json["deviceIds"]!!.arrayValue!!.map { it.stringValue })
                assertEquals(setOf("aws"), session.credentialAccess!!.ids["awsRoleIds"])
            }
            compose.onNodeWithText("Clear").performClick()
            compose.onNodeWithText("Office Mac").assertIsOff()
            compose.onNodeWithText("Home PC").assertIsOff()
            compose.runOnIdle { assertTrue(session.credentialAccess!!.json["deviceIds"]!!.arrayValue!!.isEmpty()) }
        } finally {
            compose.runOnIdle { store.disposeForConsent() }
        }
    }
}
