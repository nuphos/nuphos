package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.*
import ai.nuphos.android.model.TeamMember
import ai.nuphos.android.session.SharingState
import ai.nuphos.android.ui.chat.ShareSessionSheet
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Synthetic data and transport only; never loads installed credentials or sends requests. */
@RunWith(AndroidJUnit4::class)
class SharingFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val person = SessionAccess.Participant("viewer", "Synthetic Viewer", "viewer@example.invalid", false, "view")
    private val member = TeamMember("new", "Synthetic Teammate", "new@example.invalid")
    private class Fixture(initial: SessionAccess, private val member: TeamMember) : SharingTransport {
        var access = initial
        var calls = 0
        var reject = false
        override suspend fun read() = access
        override suspend fun members() = listOf(member, member.copy(id = "removed", removedAt = "2026-01-01"))
        override val localRuntime = true
        private fun write(value: SessionAccess): SessionAccess { calls++; check(!reject) { "Synthetic permission denied (403)" }; access = value; return value }
        override suspend fun general(value: GeneralAccess) = write(access.copy(generalAccess = value))
        override suspend fun invite(userId: String, role: ShareRole) = write(access.copy(participants = access.participants + SessionAccess.Participant(userId, member.name, member.email, false, role.raw)))
        override suspend fun role(userId: String, role: ShareRole) = write(access.copy(participants = access.participants.map { if (it.id == userId) it.copy(role = role.raw) else it }))
        override suspend fun remove(userId: String) = write(access.copy(participants = access.participants.filterNot { it.id == userId }))
    }
    private fun snap(name: String) {
        compose.waitForIdle()
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: error("No screenshot")
        val dir = File(InstrumentationRegistry.getInstrumentation().targetContext.filesDir, "share-synthetic").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
    @Test fun ownerSharingMatrixIsSynthetic() {
        val initial = SessionAccess(GeneralAccess.Reply, listOf(SessionAccess.Participant("owner", "Synthetic Owner", "", true, "owner"), person))
        val api = Fixture(initial, member)
        val state = SharingState(api) { true }
        var dark by mutableStateOf(false)
        compose.setContent { NuphosTheme(darkTheme = dark) { ShareSessionSheet(state, "https://example.invalid/synthetic-session") {} } }
        compose.waitUntil(5000) { state.access != null && !state.loading }
        compose.onNodeWithText("Owner").assertExists()
        snap("synthetic-owner-light")
        compose.runOnIdle { dark = true }
        snap("synthetic-owner-dark")
        compose.onNodeWithContentDescription("Role for Synthetic Viewer: Can reply").performScrollTo().performClick()
        compose.onNodeWithText("Can view").assertIsNotEnabled()
        compose.onNodeWithText("Can manage").performClick()
        compose.waitUntil { state.access!!.participants.last().role == "manage" }
        compose.onNodeWithText("Team access: Team can view and reply").performScrollTo().performClick()
        compose.onNodeWithText("Only people invited").performClick()
        compose.waitUntil { state.access!!.generalAccess == GeneralAccess.Invited }
        compose.onNodeWithText("Synthetic Teammate").performScrollTo().performClick()
        compose.onNodeWithText("Let Synthetic Teammate use your computer?").assertExists()
        snap("synthetic-local-confirm")
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(2, api.calls)
        compose.onNodeWithText("Synthetic Teammate").performScrollTo().performClick()
        compose.onNodeWithText("Invite").performClick()
        compose.waitUntil { state.added != null }
        compose.onNodeWithText("Undo invite").performScrollTo().performClick()
        compose.waitUntil { state.added == null }
        assertFalse(state.access!!.participants.any { it.id == member.id })
        compose.runOnIdle { api.reject = true }
        compose.onNodeWithText("Team access: Only people invited").performScrollTo().performClick()
        compose.onNodeWithText("Team can view").performClick()
        compose.onNodeWithText("Synthetic permission denied (403)").assertExists()
        snap("synthetic-mutation-error")
        compose.onNodeWithText("OK").performClick()
        assertEquals(GeneralAccess.Invited, state.access!!.generalAccess)
        compose.runOnIdle { api.reject = false }
        compose.onNodeWithContentDescription("Role for Synthetic Viewer: Can manage").performScrollTo().performClick()
        compose.onNodeWithText("Remove").performClick()
        compose.waitUntil { state.access!!.participants.size == 1 }
    }
    @Test fun teammateCanOnlyReadSharing() {
        val api = Fixture(SessionAccess(GeneralAccess.View, listOf(person)), member)
        val state = SharingState(api) { false }
        var dark by mutableStateOf(false)
        compose.setContent { NuphosTheme(darkTheme = dark) { ShareSessionSheet(state, null) {} } }
        compose.waitUntil { state.access != null }
        compose.onNodeWithText("Team can view").assertExists()
        compose.onNodeWithText("Can view").assertExists()
        compose.onNodeWithText("Only the owner can change who has access.").performScrollTo().assertExists()
        compose.onNodeWithText("Add people").assertDoesNotExist()
        snap("synthetic-read-only-light")
        compose.runOnIdle { dark = true }
        snap("synthetic-read-only-dark")
        assertEquals(0, api.calls)
    }
}
