package ai.nuphos.android

import ai.nuphos.android.data.AgentChatApi
import ai.nuphos.android.model.ChatTime
import ai.nuphos.android.model.Words
import android.content.Context
import android.content.res.Configuration
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.time.Instant
import java.util.Locale
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import org.junit.runner.RunWith

/** Text built outside Compose follows the app language: each locale reads its own translation. */
@RunWith(AndroidJUnit4::class)
class WordsLocaleDeviceTest {
    private val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
    private val saved = Words.context

    @After fun restore() { Words.context = saved }

    private fun inLocale(tag: String): Context =
        app.createConfigurationContext(Configuration(app.resources.configuration).apply { setLocale(Locale.forLanguageTag(tag)) })

    @Test fun relativeTimesAndErrorsAreTranslated() {
        val now = Instant.now()
        for (tag in listOf("zh-TW", "ja")) {
            val context = inLocale(tag)
            Words.context = context
            assertEquals(context.getString(R.string.convtext_just_now), ChatTime.label(now, now))
            assertNotEquals("Just now", ChatTime.label(now, now))
            assertEquals(context.getString(R.string.convtext_conflict_busy), AgentChatApi.Conflict.ConversationBusy.message)
            assertNotEquals("This task is busy with another reply.", AgentChatApi.Conflict.ConversationBusy.message)
        }
    }
}
