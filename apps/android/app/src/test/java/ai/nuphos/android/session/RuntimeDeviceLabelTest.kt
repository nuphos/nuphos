package ai.nuphos.android.session

import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.data.RuntimeBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class RuntimeDeviceLabelTest {
    @Before fun setup() { Dispatchers.setMain(UnconfinedTestDispatcher()) }
    @After fun cleanup() { Dispatchers.resetMain() }

    @Test fun serverLabelReplacesCreationLabelAndMissingLabelDoesNotKeepOldDevice() = runTest {
        var detail = AgentConversationDetail(runtimeId = "laptop", runtimeLabel = "My laptop", agentRuntime = "codex")
        val session = ChatSession("fixture", "team", browsingOnly = true, aiAllowed = { true },
            readDetail = { _, _, _ -> detail }, creationRuntimeBinding = RuntimeBinding("cloud", "codex", "Cloud Agent"))
        assertEquals("Cloud Agent", session.runtimeDeviceLabel)
        assertEquals("cloud", session.outgoingCreationBinding?.runtimeId)
        session.load()
        assertEquals("My laptop", session.runtimeDeviceLabel)
        assertNull(session.outgoingCreationBinding)
        detail = AgentConversationDetail(runtimeId = "other", agentRuntime = "claude-code")
        session.reloadFromServer()
        assertNull(session.runtimeDeviceLabel)
        session.disposeBrowsing()
    }
}
