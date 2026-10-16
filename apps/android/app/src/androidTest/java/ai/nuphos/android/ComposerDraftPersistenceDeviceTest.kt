package ai.nuphos.android

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.nuphos.android.data.ComposerDraftPreferences
import ai.nuphos.android.session.ComposerDrafts
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ComposerDraftPersistenceDeviceTest {
    @Test fun preferencesRestoreTextAndDeletionAcrossStoreReconstruction() {
        // A dedicated fixture file, separate from the installed account and its drafts.
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val prefs = context.getSharedPreferences("draft-persistence-fixture", Context.MODE_PRIVATE)
        prefs.edit().clear().commit()
        try {
            val first = ComposerDrafts(ComposerDraftPreferences(prefs))
            first.bind("a", "t", ComposerDrafts.Destination.NewChat)!!.write(" new draft ")
            first.bind("a", "t", ComposerDrafts.Destination.Chat("one"))!!.write("existing")
            assertTrue(prefs.edit().commit())
            val restored = ComposerDrafts(ComposerDraftPreferences(prefs))
            restored.onIdentity("a")
            val fresh = restored.bind("a", "t", ComposerDrafts.Destination.NewChat)!!
            assertEquals(" new draft ", fresh.text)
            assertEquals("existing", restored.bind("a", "t", ComposerDrafts.Destination.Chat("one"))!!.text)
            fresh.submitted(true, " new draft ")
            val next = ComposerDrafts(ComposerDraftPreferences(prefs))
            next.onIdentity("a")
            assertEquals("", next.bind("a", "t", ComposerDrafts.Destination.NewChat)!!.text)
            assertEquals("existing", next.bind("a", "t", ComposerDrafts.Destination.Chat("one"))!!.text)
            next.clear()
            assertTrue(prefs.all.isEmpty())
        } finally { prefs.edit().clear().commit() }
    }
}
