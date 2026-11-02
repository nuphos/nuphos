package ai.nuphos.android

import ai.nuphos.android.model.*
import org.junit.Assert.*
import org.junit.Test

class SenderIdentityTest {
    private val base = "https://api.nuphos.ai"
    private val path = "/avatars/" + "a".repeat(24) + "/" + "b".repeat(64) + ".webp"
    private val me = MessageAttribution("me", "Maya 林 / A very long name", "user", "nuphos")

    @Test fun imagesOnlyLoadFromExplicitTrustedSources() {
        assertEquals(base + path, SenderAvatar.trusted(base + path, base))
        assertEquals("https://lh3.googleusercontent.com/photo?s=40", SenderAvatar.trusted("https://lh3.googleusercontent.com/photo?s=40", base))
        for (url in listOf("http://api.nuphos.ai$path", "https://api.nuphos.ai.evil.test$path",
            "https://user@api.nuphos.ai$path", "$base$path?token=1", "$base$path#x",
            "$base:443$path", "$base/avatars/other/photo.webp", "https://lh3.googleusercontent.com:444/x",
            "https://lh3.googleusercontent.com.evil.test/x", "https://evil.test/x", "$base/avatars/%61/photo.webp"))
            assertNull(url, SenderAvatar.trusted(url, base))
    }

    @Test fun verifiedMetadataKeepsIdentityWhenAvatarIsRejected() {
        fun meta(avatar: String) = ai.nuphos.android.data.JsonValue.parse("""{"version":1,"source":"nuphos","sentAt":"2026-11-02T00:00:00Z","sender":{"id":"maya","displayName":"Maya 林","type":"user","avatarURL":"$avatar"}}""")
        assertEquals(base + path, MessageAttribution.parse(meta(base + path))?.avatarURL)
        val rejected = MessageAttribution.parse(meta("https://other.example.invalid/photo.png"))!!
        assertEquals("Maya 林", rejected.label)
        assertNull(rejected.avatarURL)
        assertNull(MessageAttribution.parse(meta(base + path)?.let { ai.nuphos.android.data.JsonValue.parse(it.compact.replace("user", "system")) }))
    }

    @Test fun onlyRecordedMessagesInTheSameOwnerScopeHaveFallback() {
        val local = LocalMessageSenders()
        local.bind("account/team/consent1")
        local.record("sent", "account/team/consent1", me)
        assertEquals(me, local.sender("sent", "account/team/consent1"))
        assertNull(local.sender("history", "account/team/consent1"))
        assertNull(local.sender("sent", "other/team/consent1"))
        local.bind("account/team/consent2")
        assertNull(local.sender("sent", "account/team/consent2"))
        local.record("late", "account/team/consent1", me)
        assertNull(local.sender("late", "account/team/consent2"))
        local.record("bot", "account/team/consent2", me.copy(type = "agent"))
        assertNull(local.sender("bot", "account/team/consent2"))
        local.clear()
        assertNull(local.sender("sent", "account/team/consent1"))
    }

    @Test fun fallbackNeverReplacesPresentInvalidMetadataOrChangesTheWireMessage() {
        val original = ChatMessage(id = "sent", role = ChatMessage.Role.User, parts = listOf(ChatPart.Text(text = "Hello")))
        assertEquals(me, ChatRow.rows(listOf(original), localSender = { me }).filterIsInstance<ChatRow.User>().single().sender)
        val invalid = original.copy(metadata = ai.nuphos.android.data.JsonValue.parse("""{"version":2}"""))
        assertNull(ChatRow.rows(listOf(invalid), localSender = { me }).filterIsInstance<ChatRow.User>().single().sender)
        assertNull(original.metadata)
        assertNull(original.forWire.metadata)
    }
}
