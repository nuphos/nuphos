package ai.nuphos.android.voice

import android.content.Context
import android.icu.text.Transliterator
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.io.File

const val DEFAULT_WHISPER_PROMPT = "Nuphos, Zeabur, Claude Code, Codex, Kubernetes, kubectl, Helm, EKS, GKE, AWS, GCP, Cloudflare, Grafana, Linear, GitHub, PR, CI."

interface VoiceSettings {
    var prompt: String
}

/** Provider keys are retired without reading or copying their value. Prompt storage stays separate. */
class DeviceVoiceSettings(context: Context) : VoiceSettings {
    private val app = context.applicationContext
    init {
        // Opening an existing encrypted store only to remove the named entry never reads the key.
        // If the old keystore is unavailable, leave its encrypted blob dormant; it is never used.
        if (File(app.applicationInfo.dataDir, "shared_prefs/nuphos.voice.xml").exists()) runCatching {
            val old = EncryptedSharedPreferences.create(app, "nuphos.voice",
                MasterKey.Builder(app).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
            check(old.edit().remove("openai-key").commit())
        }
    }
    private val promptPrefs by lazy { app.getSharedPreferences("nuphos.voice-prompt", Context.MODE_PRIVATE) }
    override var prompt: String
        get() = promptPrefs.getString("prompt", DEFAULT_WHISPER_PROMPT) ?: DEFAULT_WHISPER_PROMPT
        set(value) { check(promptPrefs.edit().putString("prompt", value).commit()) { "Could not save the prompt." } }
}

/** Captures a single account/workspace permission context; never prints its bearer. */
class VoiceAccess(val token: String, val teamId: String, val current: () -> Boolean, val unauthorized: () -> Unit = {})

interface VoiceTake {
    fun start()
    fun level(): Float
    fun stop(): File
    fun cancel()
}

class VoiceServices(
    val settings: VoiceSettings,
    val transport: WhisperTransport,
    val newTake: () -> VoiceTake,
    val traditional: (String) -> String = { Transliterator.getInstance("Hans-Hant").transliterate(it) },
    val microphonePermissionGranted: () -> Boolean = { false },
)

// Fixtures inject their own settings, recorder and transport, without accessing real keys.
val LocalVoiceServices = staticCompositionLocalOf<VoiceServices?> { null }

fun deviceVoiceServices(context: Context): VoiceServices = VoiceServices(
    DeviceVoiceSettings(context), NuphosWhisperTransport(), { MicrophoneTake(context.applicationContext) },
    microphonePermissionGranted = {
        androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED
    },
)

fun appendDictation(draft: String, words: String): String {
    val clean = words.trim()
    if (clean.isEmpty()) return draft
    return draft + (if (draft.isEmpty() || draft.last().isWhitespace()) "" else " ") + clean
}
