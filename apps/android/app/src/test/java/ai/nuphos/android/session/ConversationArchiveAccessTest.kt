package ai.nuphos.android.session

import ai.nuphos.android.model.AgentConversationDetail
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.*
import org.junit.*
import org.junit.Assert.*

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class ConversationArchiveAccessTest {
    @Before fun setup() { Dispatchers.setMain(UnconfinedTestDispatcher()) }
    @After fun cleanup() { Dispatchers.resetMain() }

    /** Someone else in a teammate's Task archives it for themselves (#3686); managing it stays the owner's. */
    @Test fun someoneElseInATaskArchivesItButDoesNotManageIt() = runTest {
        for ((detail, archives) in listOf(
            AgentConversationDetail(isOwner = false, canManage = false, canArchive = true, readOnly = false) to true,
            AgentConversationDetail(isOwner = false, canManage = false, canArchive = false, readOnly = false) to false,
            AgentConversationDetail(isOwner = false, canManage = false, canArchive = true, readOnly = true) to false,
            // A server from before #3811 sends no canArchive: archiving stays the owner's.
            AgentConversationDetail(isOwner = false, canManage = false, readOnly = false) to false,
            AgentConversationDetail(isOwner = true, canManage = true, readOnly = false) to true,
        )) {
            val session = ChatSession("fixture", "A", readBypass = { _, _ -> false }, aiAllowed = { true }, readDetail = { _, _, _ -> detail })
            session.load()
            assertEquals(detail.toString(), archives, session.canArchive)
            assertEquals(detail.toString(), detail.isOwner == true, session.canManage)
            session.disposeForConsent()
        }
    }
}
