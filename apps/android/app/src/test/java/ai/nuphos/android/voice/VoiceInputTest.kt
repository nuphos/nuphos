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
        val input = VoiceInput(VoiceServices(Settings(), transport, { take }, { "繁體" }), backgroundScope, VoiceAccess("fixture-token", "A", { true })) { draft = appendDictation(draft, it) }
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
        val input = VoiceInput(VoiceServices(Settings(), transport, { take }), backgroundScope, VoiceAccess("fixture-token", "A", { true })) { received = true }
        input.awaitingPermission(); input.permissionResult(true); input.finish(); runCurrent()
        input.cancel(); transport.result.complete(Transcript("late reply", null)); runCurrent()
        assertFalse(received); assertFalse(take.file.exists()); assertEquals(VoiceInput.Phase.Idle, input.phase)
    }
    @Test fun canceledPermissionCannotStartMicrophone() = runTest {
        var starts = 0
        val input = VoiceInput(VoiceServices(Settings(), Transport(), { starts++; Take() }), backgroundScope, VoiceAccess("fixture-token", "A", { true })) {}
        input.awaitingPermission(); input.cancel(); input.permissionResult(true)
        assertEquals(0, starts)
        input.awaitingPermission(); input.permissionResult(false)
        assertNotNull(input.error); assertEquals(VoiceInput.Phase.Idle, input.phase)
    }
    @Test fun subscriptionFailureKeepsDraftAndRemovesRecording() = runTest {
        val take = Take(); val transport = Transport(); var draft = "Existing"
        val input = VoiceInput(VoiceServices(Settings(), transport, { take }), backgroundScope,
            VoiceAccess("fixture-token", "A", { true })) { draft = it }
        input.awaitingPermission(); input.permissionResult(true); input.finish(); runCurrent()
        transport.result.completeExceptionally(VoiceFailure(402)); runCurrent()
        assertEquals("Existing", draft); assertFalse(take.file.exists()); assertTrue(input.error!!.contains("subscription"))
    }
    @Test fun staleWorkspaceResultCannotWriteDraftOrExpireNewIdentity() = runTest {
        val take = Take(); val transport = Transport(); var current = true; var received = false; var expires = 0
        val input = VoiceInput(VoiceServices(Settings(), transport, { take }), backgroundScope,
            VoiceAccess("fixture-token", "A", { current }, { expires++ })) { received = true }
        input.awaitingPermission(); input.permissionResult(true); input.finish(); runCurrent()
        current = false
        transport.result.completeExceptionally(VoiceFailure(401)); runCurrent()
        assertFalse(received); assertEquals(0, expires); assertFalse(take.file.exists())
    }
    @Test fun permissionResponseAfterWorkspaceChangeCannotStartRecorder() = runTest {
        var current = true; var starts = 0
        val input = VoiceInput(VoiceServices(Settings(), Transport(), { starts++; Take() }), backgroundScope,
            VoiceAccess("fixture-token", "A", { current })) {}
        input.awaitingPermission(); current = false; input.permissionResult(true)
        assertEquals(0, starts); assertEquals(VoiceInput.Phase.Idle, input.phase)
    }
    @Test fun appendPreservesDraftWhitespaceAndIgnoresEmptyTranscription() {
        assertEquals("hello world", appendDictation("hello", " world "))
        assertEquals("hello\nworld", appendDictation("hello\n", "world"))
        assertEquals("hello ", appendDictation("hello ", "  "))
    }
}
