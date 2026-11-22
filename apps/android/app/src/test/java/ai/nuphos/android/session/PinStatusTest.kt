package ai.nuphos.android.session

import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.InputRequest
import ai.nuphos.android.ui.chats.PinStatus
import ai.nuphos.android.ui.chats.pinStatus
import org.junit.Assert.*
import org.junit.Test

class PinStatusTest {
    private val bot = AgentConversation("bot", avatar = "07-ada", agentRuntime = "codex", unread = JsonValue.Bool(true))
    @Test fun directTaskQuestionWinsOverRunningBotAndUnreadReply() {
        val running = bot.copy(runtimeState = JsonValue.parse("""{"state":"active","phase":"working"}"""))
        val task = AgentConversation("task", parentSessionId = "bot", inputRequests = listOf(InputRequest("question")))
        assertEquals(PinStatus.Waiting, pinStatus(running, listOf(running, task)))
        assertEquals(PinStatus.Running, pinStatus(running, listOf(running)))
        assertEquals(PinStatus.Unread, pinStatus(bot, listOf(bot)))
    }

    @Test fun onboardingPreferenceAndOtherBotsQuestionsDoNotAskForInputHere() {
        val onboarding = bot.copy(botOnboarding = "active", inputRequests = listOf(InputRequest("pref", category = "preference")))
        val other = AgentConversation("other", avatar = "05-rembrandt", parentSessionId = "bot", inputRequests = listOf(InputRequest("other")))
        assertEquals(PinStatus.Unread, pinStatus(onboarding, listOf(onboarding, other)))
        assertNull(pinStatus(bot.copy(unread = JsonValue.Bool(false)), listOf(other)))
    }

    @Test fun disconnectedNativeRuntimeDoesNotShowAnOldActiveRunAsRunning() {
        val disconnected = bot.copy(runtimeState = JsonValue.parse("""{"state":"active","phase":"resume_disconnected"}"""),
            activeRun = JsonValue.obj("streamId" to JsonValue.Str("old")))
        assertEquals(PinStatus.Unread, pinStatus(disconnected, listOf(disconnected)))
        val backend = disconnected.copy(agentRuntime = "nuphos")
        assertEquals(PinStatus.Running, pinStatus(backend, listOf(backend)))
    }
}
