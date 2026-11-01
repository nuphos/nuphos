package ai.nuphos.android.voice

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** One take at a time; cancellation invalidates permission and late network results. */
class VoiceInput(private val services: VoiceServices, private val scope: CoroutineScope, private val access: VoiceAccess, private val onText: (String) -> Unit) {
    enum class Phase { Idle, Permission, Recording, Transcribing }
    var phase by mutableStateOf(Phase.Idle); private set
    var levels by mutableStateOf<List<Float>>(emptyList()); private set
    var seconds by mutableStateOf(0); private set
    var error by mutableStateOf<String?>(null)
    private var take: VoiceTake? = null
    private var job: Job? = null
    private var generation = 0
    val available get() = access.current()
    val active get() = phase != Phase.Idle
    fun awaitingPermission() { if (!active && access.current()) { error = null; phase = Phase.Permission } }
    fun permissionResult(granted: Boolean) {
        if (phase != Phase.Permission) return
        if (!access.current()) { cancel(); return }
        if (!granted) { cancel(); error = "Allow microphone access for Nuphos in Android Settings to use voice input."; return }
        try {
            val recording = services.newTake()
            take = recording
            recording.start()
            phase = Phase.Recording
            seconds = 0
            levels = emptyList()
            job = scope.launch {
                val startedAt = System.nanoTime()
                try {
                    while (true) {
                        levels = (levels + recording.level()).takeLast(100)
                        delay(60)
                        seconds = ((System.nanoTime() - startedAt) / 1_000_000_000).toInt()
                    }
                } catch (e: CancellationException) { throw e }
                catch (_: Exception) { cancel(); error = "Recording interrupted or limit reached. Please try a shorter message." }
            }
        } catch (_: Exception) { cancel(); error = "Could not start recording. Check microphone access and try again." }
    }
    fun finish() {
        if (phase != Phase.Recording) return
        if (!access.current()) { cancel(); return }
        val recording = take ?: return
        phase = Phase.Transcribing // Set synchronously so a double tap cannot upload twice.
        job?.cancel()
        val current = generation
        job = scope.launch {
            var file: File? = null
            try {
                file = recording.stop()
                val prompt = services.settings.prompt
                val reply = services.transport.transcribe(file, access.token, access.teamId, prompt)
                val words = if (reply.language == "chinese") withContext(Dispatchers.Default) {
                    services.traditional(reply.text)
                } else reply.text
                ensureActive()
                if (current == generation && access.current()) onText(words)
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                if (current == generation && access.current()) {
                    error = if (e is VoiceFailure) e.message else "Voice input failed. Check your connection and try again."
                    if (e is VoiceFailure && e.status == 401) access.unauthorized()
                }

            } finally {
                file?.delete()
                recording.cancel()
                if (current == generation) { take = null; phase = Phase.Idle }
            }
        }
    }
    fun cancel() {
        generation++
        job?.cancel(); job = null
        take?.cancel(); take = null
        phase = Phase.Idle
        levels = emptyList()
    }
}
