package ai.nuphos.android

import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.ui.chat.TaskSummaryWork
import ai.nuphos.android.ui.chat.taskSummaryBackground
import ai.nuphos.android.ui.chat.pollTaskSummary
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class TaskSummaryWorkTest {
    @Test fun listsRunningTerminalsAndUnfinishedAsyncTasksOnce() {
        val snapshot = JsonValue.parse("""
            {
              "tools": [
                {"id":"terminal","terminal":{"status":"running","command":"gradle check","output":"Checking"}},
                {"id":"ended","terminal":{"status":"completed","command":"old command"}}
              ],
              "asyncTasks": {
                "same":{"toolCallId":"terminal","state":"running"},
                "worker":{"id":"worker","name":"Read the logs","state":"running"},
                "finished":{"name":"Finished work","state":"completed"}
              }
            }
        """.trimIndent())

        assertEquals(
            listOf(TaskSummaryWork("terminal", "gradle check", "Checking"), TaskSummaryWork("worker", "Read the logs")),
            taskSummaryBackground(snapshot),
        )
    }
    @Test fun longTerminalOutputKeepsTheTailAndMarksItTruncated() {
        fun work(output: String) = taskSummaryBackground(JsonValue.obj(
            "tools" to JsonValue.Arr(listOf(JsonValue.obj(
                "id" to JsonValue.Str("terminal"),
                "terminal" to JsonValue.obj(
                    "status" to JsonValue.Str("running"),
                    "output" to JsonValue.Str(output),
                ),
            ))),
        )).single()

        val tail = "x".repeat(5_999)
        assertEquals(TaskSummaryWork("terminal", null, tail), work(tail))
        assertEquals(TaskSummaryWork("terminal", null, tail, outputTruncated = true), work("prefix😀" + tail))
    }

    @Test fun revokingConsentDuringAReadStopsTheRemainingRequests() = runTest {
        var consent = true
        val requests = mutableListOf<String>()
        launch {
            pollTaskSummary({ consent },
                { requests += "questions"; delay(100) },
                { requests += "resources" },
                { requests += "downloads" },
                { requests += "triggers" },
            )
        }
        delay(50)
        consent = false
        delay(40_000)
        assertEquals(listOf("questions"), requests)
    }

    @Test fun switchingTeamsBetweenPollsPreventsTheNextPoll() = runTest {
        var selectedTeam = "A"
        val requests = mutableListOf<String>()
        launch {
            pollTaskSummary({ selectedTeam == "A" },
                { requests += "questions" },
                { requests += "resources" },
                { requests += "downloads" },
                { requests += "triggers" },
            )
        }
        delay(100)
        selectedTeam = "B"
        delay(40_000)
        assertEquals(listOf("questions", "resources", "downloads", "triggers"), requests)
    }
}
