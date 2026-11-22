package ai.nuphos.android.chats

import ai.nuphos.android.data.Http
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.session.AgentStore.TaskState
import ai.nuphos.android.ui.chats.botStateCounts
import org.junit.Assert.*
import org.junit.Test

/** The line under a Bot's name counts its Tasks for someone it is shared with too (#4278). */
class BotStateTest {
    private fun bot(tasks: String?) = Http.json.decodeFromString<AgentConversation>(
        """{"sessionId":"bot","avatar":"05-rembrandt"${tasks?.let { ",\"tasks\":$it" } ?: ""}}""")

    @Test fun aSharedBotWhoseTasksTheViewerDoesNotListSaysHowManyRun() {
        assertEquals(0 to 1, botStateCounts(emptyList(), bot("""{"running":1,"waiting":1}""")))
    }

    @Test fun theViewersOwnBotCountsTheTasksTheyList() {
        val states = listOf(TaskState.Waiting, TaskState.Running, TaskState.Idle)
        assertEquals(1 to 1, botStateCounts(states, bot("""{"running":3,"waiting":2}""")))
    }

    @Test fun nothingRunsWithoutCountsOrABotRow() {
        assertEquals(0 to 0, botStateCounts(emptyList(), bot(null)))
        assertEquals(0 to 0, botStateCounts(emptyList(), null))
    }
}
