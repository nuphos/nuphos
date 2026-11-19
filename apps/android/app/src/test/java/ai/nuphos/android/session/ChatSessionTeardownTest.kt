package ai.nuphos.android.session

import ai.nuphos.android.model.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.*
import kotlinx.coroutines.withContext
import org.junit.*
import org.junit.Assert.*

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class ChatSessionTeardownTest {
    // A permission read still running on IO after load() returns resumes on Dispatchers.Main once the
    // test has reset it, and coroutines-test fails whichever test runs next (#1045).
    @Test fun loadLeavesNothingToResumeOnMainAfterTeardown() {
        val read = CountDownLatch(1)
        Dispatchers.setMain(UnconfinedTestDispatcher())
        try {
            runTest {
                val session = ChatSession("fixture", "team", aiAllowed = { true },
                    readDetail = { _, _, _ -> AgentConversationDetail() },
                    readBypass = { _, _ -> withContext(Dispatchers.IO) { Thread.sleep(100); read.countDown(); true } })
                session.load()
                assertEquals(PermissionMode.Bypass, session.permissionMode)
                session.disposeForConsent()
            }
        } finally {
            Dispatchers.resetMain()
        }
        assertTrue(read.await(5, TimeUnit.SECONDS))
        Thread.sleep(100)
        Dispatchers.setMain(UnconfinedTestDispatcher())
        try {
            runTest {}
        } finally {
            Dispatchers.resetMain()
        }
    }
}
