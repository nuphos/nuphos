package ai.nuphos.android
import ai.nuphos.android.model.HomePage
import org.junit.Assert.*
import org.junit.Test
class HomePageParityTest {
    @Test fun onlyIosPagesAppearInTheSameOrder() {
        assertEquals(listOf("Agents", "Plans", "Runtimes", "Connectors"), HomePage.entries.map { it.title })
    }
    @Test fun retiredAndUnknownSavedRoutesHaveAnExplicitUnavailableState() {
        listOf("monitoring", "triggers", "unknown").forEach { assertTrue(HomePage.unavailableRoute(it)) }
        HomePage.entries.forEach { assertFalse(HomePage.unavailableRoute(it.route)); assertEquals(it, HomePage.fromRoute(it.route)) }
        assertFalse(HomePage.unavailableRoute(null))
    }
}
