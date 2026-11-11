package ai.nuphos.android

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.voice.DEFAULT_WHISPER_PROMPT
import ai.nuphos.android.voice.DeviceVoiceSettings
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

/** The transcription prompt as the device stores it. No login, key, audio or network. */
@RunWith(AndroidJUnit4::class)
class VoicePromptDeviceTest {
    /** The stored prompt: the default until one is saved, then what was saved, for the next reader too. */
    @Test fun storedPromptIsTheDefaultUntilEdited() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val prefs = context.getSharedPreferences("nuphos.voice-prompt", Context.MODE_PRIVATE)
        val saved = prefs.getString("prompt", null)
        try {
            check(prefs.edit().clear().commit())
            assertEquals(DEFAULT_WHISPER_PROMPT, DeviceVoiceSettings(context).prompt)
            DeviceVoiceSettings(context).prompt = "Fixture vocabulary"
            assertEquals("Fixture vocabulary", DeviceVoiceSettings(context).prompt)
        } finally {
            prefs.edit().apply { if (saved == null) clear() else putString("prompt", saved) }.commit()
        }
    }
}
