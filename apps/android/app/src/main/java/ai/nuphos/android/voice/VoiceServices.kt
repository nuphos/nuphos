package ai.nuphos.android.voice

import android.content.Context
import android.icu.text.Transliterator
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.io.File

const val DEFAULT_WHISPER_PROMPT = "Nuphos, Zeabur, Claude Code, Codex, Kubernetes, kubectl, Helm, EKS, GKE, AWS, GCP, Cloudflare, Grafana, Linear, GitHub, PR, CI."

interface VoiceSettings {
    fun key(): String?
    fun saveKey(value: String)
    fun removeKey()
    var prompt: String
}

/** Fail closed: BYOK keys never fall back to ordinary preferences. */
class DeviceVoiceSettings(context: Context) : VoiceSettings {
    private val app = context.applicationContext
    private val prefs by lazy {
        EncryptedSharedPreferences.create(app, "nuphos.voice",
            MasterKey.Builder(app).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
    }
    override fun key(): String? = prefs.getString("openai-key", null)
    override fun saveKey(value: String) { check(prefs.edit().putString("openai-key", value).commit()) { "Could not securely save the API key." } }
    override fun removeKey() { check(prefs.edit().remove("openai-key").commit()) { "Could not remove the API key." } }
    private val promptPrefs by lazy { app.getSharedPreferences("nuphos.voice-prompt", Context.MODE_PRIVATE) }
    override var prompt: String
        get() = promptPrefs.getString("prompt", DEFAULT_WHISPER_PROMPT) ?: DEFAULT_WHISPER_PROMPT
        set(value) { check(promptPrefs.edit().putString("prompt", value).commit()) { "Could not save the prompt." } }
}

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
    DeviceVoiceSettings(context), OpenAIWhisperTransport(), { MicrophoneTake(context.applicationContext) },
    microphonePermissionGranted = {
        androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED
    },
)

fun appendDictation(draft: String, words: String): String {
    val clean = words.trim()
    if (clean.isEmpty()) return draft
    return draft + (if (draft.isEmpty() || draft.last().isWhitespace()) "" else " ") + clean
}
