package ai.nuphos.android.session

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class ShareApprovalTest {
    @Before fun setup() { Dispatchers.setMain(UnconfinedTestDispatcher()) }
    @After fun cleanup() { Dispatchers.resetMain() }

    @Test fun waitsOnlyWhileTheOwnerHasNotApproved() {
        assertEquals(ShareApprovalWait.Pending, ShareApprovalWait.of("pending"))
        assertEquals(ShareApprovalWait.Denied, ShareApprovalWait.of("denied"))
        assertNull(ShareApprovalWait.of("approved"))
        assertNull(ShareApprovalWait.of(null))
        assertTrue(ShareApprovalWait.Pending.message("Mac").startsWith("Waiting for the owner of Mac"))
    }

    @Test fun keepsAskingUntilTheOwnerApproves() = runTest {
        val answers = ArrayDeque(listOf("pending", "pending", "approved"))
        val seen = mutableListOf<ShareApprovalWait?>()
        lateinit var session: ChatSession
        session = ChatSession("fixture", "team", aiAllowed = { true },
            creationRuntimeBinding = ai.nuphos.android.data.RuntimeBinding("local_owner_mac", "claude-code", "Owner's Mac"),
            readShareApproval = { _, _ -> answers.removeFirst().also { seen += session.shareApproval } })
        session.watchShareApproval()
        assertTrue(answers.isEmpty())
        assertEquals(listOf(null, ShareApprovalWait.Pending, ShareApprovalWait.Pending), seen)
        assertNull(session.shareApproval)
    }

    @Test fun neverAsksAboutACloudAgent() = runTest {
        var asked = 0
        val session = ChatSession("fixture", "team", aiAllowed = { true },
            creationRuntimeBinding = ai.nuphos.android.data.RuntimeBinding("cloud", "codex", "Cloud Agent"),
            readShareApproval = { _, _ -> asked++; "pending" })
        session.watchShareApproval()
        assertEquals(0, asked)
        assertNull(session.shareApproval)
    }
}
