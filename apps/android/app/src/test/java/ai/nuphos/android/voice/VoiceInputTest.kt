package ai.nuphos.android.voice

import java.io.File
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.runCurrent
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class VoiceInputTest {
    private class Settings : VoiceSettings {
        override var prompt = DEFAULT_WHISPER_PROMPT
    }
    private class Take : VoiceTake {
        val file = File.createTempFile("voice-fixture", ".m4a").apply { writeText("synthetic audio") }
        var starts = 0
        var stops = 0
        var canceled = false
        override fun start() { starts++ }
        override fun level() = .5f
        override fun stop(): File { stops++; return file }
        override fun cancel() { canceled = true; file.delete() }
    }
    private class Transport : WhisperTransport {
        var uploads = 0
        val result = CompletableDeferred<Transcript>()
        override suspend fun transcribe(file: File, token: String, teamId: String, prompt: String): Transcript { uploads++; return result.await() }
    }
    @Test fun duplicateFinishUploadsOnceAndOnlyAppendsText() = runTest {
        val take = Take(); val transport = Transport(); var draft = "Existing"
        val input = VoiceInput(VoiceServices(Settings(), transport, { take }, { "繁體" }), backgroundScope, VoiceAccess("fixture-token", "A", { true })) { draft = appendDictation(draft, it); true }
        input.awaitingPermission(); input.permissionResult(true); input.finish(); input.finish()
        runCurrent()
        assertEquals(1, transport.uploads); assertEquals(1, take.stops)
        transport.result.complete(Transcript("hello", "english"))
        // Conversion dispatcher is unnecessary for non-Chinese text.
        runCurrent()
        assertEquals("Existing hello", draft)
        assertEquals(VoiceInput.Phase.Idle, input.phase)
        input.cancel()
        assertFalse(take.file.exists())
    }
    @Test fun cancelDuringUploadNeverChangesDraftAndDeletesAudio() = runTest {
        val take = Take(); val transport = Transport(); var received = false
        val input = VoiceInput(VoiceServices(Settings(), transport, { take }), backgroundScope, VoiceAccess("fixture-token", "A", { true })) { received = true; true }
        input.awaitingPermission(); input.permissionResult(true); input.finish(); runCurrent()
        input.cancel(); transport.result.complete(Transcript("late reply", null)); runCurrent()
        assertFalse(received); assertFalse(take.file.exists()); assertEquals(VoiceInput.Phase.Idle, input.phase)
    }
    @Test fun canceledPermissionCannotStartMicrophone() = runTest {
        var starts = 0
        val input = VoiceInput(VoiceServices(Settings(), Transport(), { starts++; Take() }), backgroundScope, VoiceAccess("fixture-token", "A", { true })) { true }
        input.awaitingPermission(); input.cancel(); input.permissionResult(true)
        assertEquals(0, starts)
        input.awaitingPermission(); input.permissionResult(false)
        assertNotNull(input.error); assertEquals(VoiceInput.Phase.Idle, input.phase)
    }
    @Test fun subscriptionFailureKeepsDraftAndRemovesRecording() = runTest {
        val take = Take(); val transport = Transport(); var draft = "Existing"
        val input = VoiceInput(VoiceServices(Settings(), transport, { take }), backgroundScope,
            VoiceAccess("fixture-token", "A", { true })) { draft = it; true }
        input.awaitingPermission(); input.permissionResult(true); input.finish(); runCurrent()
        transport.result.completeExceptionally(VoiceFailure(402)); runCurrent()
        assertEquals("Existing", draft); assertFalse(take.file.exists()); assertTrue(input.error!!.contains("subscription"))
    }
    @Test fun staleWorkspaceResultCannotWriteDraftOrExpireNewIdentity() = runTest {
        val take = Take(); val transport = Transport(); var current = true; var received = false; var expires = 0
        val input = VoiceInput(VoiceServices(Settings(), transport, { take }), backgroundScope,
            VoiceAccess("fixture-token", "A", { current }, { expires++ })) { received = true; true }
        input.awaitingPermission(); input.permissionResult(true); input.finish(); runCurrent()
        current = false
        transport.result.completeExceptionally(VoiceFailure(401)); runCurrent()
        assertFalse(received); assertEquals(0, expires); assertFalse(take.file.exists())
    }
    @Test fun permissionResponseAfterWorkspaceChangeCannotStartRecorder() = runTest {
        var current = true; var starts = 0
        val input = VoiceInput(VoiceServices(Settings(), Transport(), { starts++; Take() }), backgroundScope,
            VoiceAccess("fixture-token", "A", { current })) { true }
        input.awaitingPermission(); current = false; input.permissionResult(true)
        assertEquals(0, starts); assertEquals(VoiceInput.Phase.Idle, input.phase)
    }
    @Test fun appendPreservesDraftWhitespaceAndIgnoresEmptyTranscription() {
        assertEquals("hello world", appendDictation("hello", " world "))
        assertEquals("hello\nworld", appendDictation("hello\n", "world"))
        assertEquals("hello ", appendDictation("hello ", "  "))
    }
    @Test fun explicitSendWritesTranscriptThenInvokesNormalSendOnceWhileIdle() = runTest {
        val take = Take(); val transport = Transport(); val events = mutableListOf<String>()
        lateinit var input: VoiceInput
        input = VoiceInput(VoiceServices(Settings(), transport, { take }), backgroundScope,
            VoiceAccess("fixture-token", "A", { true })) { events += "text:$it"; true }
        input.awaitingPermission(); input.permissionResult(true)
        input.finish { assertEquals(VoiceInput.Phase.Idle, input.phase); events += "send" }
        input.finish { fail("Duplicate finish cannot send") }; runCurrent()
        transport.result.complete(Transcript("spoken words", "english")); runCurrent()
        assertEquals(listOf("text:spoken words", "send"), events)
        assertEquals(1, transport.uploads); assertFalse(take.file.exists())
    }

    @Test fun lostSendAdmissionKeepsTranscriptWithoutCallingSend() = runTest {
        val take = Take(); val transport = Transport(); var allowed = true; var draft = "Existing"; var sends = 0
        val input = VoiceInput(VoiceServices(Settings(), transport, { take }), backgroundScope,
            VoiceAccess("fixture-token", "A", { true })) { draft = appendDictation(draft, it); true }
        input.awaitingPermission(); input.permissionResult(true)
        input.finish { if (allowed) sends++ }; runCurrent(); allowed = false
        transport.result.complete(Transcript("spoken words", "english")); runCurrent()
        assertEquals("Existing spoken words", draft); assertEquals(0, sends)
        assertEquals(VoiceInput.Phase.Idle, input.phase)
    }

    @Test fun staleOwnerOrCancellationPreventsExplicitSend() = runTest {
        for (cancel in listOf(false, true)) {
            val take = Take(); val transport = Transport(); var current = true; var writes = 0; var sends = 0
            val input = VoiceInput(VoiceServices(Settings(), transport, { take }), backgroundScope,
                VoiceAccess("fixture-token", "A", { current })) { writes++; true }
            input.awaitingPermission(); input.permissionResult(true); input.finish { sends++ }; runCurrent()
            if (cancel) input.cancel() else current = false
            transport.result.complete(Transcript("late words", "english")); runCurrent()
            assertEquals(0, writes); assertEquals(0, sends); assertFalse(take.file.exists())
        }
    }

    @Test fun emptyTranscriptNeverSendsAnExistingDraft() = runTest {
        val take = Take(); val transport = Transport(); var draft = "Keep existing draft"; var sends = 0
        val input = VoiceInput(VoiceServices(Settings(), transport, { take }), backgroundScope,
            VoiceAccess("fixture-token", "A", { true })) { draft = appendDictation(draft, it); true }
        input.awaitingPermission(); input.permissionResult(true); input.finish { sends++ }; runCurrent()
        transport.result.complete(Transcript("  ", "english")); runCurrent()
        assertEquals("Keep existing draft", draft); assertEquals(0, sends); assertNotNull(input.error)
    }

    @Test fun transcriptionFailureDoesNotInvokeExplicitSend() = runTest {
        val take = Take(); val transport = Transport(); var sends = 0
        val input = VoiceInput(VoiceServices(Settings(), transport, { take }), backgroundScope,
            VoiceAccess("fixture-token", "A", { true })) { true }
        input.awaitingPermission(); input.permissionResult(true); input.finish { sends++ }; runCurrent()
        transport.result.completeExceptionally(VoiceFailure(503)); runCurrent()
        assertEquals(0, sends); assertNotNull(input.error); assertFalse(take.file.exists())
    }

    @Test fun rejectedTranscriptApplicationNeverSendsOldDraftAndCanRecoverWithoutSending() = runTest {
        val take = Take(); val transport = Transport(); var applied = false; var sends = 0; var draft = "Old draft"
        val input = VoiceInput(VoiceServices(Settings(), transport, { take }), backgroundScope,
            VoiceAccess("fixture-token", "A", { true })) {
            if (applied) { draft = appendDictation(draft, it); true } else false
        }
        input.awaitingPermission(); input.permissionResult(true); input.finish { sends++ }; runCurrent()
        transport.result.complete(Transcript("recognized words", "english")); runCurrent()
        assertEquals("Old draft", draft); assertEquals(0, sends)
        assertEquals("recognized words", input.pendingText); assertNotNull(input.error)
        applied = true; input.retryText()
        assertEquals("Old draft recognized words", draft); assertEquals(0, sends)
        assertNull(input.pendingText)
    }

}
