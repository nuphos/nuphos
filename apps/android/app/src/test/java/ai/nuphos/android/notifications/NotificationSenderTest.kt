package ai.nuphos.android.notifications

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NotificationSenderTest {
    @Test fun botPushNamesItsBundledFace() {
        assertEquals(NotificationSender("Ada", "07-ada.svg"), NotificationSender.from(mapOf("botAvatar" to "07-ada", "title" to " Ada ")))
    }

    @Test fun unknownMissingOrNamelessFacesStayPlain() {
        assertNull(NotificationSender.from(mapOf("title" to "Ada")))
        assertNull(NotificationSender.from(mapOf("botAvatar" to "99-nobody", "title" to "Ada")))
        assertNull(NotificationSender.from(mapOf("botAvatar" to "../07-ada", "title" to "Ada")))
        assertNull(NotificationSender.from(mapOf("botAvatar" to "07-ada")))
        assertNull(NotificationSender.from(mapOf("botAvatar" to "07-ada", "title" to "  ")))
    }

    @Test fun botPushCarriesItsBackgroundAndRuntime() {
        assertEquals(NotificationSender("Ada", "07-ada.svg", "codex", "mint"), NotificationSender.from(
            mapOf("botAvatar" to "07-ada", "title" to "Ada", "botBackground" to "mint", "botProvider" to "codex")))
    }

    // An unknown tint is kept and painted white; an unknown runtime has no mark to show.
    @Test fun unknownRuntimeLogoIsDropped() {
        assertEquals(NotificationSender("Ada", "07-ada.svg", background = "neon"), NotificationSender.from(
            mapOf("botAvatar" to "07-ada", "title" to "Ada", "botBackground" to "neon", "botProvider" to "nuphos")))
    }

    @Test fun taskPushWearsItsRuntimeMark() {
        assertEquals(NotificationSender("Fix login", null, "claude-code"), NotificationSender.from(
            mapOf("title" to "Fix login", "taskProvider" to "claude-code")))
    }

    @Test fun taskWithoutKnownRuntimeOrUnknownBotFaceStaysPlain() {
        assertNull(NotificationSender.from(mapOf("title" to "Fix login", "taskProvider" to "nuphos")))
        assertNull(NotificationSender.from(mapOf("title" to "  ", "taskProvider" to "codex")))
        // A Bot whose face this build lacks never falls back to the Task mark.
        assertNull(NotificationSender.from(mapOf("botAvatar" to "99-nobody", "title" to "Ada", "taskProvider" to "codex")))
    }
}
