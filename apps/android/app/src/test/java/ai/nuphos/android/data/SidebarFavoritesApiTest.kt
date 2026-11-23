package ai.nuphos.android.data

import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class SidebarFavoritesApiTest {
    @Test fun readsTeamScopedFavoritesAndWritesRevisionWithoutNullIdentityFields() = runTest {
        val saved = SidebarFavoritesApi.read("synthetic", "team /+") { method, path, token, query, body ->
            assertEquals("GET", method)
            assertEquals("teams/team%20%2F%2B/favorites", path)
            assertEquals("synthetic", token)
            assertTrue(query.isEmpty()); assertNull(body)
            """{"entries":[{"label":"Task","key":"agent-session:task"},{"label":"Docs","href":"/docs"}],"revision":9,"updatedAt":null}"""
        }
        SidebarFavoritesApi.write("synthetic", "team /+", saved) { method, path, _, query, body ->
            assertEquals("PUT", method)
            assertEquals("teams/team%20%2F%2B/favorites", path)
            assertTrue(query.isEmpty())
            assertEquals(9.0, body?.get("expectedRevision")?.numberValue)
            assertEquals(setOf("label", "key"), body?.get("entries")?.get(0)?.objectValue?.keys)
            assertEquals(setOf("label", "href"), body?.get("entries")?.get(1)?.objectValue?.keys)
            "{}"
        }
    }

    @Test fun sessionIdentitiesMatchDesktopAndIosWithoutTreatingOtherLinksAsPins() {
        fun id(href: String) = SidebarFavorites.Entry("row", href = href).sessionId
        assertEquals("a+b /", id("/teams/team/agent/a%2Bb%20%2F"))
        assertEquals("a+b", id("https://nuphos.ai/teams/team/agent/a+b?x=1#post"))
        assertEquals("chat", SidebarFavorites.Entry("row", key = "agent-session:chat").sessionId)
        for (href in listOf("/docs", "/teams//agent/chat", "/teams/team/agent/", "/teams/team/agent/chat/extra", "%"))
            assertNull(href, id(href))
        assertNull(SidebarFavorites.Entry("row", key = "agent-session:").sessionId)
    }

    @Test fun pinEditsPreserveLegacyAndUnknownFavoritesAndReplaceBothSessionIdentities() {
        val legacy = SidebarFavorites.Entry("Task", key = "agent-session:task")
        val docs = SidebarFavorites.Entry("Docs", href = "/docs")
        val original = SidebarFavorites(listOf(legacy, docs,
            SidebarFavorites.Entry("old", key = "agent-session:bot"),
            SidebarFavorites.Entry("old", href = "/teams/team/agent/bot")), 4)
        val pinned = original.settingPinned("team", "bot", "New", true)
        assertEquals(listOf(legacy, docs), pinned.entries.take(2))
        assertEquals(listOf("task", null, "bot"), pinned.entries.map { it.sessionId })
        assertEquals(4L, pinned.revision)
        assertEquals(listOf(legacy, docs), pinned.settingPinned("team", "bot", "New", false).entries)
    }
}
