package ai.nuphos.android.voice

import android.content.Context
import android.media.MediaRecorder
import java.io.File
import java.io.IOException

/** A private, bounded AAC take. No microphone service or background recording. */
class MicrophoneTake(private val context: Context) : VoiceTake {
    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var interrupted = false
    override fun start() {
        check(recorder == null)
        if (androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            throw IOException("Allow microphone access for Nuphos in Android Settings to use voice input.")
        }
        val audio = File.createTempFile("dictation-", ".m4a", context.cacheDir)
        file = audio
        val media = MediaRecorder(context)
        recorder = media
        try {
            media.setAudioSource(MediaRecorder.AudioSource.MIC)
            media.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            media.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            media.setAudioSamplingRate(16_000)
            media.setAudioChannels(1)
            media.setAudioEncodingBitRate(64_000)
            media.setOutputFile(audio.absolutePath)
            media.setMaxDuration(10 * 60 * 1000)
            media.setMaxFileSize(OpenAIWhisperTransport.MAX_AUDIO_BYTES)
            media.setOnErrorListener { _, _, _ -> interrupted = true }
            media.setOnInfoListener { _, what, _ ->
                if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED ||
                    what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) interrupted = true
            }
            media.prepare()
            media.start()
        } catch (e: Exception) { cancel(); throw IOException("Could not start the microphone. Check microphone access and try again.", e) }
    }
    override fun level(): Float {
        if (interrupted) throw IOException("Recording interrupted or limit reached. Please record a shorter message.")
        return ((recorder?.maxAmplitude ?: 0) / 32767f).coerceIn(0f, 1f)
    }
    override fun stop(): File {
        val media = recorder ?: throw IOException("Recording has ended.")
        try {
            if (interrupted) throw IOException("Recording interrupted or limit reached.")
            media.stop()
            return requireNotNull(file)
        } catch (e: Exception) { file?.delete(); throw IOException("The recording was too short or interrupted. Try again.", e) }
        finally { media.release(); recorder = null }
    }
    override fun cancel() {
        recorder?.let { runCatching { it.stop() }; it.release() }
        recorder = null
        file?.delete()
        file = null
    }
}
