package ai.nuphos.android

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.nuphos.android.ui.home.AdaptiveHomePanes
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.Channel
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AdaptivePanesFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()

    @Test fun collapsingWhileLoadingKeepsSelectionDraftAndLoadJob() {
        val wide = mutableStateOf(true)
        val showDetail = mutableStateOf(true)
        val response = CompletableDeferred<String>()
        val stream = Channel<String>(Channel.UNLIMITED)
        var loads = 0
        var cancellations = 0
        compose.setContent {
            MaterialTheme {
                AdaptiveHomePanes(wide.value, showDetail.value,
                    listPane = { Text("Synthetic history", Modifier.testTag("history")) },
                    detailPane = {
                        var draft by rememberSaveable { mutableStateOf("Synthetic draft") }
                        var text by remember { mutableStateOf("Loading selected chat") }
                        LaunchedEffect(Unit) {
                            loads++
                            try {
                                text = response.await()
                                for (event in stream) text = event
                            } finally { cancellations++ }
                        }
                        Column(Modifier.fillMaxSize()) {
                            Text(text)
                            TextField(draft, { draft = it }, Modifier.testTag("draft"))
                        }
                    })
            }
        }
        compose.onNodeWithTag("draft").performTextReplacement("Draft survives collapse")
        compose.runOnIdle { wide.value = false }
        compose.onNodeWithTag("history").assertIsNotDisplayed()
        compose.onNodeWithTag("draft").assertTextEquals("Draft survives collapse")
        compose.runOnIdle { response.complete("Loaded selected chat") }
        compose.waitUntil { compose.onAllNodesWithText("Loaded selected chat").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Loaded selected chat").assertIsDisplayed()
        compose.runOnIdle { wide.value = true }
        compose.onNodeWithTag("history").assertIsDisplayed()
        compose.onNodeWithTag("draft").assertTextEquals("Draft survives collapse")
        compose.runOnIdle { assertEquals(1, loads); assertEquals(0, cancellations); wide.value = false }
        compose.runOnIdle { stream.trySend("Streaming update after collapse").getOrThrow() }
        compose.waitUntil { compose.onAllNodesWithText("Streaming update after collapse").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Streaming update after collapse").assertIsDisplayed()
        compose.runOnIdle { wide.value = false; showDetail.value = false }
        compose.onNodeWithTag("history").assertIsDisplayed()
        compose.onNodeWithTag("draft").assertIsNotDisplayed()
        compose.runOnIdle { showDetail.value = true }
        compose.onNodeWithText("Streaming update after collapse").assertIsDisplayed()
        compose.runOnIdle { assertEquals(1, loads); assertEquals(0, cancellations) }
    }
}
