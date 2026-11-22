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
}
