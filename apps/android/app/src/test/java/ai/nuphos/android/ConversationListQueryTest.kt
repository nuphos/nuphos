package ai.nuphos.android

import ai.nuphos.android.data.NuphosApi
import org.junit.Assert.*
import org.junit.Test

/** The Agents list matches iOS: own chats, recent activity first, archived excluded. */
class ConversationListQueryTest {
    @Test fun agentsListUsesTheFixedIosSelectors() {
        val query = NuphosApi.conversationQuery("team", cursor = "opaque-server-cursor", search = "needle").toMap()
        assertEquals("activity", query["sort"])
        assertEquals("mine", query["scope"])
        assertEquals("exclude", query["archived"])
        assertEquals("opaque-server-cursor", query["cursor"])
        assertEquals("needle", query["search"])
    }

}
