package ai.nuphos.android.ui.agent

import ai.nuphos.android.R
import ai.nuphos.android.data.RuntimeDevice
import org.junit.Assert.assertEquals
import org.junit.Test

class RuntimeStatusWordsTest {
    private fun box(state: String?) = RuntimeDevice("box", "Work Box", false, RuntimeDevice.Box(state), "offline", null, null, null)

    @Test fun aBoxThatIsStillStartingSaysSoInsteadOfOffline() {
        assertEquals(R.string.convtext_phase_starting, offlineWords(box("creating")))
        assertEquals(R.string.convtext_phase_connecting, offlineWords(box("connecting")))
    }
    @Test fun everythingElseThatIsNotOnlineIsOffline() {
        assertEquals(R.string.agent_offline, offlineWords(box("paused")))
        assertEquals(R.string.agent_offline, offlineWords(box(null)))
        assertEquals(R.string.agent_offline, offlineWords(box("creating").copy(box = null)))
        assertEquals(R.string.agent_offline, offlineWords(null))
    }
}
