package ai.nuphos.android.session

import org.junit.Assert.*
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.Dispatchers
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.ComposerAttachment
import ai.nuphos.android.model.ComposerSubmission
import ai.nuphos.android.model.ChatMessage
import ai.nuphos.android.data.OwnedAttachmentFile
import androidx.compose.runtime.MutableState
import java.io.File

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class AiAccessTest {
    @Before fun setup() { Dispatchers.setMain(UnconfinedTestDispatcher()) }
    @After fun cleanup() { AiAccess.revoke(); Dispatchers.resetMain() }

    @Test fun permissionBelongsToActiveAccount() {
        AiAccess.activate("first")
        assertFalse(AiAccess.allows("first"))
        AiAccess.grant("other")
        assertFalse(AiAccess.allows("first"))
        AiAccess.grant("first")
        assertTrue(AiAccess.allows("first"))
        assertFalse(AiAccess.allows("other"))
        AiAccess.activate("second")
        assertFalse(AiAccess.allows("first"))
        assertFalse(AiAccess.allows("second"))
    }

    @Test fun deniedSessionCannotReadManageOrSend() = runTest {
        var reads = 0
        val session = ChatSession("denied", "team", readDetail = { _, _, _ -> reads++; error("Unexpected read") })
        assertFalse(session.canSubmit)
        assertFalse(session.canManage)
        assertFalse(session.send("private text"))
        assertFalse(session.recoverRuntime())
        session.load()
        session.reloadFromServer()
        assertEquals(0, reads)
        assertTrue(runCatching { session.plan("private") }.isFailure)
        session.disposeForConsent()
    }

    @Test fun readStartedBeforeRevokeCannotResumeActiveRun() = runTest {
        Dispatchers.setMain(UnconfinedTestDispatcher(testScheduler))
        try {
            AiAccess.activate("account")
            AiAccess.grant("account")
            val session = ChatSession("account", "team", readDetail = { _, _, _ ->
                AiAccess.revoke()
                AgentConversationDetail(isOwner = true)
            })
            session.load()
            assertFalse(session.loaded)
            assertFalse(session.isStreaming)
            assertFalse(session.canSubmit)
            session.disposeForConsent()
        } finally { Dispatchers.resetMain() }
    }

    @Test fun disposalClearsDeferredDraftWithoutRestoringPermission() {
        AiAccess.activate("account")
        AiAccess.grant("account")
        val session = ChatSession.fresh("account", "team")
        session.sendAfterLoad = "private draft"
        session.disposeForConsent()
        assertNull(session.sendAfterLoad)
        assertFalse(session.canSubmit)
        assertTrue(session.messages.isEmpty())
        assertFalse(session.send("another draft"))
    }

    @Test fun disposalDeletesUnsubmittedCopyAndPreservesHistoryAndOriginal() {
        val directory = kotlin.io.path.createTempDirectory("consent-copy").toFile()
        try {
            val original = File(directory, "original.txt").apply { writeText("private marker") }
            val owned = original.inputStream().use { OwnedAttachmentFile.copy(directory, it, 1024) {} }
            val attachment = ComposerAttachment(name = "original.txt", kind = ComposerAttachment.Kind.RetainedFile(owned, "text/plain"))
            val session = ChatSession("denied", "team")
            val history = listOf(ChatMessage.user("sent history"))
            setState(session, "uploadDraft", ComposerSubmission("unsent", listOf(attachment)))
            setState(session, "messages", history)
            setState(session, "queued", listOf("queued private text"))
            session.disposeForConsent()
            assertFalse(owned.exists)
            assertEquals("private marker", original.readText())
            assertEquals(history, session.messages)
            assertNull(session.uploadDraft)
            assertTrue(session.queued.isEmpty())
        } finally { directory.deleteRecursively() }
    }

    @Suppress("UNCHECKED_CAST")
    private fun setState(session: ChatSession, name: String, value: Any?) {
        val field = ChatSession::class.java.getDeclaredField(name + "\$delegate").apply { isAccessible = true }
        (field.get(session) as MutableState<Any?>).value = value
    }

    @Test fun staleConsentGrantCannotUndoNewerRevocation() {
        AiAccess.activate("account")
        val revision = AiAccess.revision
        AiAccess.grant("account")
        AiAccess.revokeIfCurrent("account", revision)
        assertFalse(AiAccess.grantIfCurrent("account", revision))
        assertFalse(AiAccess.allows("account"))
        assertTrue(AiAccess.grantIfCurrent("account", AiAccess.revision))
    }

    @Test fun retainedSessionCannotRegainConsent() {
        AiAccess.activate("account")
        AiAccess.grant("account")
        val retained = AiAccess.bind("account")
        assertTrue(retained())
        AiAccess.revoke()
        AiAccess.grant("account")
        assertFalse(retained())
        assertTrue(AiAccess.bind("account")())
    }
}
