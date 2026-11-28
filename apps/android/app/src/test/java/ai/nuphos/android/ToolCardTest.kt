package ai.nuphos.android

import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.ChannelItem
import ai.nuphos.android.model.ChannelPost
import ai.nuphos.android.model.ChatMessage
import ai.nuphos.android.model.ChatPart
import ai.nuphos.android.model.ChatRow
import ai.nuphos.android.model.ToolCard
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** render_artifact and render_chart are cards, never folded into Worked or a run of tools (#5272). */
class ToolCardTest {
    private val artifact = ChatPart.Tool("art", "render_artifact", false, ChatPart.Tool.State.OutputAvailable,
        input = JsonValue.parse("""{"title":"Lisbon itinerary","kind":"html","content":"<h1>Lisbon</h1>"}"""))
    private val chartJson = JsonValue.parse("""{"type":"bar","title":"Trip budget","xKey":"item","series":[{"key":"eur"}],"data":[{"item":"Hotel","eur":240}]}""")
    private val chart = ChatPart.Tool("chart", "render_chart", false, ChatPart.Tool.State.OutputAvailable, input = chartJson, output = chartJson)
    private fun terminal(id: String) = ChatPart.Tool(id, "terminal", false, ChatPart.Tool.State.OutputAvailable)

    @Test fun parsesBothTools() {
        assertEquals(ToolCard.Artifact("art", "Lisbon itinerary", "html", "<h1>Lisbon</h1>"), ToolCard.from(artifact))
        val card = ToolCard.from(chart) as ToolCard.Chart
        assertEquals(listOf("eur" to "eur"), card.series)
        assertNull(ToolCard.from(chart.copy(state = ChatPart.Tool.State.OutputError)))
        assertNull(ToolCard.from(terminal("t")))
    }

    @Test fun cardsStayOutOfWorkedAndToolRuns() {
        val message = ChatMessage(id = "m", parts = listOf(
            ChatPart.Text(text = "Let me look."), terminal("a"), artifact, chart, terminal("b"), ChatPart.Text(text = "Opened them beside the chat."),
        ))
        val rows = ChatRow.rows(listOf(message))
        val top = rows.filterIsInstance<ChatRow.Tool>().map { it.part.toolCallId }
        assertEquals(listOf("art", "chart"), top)
        val nested = rows.flatMap { row -> (row as? ChatRow.Work)?.rows.orEmpty() + (row as? ChatRow.ToolRun)?.rows.orEmpty() }
        assertTrue(nested.none { it is ChatRow.Tool && ToolCard.from(it.part) != null })
    }

    @Test fun aBotsCardsSitInTheChatByTime() {
        val card = ToolCard.from(artifact)!!
        val items = ChannelPost.items(emptyList(), emptyList(), emptyList(), cards = listOf(Instant.parse("2026-11-08T09:55:30Z") to card))
        assertEquals(listOf(ChannelItem.Card(card)), items)
    }
}
