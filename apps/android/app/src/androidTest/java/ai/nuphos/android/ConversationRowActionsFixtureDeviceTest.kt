package ai.nuphos.android

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.test.espresso.Espresso
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.session.ConversationNesting
import ai.nuphos.android.ui.agent.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Local Compose content only. No credentials, real chats, or network transport. */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class ConversationRowActionsFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val interactions = ConversationRowInteractions()
    private var opens = 0
    private var expands = 0
    private var writes = 0
    private val busy = mutableStateOf(false)
    private val width = mutableStateOf(390)

    private fun render(rtl: Boolean = false, large: Boolean = false, keyboard: Boolean = false) {
        compose.setContent {
            DeviceConfigurationOverride(DeviceConfigurationOverride.ForcedSize(DpSize(width.value.dp, 900.dp))) {
                val inputMode = LocalInputModeManager.current
                SideEffect { if (keyboard) inputMode.requestInputMode(InputMode.Keyboard) }
                val density = LocalDensity.current
                CompositionLocalProvider(
                    LocalLayoutDirection provides if (rtl) LayoutDirection.Rtl else LayoutDirection.Ltr,
                    LocalDensity provides Density(density.density, if (large) 2f else 1f),
                ) {
                    MaterialTheme {
                        Surface(Modifier.fillMaxSize()) {
                            Column(Modifier.fillMaxSize().systemBarsPadding().padding(8.dp)
                                .dismissRowActionsOnOutsidePress(interactions)) {
                                Text("Synthetic conversation actions")
                                for (id in listOf("parent", "child")) {
                                    ConversationTreeRow(
                                        ConversationNesting.Row(AgentConversation(id, "fixture", "Synthetic $id conversation",
                                            watching = true, isOwner = true, parentSessionId = if (id == "child") "parent" else null),
                                            ConversationNesting.Section.Mine, if (id == "child") 1 else 0,
                                            if (id == "parent") 1 else 0, false),
                                        pinned = false, status = "Synthetic data only", selected = id == "child",
                                        onToggle = { expands++ }, onClick = { opens++ },
                                        onWatch = { writes++ }, onUnlink = { writes++ }, onPin = { writes++ }, onArchive = { writes++ },
                                        watchBusy = busy.value, unlinking = busy.value, actionBusy = busy.value,
                                        interactions = interactions,
                                    )
                                    Spacer(Modifier.height(8.dp))
                                }
                                Box(Modifier.fillMaxWidth().weight(1f).testTag("outside"))
                            }
                        }
                    }
                }
            }
        }
    }
    private fun row(id: String = "child") = compose.onNodeWithTag("conversation-row:$id")
    private fun more(id: String = "child") = compose.onNodeWithTag("row-more:$id", useUnmergedTree = true)
    private fun shot(name: String) {
        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        File(context.getExternalFilesDir(null), "row-actions-$name.png").outputStream().use {
            bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
        bitmap.recycle()
    }

    @Test fun normalClickThreadAndLongPressHaveSeparateActions() {
        render()
        compose.onNodeWithText("Unwatch").assertDoesNotExist()
        compose.onNodeWithText("Unlink").assertDoesNotExist()
        compose.onNodeWithContentDescription("Hide 1 sub-agents").performClick()
        compose.runOnIdle { assertEquals(1, expands); assertEquals(0, opens) }
        row().performTouchInput { longClick() }
        compose.onNodeWithTag("menu-unlink:child").assertIsDisplayed()
        compose.runOnIdle { assertEquals(0, opens); assertEquals(0, writes) }
        shot("context-menu")
        Espresso.pressBack()
        row().performClick()
        compose.runOnIdle { assertEquals(1, opens) }
    }

    @Test fun fullSwipeOnlyRevealsAndBackClosesWithoutMutation() {
        render()
        shot("normal")
        row().performTouchInput { swipeLeft() }
        compose.onNodeWithTag("row-rail:child").assertExists()
        compose.runOnIdle { assertEquals(0, writes); assertEquals(0, opens) }
        shot("revealed")
        Espresso.pressBack()
        compose.waitForIdle()
        compose.onNodeWithTag("row-rail:child").assertDoesNotExist()
        compose.runOnIdle { assertEquals(0, writes) }
    }

    @Test fun onlyOneRailAndOutsidePressClosesIt() {
        render()
        row("parent").performTouchInput { swipeLeft() }
        row().performTouchInput { swipeLeft() }
        compose.onNodeWithTag("row-rail:parent").assertDoesNotExist()
        compose.onNodeWithTag("row-rail:child").assertExists()
        compose.onNodeWithTag("outside").performTouchInput { click() }
        compose.onNodeWithTag("row-rail:child").assertDoesNotExist()
        compose.runOnIdle { assertEquals(0, writes) }
    }

    @Test fun menuUsesLatestBusyStateAndNeverInvokesDisabledAction() {
        render()
        more().performClick()
        compose.runOnIdle { busy.value = true }
        compose.onNodeWithTag("menu-watch:child").assertIsNotEnabled().performClick()
        compose.runOnIdle { assertEquals(0, writes); busy.value = false }
        compose.onNodeWithTag("menu-watch:child").performClick()
        compose.runOnIdle { assertEquals(1, writes); assertNull(interactions.menuId) }
    }

    @Test fun rtlAndLargeTextExposeAllActionsThroughMenu() {
        render(rtl = true, large = true)
        row().performTouchInput { swipeRight() }
        compose.onNodeWithTag("row-rail:child").assertExists()
        compose.runOnIdle { assertEquals(0, writes) }
        Espresso.pressBack()
        more().performClick()
        for (action in listOf("watch", "unlink", "pin", "archive")) {
            compose.onNodeWithTag("menu-$action:child").assertIsDisplayed()
        }
        shot("rtl-large-text")
    }

    @OptIn(ExperimentalTestApi::class)
    @Test fun accessibilityActionsWorkWithoutRevealingOrOpeningChat() {
        render()
        row().performCustomAccessibilityActionWithLabel("Unwatch")
        compose.runOnIdle { assertEquals(1, writes); assertEquals(0, opens); assertNull(interactions.revealedId) }
    }
    @Test fun narrowAndExpandedPaneSizesKeepActionsReachable() {
        render()
        for (dp in listOf(320, 360, 390)) {
            compose.runOnIdle { width.value = dp }
            more().assertIsDisplayed().performClick()
            compose.onNodeWithTag("menu-archive:child").assertIsDisplayed()
            Espresso.pressBack()
        }
        compose.runOnIdle { width.value = 320 }
        row().performTouchInput { swipeLeft() }
        compose.onNodeWithTag("rail-watch:child").assertIsDisplayed()
        compose.onNodeWithTag("rail-archive:child").assertDoesNotExist()
        compose.onNodeWithContentDescription("More agent actions").performClick()
        compose.onNodeWithTag("menu-archive:child").assertIsDisplayed()
        Espresso.pressBack()
        compose.runOnIdle { width.value = 800 }
        row().performTouchInput { swipeLeft() }
        compose.onNodeWithTag("rail-archive:child").assertIsDisplayed()
        compose.runOnIdle { assertEquals(0, writes) }
        shot("expanded-pane")
    }

    @Test fun keyboardOpensMenuAndDismissRestoresMoreFocus() {
        render(keyboard = true)
        compose.onRoot().performKeyInput { pressKey(Key.Tab) }
        more().performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        more().assertIsFocused()
        more().performKeyInput { pressKey(Key.Enter) }
        compose.onNodeWithTag("menu-watch:child").assertIsDisplayed()
        Espresso.pressBack()
        more().assertIsFocused()
        compose.runOnIdle { assertEquals(0, opens); assertEquals(0, writes) }
    }

}
