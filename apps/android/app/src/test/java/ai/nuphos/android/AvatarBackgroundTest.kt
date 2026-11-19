package ai.nuphos.android

import ai.nuphos.android.data.Http
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.BotFaces
import ai.nuphos.android.model.ChannelAgent
import ai.nuphos.android.ui.theme.avatarBackground
import androidx.compose.ui.graphics.Color
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** A Bot's avatar background (#3515): the tint name the backend stores, learned with its face. */
class AvatarBackgroundTest {
    @After fun forget() { listOf("bot", "member", "agent").forEach { BotFaces.learn(it, null) } }

    @Test fun theTintIsLearnedWithTheFaceFromRowsChatFacesAndChatAgents() {
        val rows = Http.json.decodeFromString<List<AgentConversation>>(
            """[{"sessionId":"bot","avatar":"07-ada","avatarBackground":"sky"},
                {"sessionId":"chat","kind":"channel","faces":[{"id":"member","name":"M","agent":{"avatar":"05-rembrandt","avatarBackground":"mint"}}]}]""",
        )
        BotFaces.learn(rows)
        assertEquals("sky", BotFaces.background("bot"))
        assertEquals("mint", BotFaces.background("member"))
        val agent = Http.json.decodeFromString<ChannelAgent>("""{"sessionId":"agent","avatar":"09-frida","avatarBackground":"rose"}""")
        BotFaces.learn(agent.sessionId, agent.avatar, agent.avatarBackground)
        assertEquals("rose", BotFaces.background("agent"))
    }

    @Test fun noneAnOlderServerOrATaskHasNoTint() {
        BotFaces.learn(listOf(Http.json.decodeFromString<AgentConversation>("""{"sessionId":"bot","avatar":"07-ada"}""")))
        assertNull(BotFaces.background("bot"))
        BotFaces.learn("bot", "07-ada", "sky")
        // Taking the face away makes it a Task, which has no background.
        BotFaces.learn("bot", null, "sky")
        assertNull(BotFaces.background("bot"))
    }

    @Test fun eachTintIsItsDesignTokenTheSameInBothThemes() {
        val tokens = mapOf(
            "sand" to 0xFFF2E7D3, "peach" to 0xFFF8DCCB, "rose" to 0xFFF6D5DE, "lilac" to 0xFFE5DCF5,
            "sky" to 0xFFD6E6F7, "mint" to 0xFFD3EEDF, "sage" to 0xFFE1E9D1, "slate" to 0xFFE1E4EA,
        )
        for ((name, hex) in tokens) assertEquals(name, Color(hex), avatarBackground(name))
        for (name in listOf(null, "", "none", "teal")) assertNull(name, avatarBackground(name))
    }
}
