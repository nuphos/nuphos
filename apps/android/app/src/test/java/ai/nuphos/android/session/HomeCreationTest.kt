package ai.nuphos.android.session

import ai.nuphos.android.data.AgentRuntime
import org.junit.Assert.*
import org.junit.Test

class HomeCreationTest {
    private val cloud = AgentRuntime("cloud", "codex", "Cloud", "active", "managed")
    private val other = cloud.copy(id = "other", kind = "local")
    @Test fun unknownEmptyAndUnusableCatalogsDoNotEnableCreation() {
        assertFalse(HomeCreation.canStart(null))
        assertFalse(HomeCreation.canStart(emptyList()))
        for (row in listOf(cloud.copy(deleting = true), cloud.copy(status = "disabled"), cloud.copy(signedIn = false))) {
            assertFalse(HomeCreation.canStart(listOf(row)))
            assertNull(HomeCreation.botRuntime(listOf(row), null))
        }
    }
    @Test fun staleRememberedChoiceKeepsNewTaskAvailableButNeverRebindsNewBot() {
        assertTrue(HomeCreation.canStart(listOf(other)))
        assertNull(HomeCreation.botRuntime(listOf(other), cloud.id))
        assertEquals(other, HomeCreation.botRuntime(listOf(cloud, other), other.id))
    }
    @Test fun noRememberedChoiceUsesTheCloudDefaultAndThenAnAvailableRuntime() {
        assertEquals(cloud, HomeCreation.botRuntime(listOf(other, cloud), null))
        assertEquals(other, HomeCreation.botRuntime(listOf(other), null))
    }
}
